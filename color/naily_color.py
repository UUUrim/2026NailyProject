"""
naily_color.py
==============
Naily 손 피부톤 분석용 색상 처리 파이프라인.

ComfyUI-color-tools (APZmedia, MIT) 의 littlecms_converter.py 접근을 기반으로 하되,
아래 두 가지를 수정/추가함:

  1. ICC 처리 개선 - 원본은 프로파일 "이름"을 문자열 매핑해서 Display P3 등을
     sRGB로 폴백시킴. 여기서는 임베디드 ICC 바이트를 ImageCms에 직접 넘겨
     실제 프로파일대로 변환함.
  2. LAB 변환 교체 - 원본의 cv2.cvtColor(uint8, RGB2LAB)/255 는 8비트 양자화
     손실이 있어 임계값 기반 분류에 부적합. float32 D65 LAB로 대체.
  3. Flat-field 보정 추가 - 원본에 없는 기능. 스캔박스 조명의 공간적 불균일을
     제거하는 것이 현재 "분류 다양성 부족" 문제의 핵심 대응.

Author: Naily 팀
License: MIT (원 repo 라이선스 승계)
"""

from __future__ import annotations

import io
import json
import os
from dataclasses import dataclass, asdict, field
from typing import Optional, Tuple

import numpy as np
from PIL import Image, ImageCms


# =============================================================================
# 1. ICC 프로파일 정규화
#    (ComfyUI-color-tools/nodes/littlecms_converter.py 의 _detect_source_profile /
#     _convert_with_littlecms 패턴을 기반으로, 임베디드 프로파일 직접 사용하도록 수정)
# =============================================================================

class ICCNormalizer:
    """
    입력 이미지를 촬영 기기의 색공간에서 sRGB로 정규화한다.

    왜 필요한가:
        아이폰은 기본이 Display P3, 일부 안드로이드는 Adobe RGB로 저장한다.
        이걸 sRGB로 가정하고 LAB 변환하면 채도가 과장되어 a, b가 바깥으로 밀린다.
        여러 사람이 전부 "웜"으로 쏠리는 원인이 될 수 있다.
    """

    def __init__(self, fallback: str = "sRGB"):
        self.fallback = fallback
        self._srgb = ImageCms.createProfile("sRGB")

    def describe(self, path: str) -> dict:
        """이미지에 박힌 ICC 프로파일 정보를 읽어서 리턴 (진단용)."""
        info = {"has_icc": False, "profile_name": None, "mode": None}
        try:
            with Image.open(path) as im:
                info["mode"] = im.mode
                icc = im.info.get("icc_profile")
                if icc:
                    prof = ImageCms.ImageCmsProfile(io.BytesIO(icc))
                    info["has_icc"] = True
                    info["profile_name"] = ImageCms.getProfileName(prof).strip()
        except Exception as e:
            info["error"] = str(e)
        return info

    def to_srgb(self, im: Image.Image) -> Tuple[Image.Image, str]:
        """
        PIL 이미지를 sRGB로 변환. 알파채널은 보존한다.

        Returns:
            (변환된 이미지, 어떤 프로파일에서 변환했는지 설명 문자열)
        """
        alpha = None
        if im.mode == "RGBA":
            alpha = im.getchannel("A")
            rgb = im.convert("RGB")
        elif im.mode == "RGB":
            rgb = im
        else:
            rgb = im.convert("RGB")

        icc = im.info.get("icc_profile")
        note = "no embedded profile -> assumed sRGB"

        if icc:
            try:
                src = ImageCms.ImageCmsProfile(io.BytesIO(icc))
                name = ImageCms.getProfileName(src).strip()
                # 임베디드 프로파일을 그대로 사용 (원 repo는 여기서 이름 매핑만 함)
                rgb = ImageCms.profileToProfile(
                    rgb,
                    src,
                    self._srgb,
                    renderingIntent=ImageCms.Intent.RELATIVE_COLORIMETRIC,
                    outputMode="RGB",
                )
                note = f"converted from '{name}' -> sRGB"
            except Exception as e:
                note = f"ICC transform failed ({e}) -> treated as sRGB"

        if alpha is not None:
            rgb = rgb.convert("RGBA")
            rgb.putalpha(alpha)

        return rgb, note


# =============================================================================
# 2. Flat-field 보정  (원 repo에 없는 부분 — 직접 구현)
# =============================================================================

class FlatFieldCorrector:
    """
    스캔박스 조명의 공간적 불균일을 제거한다.

    사용법:
        1) 손을 넣지 않은 상태에서, 박스 바닥에 무광 화이트/그레이 카드를 깔고
           평소 촬영 세팅 그대로 한 장 찍는다  -> flat frame
        2) FlatFieldCorrector(flat_path) 로 로드
        3) 실제 손 이미지에 apply() 호출

    원리:
        관측 이미지 I(x,y) = 실제반사율 R(x,y) x 조명분포 S(x,y)
        flat frame F(x,y) = 균일반사율 k x 조명분포 S(x,y)
        따라서 I / F * mean(F) 하면 S가 소거되고 R만 남는다.

    이게 왜 중요한가:
        현재 contrast = (중간값 - 하위14%) / 80 은 손가락 위/아래 밝기 차이를
        피부 대비로 잘못 읽고 있다. S를 소거하면 이 오염이 제거된다.
    """

    def __init__(
        self,
        flat_path: Optional[str] = None,
        blur_sigma: float = 25.0,
        card_reflectance: Optional[float] = None,
    ):
        """
        card_reflectance:
            사용한 레퍼런스 카드의 실제 반사율 (0~1).
            18% 그레이카드면 0.18, 화이트 카드면 0.9 정도.
            지정하면 절대 밝기(L)까지 복원되어 사람 간 L 비교가 정확해진다.
            None이면 공간적 불균일만 제거하고 전체 밝기 스케일은 보존한다.
        """
        self.gain: Optional[np.ndarray] = None
        self.blur_sigma = blur_sigma
        self.card_reflectance = card_reflectance
        if flat_path:
            self.load(flat_path)

    def load(self, flat_path: str) -> None:
        if not os.path.exists(flat_path):
            raise FileNotFoundError(f"flat frame을 찾을 수 없음: {flat_path}")

        norm = ICCNormalizer()
        with Image.open(flat_path) as im:
            im, _ = norm.to_srgb(im)
            flat = np.asarray(im.convert("RGB"), dtype=np.float32) / 255.0

        # 카드의 먼지/노이즈가 gain map에 박히지 않도록 강하게 블러 처리.
        # (조명 분포는 저주파 성분이므로 블러해도 정보 손실이 없다)
        flat = self._blur(flat, self.blur_sigma)

        flat = np.clip(flat, 1e-4, None)

        if self.card_reflectance is not None:
            # 카드 반사율을 알면 gain이 곧 조명 세기 자체가 되어
            # 보정 후 픽셀값이 실제 반사율 스케일로 복원된다 -> L 절대값 신뢰 가능
            self.gain = flat / float(self.card_reflectance)
        else:
            # 채널별 정규화 -> 조명의 색편향(웜한 LED 등)은 잡히지만
            # 전체 밝기 스케일은 카드 밝기에 묶인다
            self.gain = flat / flat.mean(axis=(0, 1), keepdims=True)

    @staticmethod
    def _blur(img: np.ndarray, sigma: float) -> np.ndarray:
        try:
            import cv2
            k = int(sigma * 4) | 1  # 홀수 커널
            return cv2.GaussianBlur(img, (k, k), sigma)
        except ImportError:
            from scipy.ndimage import gaussian_filter
            return gaussian_filter(img, sigma=(sigma, sigma, 0))

    def apply(self, rgb: np.ndarray) -> np.ndarray:
        """
        rgb: float32 [0,1], shape (H, W, 3)
        gain map 해상도가 다르면 자동 리사이즈한다.
        """
        if self.gain is None:
            return rgb

        g = self.gain
        if g.shape[:2] != rgb.shape[:2]:
            import cv2
            g = cv2.resize(g, (rgb.shape[1], rgb.shape[0]), interpolation=cv2.INTER_LINEAR)

        return np.clip(rgb / g, 0.0, 1.0)

    @property
    def is_active(self) -> bool:
        return self.gain is not None


# =============================================================================
# 3. float LAB 변환
#    (원 repo의 8비트 cv2 변환을 대체 — 임계값 분류에는 정밀도가 필요)
# =============================================================================

_M_SRGB_TO_XYZ = np.array([
    [0.4124564, 0.3575761, 0.1804375],
    [0.2126729, 0.7151522, 0.0721750],
    [0.0193339, 0.1191920, 0.9503041],
], dtype=np.float64)

_D65 = np.array([0.95047, 1.00000, 1.08883], dtype=np.float64)


def srgb_to_linear(c: np.ndarray) -> np.ndarray:
    """sRGB 감마 디코딩 (IEC 61966-2-1)."""
    c = np.clip(c.astype(np.float64), 0.0, 1.0)
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)


def rgb_to_lab(rgb: np.ndarray) -> np.ndarray:
    """
    sRGB [0,1] -> CIE LAB (D65).
    shape (..., 3) 아무 형태나 받는다. L: 0~100, a/b: 대략 -128~127.
    """
    lin = srgb_to_linear(rgb)
    xyz = lin @ _M_SRGB_TO_XYZ.T
    xyz = xyz / _D65

    eps = 216.0 / 24389.0
    kappa = 24389.0 / 27.0
    f = np.where(xyz > eps, np.cbrt(xyz), (kappa * xyz + 16.0) / 116.0)

    fx, fy, fz = f[..., 0], f[..., 1], f[..., 2]
    L = 116.0 * fy - 16.0
    a = 500.0 * (fx - fy)
    b = 200.0 * (fy - fz)
    return np.stack([L, a, b], axis=-1)


def lab_to_rgb_hex(L: float, a: float, b: float) -> str:
    """대표 LAB 값을 hex 문자열로 (응답의 skinToneHex 용)."""
    fy = (L + 16.0) / 116.0
    fx = fy + a / 500.0
    fz = fy - b / 200.0
    eps, kappa = 216.0 / 24389.0, 24389.0 / 27.0

    def finv(t):
        return t ** 3 if t ** 3 > eps else (116.0 * t - 16.0) / kappa

    xyz = np.array([finv(fx), finv(fy), finv(fz)]) * _D65
    lin = np.linalg.inv(_M_SRGB_TO_XYZ) @ xyz
    lin = np.clip(lin, 0.0, 1.0)
    srgb = np.where(lin <= 0.0031308, lin * 12.92, 1.055 * lin ** (1 / 2.4) - 0.055)
    r, g, bb = (np.clip(srgb, 0, 1) * 255).round().astype(int)
    return f"#{r:02X}{g:02X}{bb:02X}"


# =============================================================================
# 4. 피부 속성 추출
# =============================================================================

@dataclass
class SkinMetrics:
    L: float
    a: float
    b: float
    C: float
    warmness: float
    brightness: float
    saturation: float
    contrast: float
    undertone: str
    pixel_count: int
    flat_field_applied: bool = False
    icc_note: str = ""
    gradient_removed: float = 0.0  # 제거된 조명 기울기 크기 (진단용)

    def to_dict(self) -> dict:
        return asdict(self)


class SkinToneAnalyzer:
    """
    seg된 손가락 RGBA PNG에서 피부 속성을 뽑는다.

    기존 skin_tone_api.py 대비 변경점:
      - ICC 정규화 단계 추가
      - flat-field 보정 단계 추가
      - contrast를 "조명 기울기 제거 후 잔차"로 재정의
      - 하이라이트 상수 차감 방식의 조명 보정 제거 (flat-field가 대체)
    """

    def __init__(
        self,
        flat_field: Optional[FlatFieldCorrector] = None,
        alpha_threshold: int = 128,
        trim_percent: float = 25.0,
    ):
        self.icc = ICCNormalizer()
        self.flat = flat_field
        self.alpha_threshold = alpha_threshold
        self.trim_percent = trim_percent

    # -- 내부 헬퍼 ---------------------------------------------------------

    def _load(self, source) -> Tuple[np.ndarray, np.ndarray, str]:
        """RGBA 입력 -> (rgb float32, mask bool, icc note)"""
        if isinstance(source, (str, os.PathLike)):
            im = Image.open(source)
        elif isinstance(source, (bytes, bytearray)):
            im = Image.open(io.BytesIO(source))
        else:
            im = source

        im, note = self.icc.to_srgb(im)

        if im.mode != "RGBA":
            raise ValueError(
                "알파채널이 있는 RGBA PNG가 필요합니다 "
                "(ComfyUI Apply Mask to Image 출력)."
            )

        arr = np.asarray(im, dtype=np.float32) / 255.0
        rgb, alpha = arr[..., :3], arr[..., 3]
        mask = alpha > (self.alpha_threshold / 255.0)

        if mask.sum() < 100:
            raise ValueError(f"유효 피부 픽셀이 너무 적음: {int(mask.sum())}개")

        return rgb, mask, note

    @staticmethod
    def _detrend(L_map: np.ndarray, mask: np.ndarray) -> Tuple[np.ndarray, float]:
        """
        마스크 영역 L에 2D 평면을 최소자승 피팅하고 빼서 조명 기울기를 제거한다.

        flat-field를 못 쓰는 상황(레퍼런스 프레임 없음)에서의 2차 방어선이고,
        flat-field를 쓰더라도 손가락 자체의 곡률로 생기는 음영을 추가로 걷어낸다.

        Returns:
            (잔차 L 값 1D 배열, 기울기 크기)
        """
        ys, xs = np.nonzero(mask)
        vals = L_map[ys, xs].astype(np.float64)

        # 좌표 정규화 (수치 안정성)
        x = (xs - xs.mean()) / (xs.std() + 1e-6)
        y = (ys - ys.mean()) / (ys.std() + 1e-6)

        A = np.column_stack([np.ones_like(x), x, y])
        coef, *_ = np.linalg.lstsq(A, vals, rcond=None)

        fitted = A @ coef
        residual = vals - fitted + coef[0]  # 평균 밝기는 유지
        slope = float(np.hypot(coef[1], coef[2]))

        return residual, slope

    # -- 메인 --------------------------------------------------------------

    def analyze(self, source) -> SkinMetrics:
        rgb, mask, icc_note = self._load(source)

        # 1) flat-field 보정 (조명 분포 소거)
        applied = False
        if self.flat is not None and self.flat.is_active:
            rgb = self.flat.apply(rgb)
            applied = True

        # 2) LAB 변환 (마스크 영역만)
        lab_map = rgb_to_lab(rgb)
        L_map = lab_map[..., 0]

        pixels = lab_map[mask]  # (N, 3)

        # 3) 밝기 기준 상하위 trim -> 그림자/스펙큘러 하이라이트 제거
        lo = np.percentile(pixels[:, 0], self.trim_percent)
        hi = np.percentile(pixels[:, 0], 100 - self.trim_percent)
        core = pixels[(pixels[:, 0] >= lo) & (pixels[:, 0] <= hi)]
        if len(core) < 50:
            core = pixels

        L, a, b = core.mean(axis=0)
        C = float(np.hypot(a, b))

        # 4) contrast — 조명 기울기 제거 후의 잔차 분포로 측정
        residual, slope = self._detrend(L_map, mask)
        r_lo = np.percentile(residual, 14)
        r_mid = np.percentile(residual, 50)
        contrast_raw = float(r_mid - r_lo)

        # 5) 속성 산출
        warmness = float(b - a * 0.5)
        brightness = float(L / 100.0)
        saturation = float(C / 40.0)
        # L로 나눠서 밝기와 분리한다. 같은 피부결이라도 어두운 피부는 L 잔차가
        # 작게 나오므로, 정규화하지 않으면 contrast가 사실상 brightness의 복사본이 된다.
        contrast = float(contrast_raw / max(L, 1e-3) * 25.0)

        if a > 3 and b > 12:
            undertone = "Yellow-Warm"
        elif a > 8 and b > 8:
            undertone = "Pink-Warm"
        elif b < 8:
            undertone = "Cool"
        else:
            undertone = "Neutral"

        return SkinMetrics(
            L=round(float(L), 2),
            a=round(float(a), 2),
            b=round(float(b), 2),
            C=round(C, 2),
            warmness=round(warmness, 2),
            brightness=round(brightness, 3),
            saturation=round(saturation, 3),
            contrast=round(contrast, 3),
            undertone=undertone,
            pixel_count=int(mask.sum()),
            flat_field_applied=applied,
            icc_note=icc_note,
            gradient_removed=round(slope, 3),
        )


# =============================================================================
# 5. 캘리브레이션 헬퍼
# =============================================================================

def collect_calibration(paths, flat_path: Optional[str] = None) -> dict:
    """
    여러 장의 손 이미지를 돌려서 각 속성의 실측 분포를 뽑는다.

    문서에 적힌 "임계값 캘리브레이션" 작업용. 4명이 아니라 최소 15~20명
    데이터를 모은 뒤, 여기서 나온 percentile로 결정 트리 임계값을 다시 잡아야 한다.
    이론값(warmness > 9 같은)을 그대로 쓰면 실제 분포가 그 경계에 안 걸려서
    지금처럼 전원 같은 계절로 몰린다.
    """
    ff = FlatFieldCorrector(flat_path) if flat_path else None
    analyzer = SkinToneAnalyzer(flat_field=ff)

    rows = []
    for p in paths:
        try:
            rows.append(analyzer.analyze(p).to_dict())
        except Exception as e:
            print(f"[skip] {p}: {e}")

    if not rows:
        return {"error": "분석된 이미지 없음"}

    out = {"n": len(rows), "samples": rows, "distribution": {}}
    for key in ("L", "a", "b", "warmness", "brightness", "saturation", "contrast"):
        vals = np.array([r[key] for r in rows], dtype=float)
        out["distribution"][key] = {
            "min": round(float(vals.min()), 3),
            "p25": round(float(np.percentile(vals, 25)), 3),
            "p50": round(float(np.percentile(vals, 50)), 3),
            "p75": round(float(np.percentile(vals, 75)), 3),
            "max": round(float(vals.max()), 3),
            "spread": round(float(vals.max() - vals.min()), 3),
        }

    # 다양성 진단: spread가 좁으면 그 축으로는 사람 구분이 안 된다는 뜻
    warn = [k for k, v in out["distribution"].items()
            if k in ("warmness", "contrast") and v["spread"] < 3.0]
    if warn:
        out["warning"] = (
            f"다음 속성의 분산이 매우 작습니다: {warn}. "
            "촬영 환경이 여전히 지배적이거나, 표본의 피부톤 다양성이 부족합니다."
        )

    return out


if __name__ == "__main__":
    import sys
    if len(sys.argv) > 1:
        ff = FlatFieldCorrector(sys.argv[2]) if len(sys.argv) > 2 else None
        m = SkinToneAnalyzer(flat_field=ff).analyze(sys.argv[1])
        print(json.dumps(m.to_dict(), indent=2, ensure_ascii=False))
    else:
        print("usage: python naily_color.py <hand.png> [flat_frame.jpg]")


# =============================================================================
# 6. 상대적 분류기
#    절대 임계값 대신, 입력된 그룹 내 상대 위치(z-score)로 계절을 분류한다.
#    "4명이 다 비슷한데 누가 더 웜한가"를 잡는 게 핵심.
# =============================================================================

from typing import List, Dict

@dataclass
class RelativeResult:
    name: str
    season_code: str
    season_ko: str
    tone: str          # warm / cool / neutral
    brightness: str    # light / mid / deep
    character: str     # vivid / bright / soft / muted
    warmness_z: float  # 그룹 내 상대 위치 (-2~+2)
    skin_hex: str
    metrics: dict

# 16계절 → (tone, brightness, character) 매핑
_SEASON_MAP = {
    "spring_vivid":   ("warm",    "light", "vivid"),
    "spring_bright":  ("warm",    "light", "bright"),
    "spring_light":   ("warm",    "light", "soft"),
    "spring_soft":    ("warm",    "light", "muted"),
    "autumn_soft":    ("warm",    "mid",   "soft"),
    "autumn_mute":    ("warm",    "mid",   "muted"),
    "autumn_deep":    ("warm",    "deep",  "bright"),
    "autumn_dark":    ("warm",    "deep",  "vivid"),
    "summer_light":   ("cool",    "light", "soft"),
    "summer_bright":  ("cool",    "light", "bright"),
    "summer_soft":    ("cool",    "mid",   "soft"),
    "summer_mute":    ("cool",    "mid",   "muted"),
    "winter_light":   ("cool",    "light", "vivid"),
    "winter_vivid":   ("cool",    "mid",   "vivid"),
    "winter_deep":    ("cool",    "deep",  "bright"),
    "winter_dark":    ("cool",    "deep",  "vivid"),
}

_SEASON_KO = {
    "spring_vivid": "봄 비비드", "spring_bright": "봄 브라이트",
    "spring_light": "봄 라이트", "spring_soft": "봄 소프트",
    "autumn_soft": "가을 소프트", "autumn_mute": "가을 뮤트",
    "autumn_deep": "가을 딥", "autumn_dark": "가을 다크",
    "summer_light": "여름 라이트", "summer_bright": "여름 브라이트",
    "summer_soft": "여름 소프트", "summer_mute": "여름 뮤트",
    "winter_light": "겨울 라이트", "winter_vivid": "겨울 비비드",
    "winter_deep": "겨울 딥", "winter_dark": "겨울 다크",
}


def _zscore(vals: np.ndarray) -> np.ndarray:
    std = vals.std()
    if std < 1e-6:          # 전원 동일값이면 z=0
        return np.zeros_like(vals)
    return (vals - vals.mean()) / std


def relative_classify(
    metrics_list: List[SkinMetrics],
    names: List[str],
) -> List[RelativeResult]:
    """
    그룹 내 상대 위치 기반으로 각 사람의 계절을 분류한다.

    단독 분석에서 "전원 봄라이트"가 나오는 이유:
        임계값이 절대값이라 L=77~80, warmness=11~15 처럼
        비슷한 구간에 몰리면 전원 같은 bucket에 떨어짐.

    여기서는 그룹의 분포를 먼저 계산하고,
    각 사람이 그 분포 안에서 어느 쪽에 위치하는지로 분류함.
    미세한 차이도 상대적으로 증폭되어 잡힌다.

    표본이 1명이면 상대 분류가 불가능하므로 단독 분류를 쓴다.
    """
    n = len(metrics_list)
    assert n == len(names), "metrics_list와 names 길이가 다름"

    # ── 속성 행렬 ──────────────────────────────────────────────────────────
    W  = np.array([m.warmness   for m in metrics_list])
    L  = np.array([m.L          for m in metrics_list])
    S  = np.array([m.saturation for m in metrics_list])
    Ct = np.array([m.contrast   for m in metrics_list])
    A  = np.array([m.a          for m in metrics_list])
    B  = np.array([m.b          for m in metrics_list])

    # ── z-score (그룹 내 상대 위치) ────────────────────────────────────────
    zW  = _zscore(W)
    zL  = _zscore(L)
    zS  = _zscore(S)
    zCt = _zscore(Ct)

    # ── 분류 민감도 제어 ───────────────────────────────────────────────────
    # SPREAD_THRESHOLD: 그룹 내 실측 range가 이 값 미만이면
    # 해당 축은 "구분 불가"로 보고 절대값으로 fallback.
    # 너무 낮추면 노이즈까지 증폭, 너무 높이면 민감도 감소.
    # warmness: 피부톤 다양성이 어느 정도 있으면 2.0 정도가 적당.
    SPREAD_W = 2.0   # warmness 최소 range
    SPREAD_L = 2.0   # L 최소 range

    # 그룹 spread가 너무 좁으면 절대값으로 fallback
    use_relative_warm = (W.max() - W.min()) >= SPREAD_W
    use_relative_L    = (L.max() - L.min()) >= SPREAD_L

    results = []
    for i, (name, m) in enumerate(zip(names, metrics_list)):

        # ── Tone: 웜 / 쿨 / 뉴트럴 ────────────────────────────────────────
        if use_relative_warm:
            # 상대 위치: z > 0.5이면 그룹에서 웜한 쪽, < -0.5이면 쿨한 쪽
            if zW[i] > 0.5:
                tone = "warm"
            elif zW[i] < -0.5:
                tone = "cool"
            else:
                tone = "neutral"
        else:
            # 절대값 fallback (그룹이 너무 동질적일 때)
            tone = "warm" if m.warmness > 11 else "cool" if m.warmness < 8 else "neutral"

        # ── Brightness: light / mid / deep ─────────────────────────────────
        if use_relative_L:
            if zL[i] > 0.4:
                brightness = "light"
            elif zL[i] < -0.4:
                brightness = "deep"
            else:
                brightness = "mid"
        else:
            brightness = "light" if m.brightness > 0.72 else "deep" if m.brightness < 0.58 else "mid"

        # ── Character: vivid / bright / soft / muted ───────────────────────
        # saturation과 contrast를 결합해서 판단
        # z_S 높고 z_Ct 높으면 vivid, z_S 높고 z_Ct 낮으면 bright,
        # z_S 낮고 z_Ct 낮으면 muted, 중간이면 soft
        score = zS[i] * 0.6 + zCt[i] * 0.4
        if score > 0.6:
            character = "vivid"
        elif score > 0.1:
            character = "bright"
        elif score < -0.4:
            character = "muted"
        else:
            character = "soft"

        # ── 계절 코드 매핑 ─────────────────────────────────────────────────
        season_code = _map_season(tone, brightness, character)

        results.append(RelativeResult(
            name=name,
            season_code=season_code,
            season_ko=_SEASON_KO[season_code],
            tone=tone,
            brightness=brightness,
            character=character,
            warmness_z=round(float(zW[i]), 3),
            skin_hex=lab_to_rgb_hex(m.L, m.a, m.b),
            metrics={
                "L": m.L, "a": m.a, "b": m.b,
                "warmness": m.warmness,
                "saturation": m.saturation,
                "contrast": m.contrast,
                "warmness_z": round(float(zW[i]), 3),
                "L_z": round(float(zL[i]), 3),
                "saturation_z": round(float(zS[i]), 3),
            }
        ))

    return results


def _map_season(tone: str, brightness: str, character: str) -> str:
    """(tone, brightness, character) → season_code"""
    for code, (t, b, c) in _SEASON_MAP.items():
        if t == tone and b == brightness and c == character:
            return code
    # 정확히 일치하는 게 없으면 tone+brightness 우선 매핑
    fallback = {
        ("warm",    "light"): "spring_light",
        ("warm",    "mid"):   "autumn_soft",
        ("warm",    "deep"):  "autumn_deep",
        ("cool",    "light"): "summer_light",
        ("cool",    "mid"):   "summer_soft",
        ("cool",    "deep"):  "winter_deep",
        ("neutral", "light"): "summer_light",
        ("neutral", "mid"):   "summer_soft",
        ("neutral", "deep"):  "autumn_soft",
    }
    return fallback.get((tone, brightness), "spring_light")


# =============================================================================
# 7. 10장 손가락 집계 분석기
# =============================================================================

@dataclass
class FingerMetrics:
    """손가락 1개의 분석 결과 + 신뢰도 정보."""
    finger_idx: int        # 0~9 (왼손 새끼~엄지, 오른손 엄지~새끼)
    finger_name: str       # "왼손_새끼" 등
    metrics: SkinMetrics
    weight: float          # 가중치 (높을수록 신뢰도 높음)
    is_outlier: bool = False
    outlier_reason: str = ""

    def to_dict(self) -> dict:
        return {
            "finger_idx": self.finger_idx,
            "finger_name": self.finger_name,
            "weight": round(self.weight, 4),
            "is_outlier": self.is_outlier,
            "outlier_reason": self.outlier_reason,
            **{f"metrics_{k}": v for k, v in self.metrics.to_dict().items()},
        }


@dataclass
class AggregatedMetrics:
    """10장 집계 결과."""
    L: float
    a: float
    b: float
    C: float
    warmness: float
    brightness: float
    saturation: float
    contrast: float
    undertone: str
    skin_hex: str
    valid_fingers: int      # 이상치 제외 후 유효 손가락 수
    total_fingers: int      # 전체 손가락 수
    outlier_count: int      # 이상치로 제외된 수
    warmness_std: float     # 손가락 간 분산 (낮을수록 안정적)
    reliability: str        # "high" / "medium" / "low"
    finger_details: List[dict]

    def to_dict(self) -> dict:
        return asdict(self)


# 손가락 이름 (찍는 순서: 왼손 새끼→엄지, 오른손 엄지→새끼)
FINGER_NAMES = [
    "왼손_새끼", "왼손_약지", "왼손_중지", "왼손_검지", "왼손_엄지",
    "오른손_엄지", "오른손_검지", "오른손_중지", "오른손_약지", "오른손_새끼",
]


def _compute_weight(m: SkinMetrics) -> float:
    """
    손가락 1개의 신뢰도 가중치 계산.

    픽셀 수 많을수록 + 기울기 제거값 낮을수록 → 가중치 높음.
    """
    pixel_score = np.log1p(m.pixel_count) / np.log1p(100000)  # 0~1 정규화
    gradient_score = 1.0 / (1.0 + m.gradient_removed)          # 기울기 낮을수록 높음
    return float(pixel_score * 0.4 + gradient_score * 0.6)


def _detect_outliers(
    finger_list: List[FingerMetrics],
    attr: str = "warmness",
    z_threshold: float = 2.0,
) -> List[FingerMetrics]:
    """
    특정 속성 기준으로 이상치 손가락을 탐지한다.

    z_threshold: 이 값 이상이면 이상치로 판단 (기본 2.0 = 상하위 약 5%)
    """
    vals = np.array([getattr(f.metrics, attr) for f in finger_list])
    if vals.std() < 1e-6:
        return finger_list

    z = np.abs((vals - vals.mean()) / vals.std())
    for i, f in enumerate(finger_list):
        if z[i] >= z_threshold:
            f.is_outlier = True
            f.outlier_reason = (
                f"{attr}={getattr(f.metrics, attr):.2f} "
                f"(z={z[i]:.1f}, 평균에서 {z[i]:.1f}σ 벗어남)"
            )
    return finger_list


def build_finger_metrics(
    image_path_or_source,
    finger_idx: int,
    finger_name: str,
    analyzer: "SkinToneAnalyzer",
) -> FingerMetrics:
    """
    이미지 1장(경로/bytes/PIL 등 analyzer.analyze가 받는 아무 소스)을 분석해서
    FingerMetrics 1개를 만든다. 실시간으로 사진이 한 장씩 들어올 때 사용.
    """
    m = analyzer.analyze(image_path_or_source)
    w = _compute_weight(m)
    print(f"  [{finger_name}] L={m.L:.1f} warm={m.warmness:.2f} "
          f"grad={m.gradient_removed:.2f} weight={w:.3f}")
    return FingerMetrics(
        finger_idx=finger_idx,
        finger_name=finger_name,
        metrics=m,
        weight=w,
    )


def aggregate_finger_list(
    finger_list: List[FingerMetrics],
    outlier_z: float = 2.0,
    min_valid: int = 5,
) -> AggregatedMetrics:
    """
    이미 분석되어 쌓여있는 FingerMetrics 리스트를 집계한다.
    (재분석 없음 — 실시간으로 한 장씩 build_finger_metrics로 쌓아온 결과를 여기로 넘기면 됨)

    Args:
        finger_list: build_finger_metrics()로 만든 FingerMetrics 객체들
        outlier_z: 이상치 판단 z-score 임계값
        min_valid: 최소 유효 손가락 수 (이보다 적으면 경고)

    Returns:
        AggregatedMetrics: 가중 평균된 피부 수치 + 신뢰도 정보
    """
    if len(finger_list) < 2:
        raise ValueError(f"유효한 손가락 이미지가 너무 적습니다: {len(finger_list)}개")

    # ── 2. 이상치 탐지 (warmness 기준) ──────────────────────────────────
    finger_list = _detect_outliers(finger_list, "warmness", outlier_z)
    # 추가로 gradient_removed가 너무 높은 것도 제거
    grad_vals = np.array([f.metrics.gradient_removed for f in finger_list])
    grad_mean = grad_vals.mean()
    grad_std  = grad_vals.std()
    for f in finger_list:
        if not f.is_outlier:
            z = (f.metrics.gradient_removed - grad_mean) / (grad_std + 1e-6)
            if z > outlier_z:
                f.is_outlier = True
                f.outlier_reason = (
                    f"기울기 제거값={f.metrics.gradient_removed:.2f} "
                    f"(z={z:.1f}, 조명 오염 심함)"
                )

    valid = [f for f in finger_list if not f.is_outlier]
    outlier_count = len(finger_list) - len(valid)

    if len(valid) < min_valid:
        print(f"[경고] 유효 손가락이 {len(valid)}개로 적습니다. "
              f"이상치 포함해서 계산합니다.")
        valid = finger_list

    print(f"\n[집계] 유효 {len(valid)}/{len(finger_list)}개 "
          f"(이상치 {outlier_count}개 제외)")

    # ── 3. 가중 평균 ─────────────────────────────────────────────────────
    weights = np.array([f.weight for f in valid])
    weights = weights / weights.sum()  # 정규화

    def wavg(attr: str) -> float:
        vals = np.array([getattr(f.metrics, attr) for f in valid])
        return float(np.average(vals, weights=weights))

    L         = wavg("L")
    a         = wavg("a")
    b         = wavg("b")
    warmness  = wavg("warmness")
    sat       = wavg("saturation")
    contrast  = wavg("contrast")
    C         = float(np.hypot(a, b))
    brightness = L / 100.0

    # ── 4. 손가락 간 분산 (신뢰도 지표) ─────────────────────────────────
    warmness_vals = np.array([f.metrics.warmness for f in valid])
    warmness_std  = float(warmness_vals.std())

    if warmness_std < 1.0:
        reliability = "high"
    elif warmness_std < 2.0:
        reliability = "medium"
    else:
        reliability = "low"

    # ── 5. undertone ─────────────────────────────────────────────────────
    if a > 3 and b > 12:
        undertone = "Yellow-Warm"
    elif a > 8 and b > 8:
        undertone = "Pink-Warm"
    elif b < 8:
        undertone = "Cool"
    else:
        undertone = "Neutral"

    skin_hex = lab_to_rgb_hex(L, a, b)

    print(f"[집계] L={L:.2f}  a={a:.2f}  b={b:.2f}  warmness={warmness:.2f}")
    print(f"[집계] saturation={sat:.3f}  contrast={contrast:.3f}")
    print(f"[집계] warmness_std={warmness_std:.3f}  신뢰도={reliability}")
    print(f"[집계] skinHex={skin_hex}")

    return AggregatedMetrics(
        L=round(L, 2),
        a=round(a, 2),
        b=round(b, 2),
        C=round(C, 2),
        warmness=round(warmness, 2),
        brightness=round(brightness, 3),
        saturation=round(sat, 3),
        contrast=round(contrast, 3),
        undertone=undertone,
        skin_hex=skin_hex,
        valid_fingers=len(valid),
        total_fingers=len(finger_list),
        outlier_count=outlier_count,
        warmness_std=round(warmness_std, 3),
        reliability=reliability,
        finger_details=[f.to_dict() for f in finger_list],
    )


def aggregate_fingers(
    image_paths: List[str],
    finger_names: Optional[List[str]] = None,
    flat_field: Optional[FlatFieldCorrector] = None,
    outlier_z: float = 2.0,
    min_valid: int = 5,
) -> AggregatedMetrics:
    """
    [배치용] 10장(또는 그 이하) 손가락 RGBA 이미지 경로를 한 번에 받아서 분석+집계.
    실시간 흐름에서는 대신 build_finger_metrics()로 한 장씩 쌓고
    aggregate_finger_list()로 집계할 것.
    """
    if finger_names is None:
        finger_names = FINGER_NAMES[:len(image_paths)]

    assert len(image_paths) == len(finger_names), \
        f"이미지 수({len(image_paths)})와 손가락 이름 수({len(finger_names)})가 다름"

    analyzer = SkinToneAnalyzer(flat_field=flat_field)

    finger_list: List[FingerMetrics] = []
    for idx, (path, name) in enumerate(zip(image_paths, finger_names)):
        try:
            finger_list.append(build_finger_metrics(path, idx, name, analyzer))
        except Exception as e:
            print(f"  [{name}] 분석 실패: {e} → 스킵")

    return aggregate_finger_list(finger_list, outlier_z=outlier_z, min_valid=min_valid)


def aggregate_to_skin_metrics(agg: AggregatedMetrics) -> SkinMetrics:
    """
    AggregatedMetrics → SkinMetrics 변환.
    relative_classify 등 기존 함수에 그대로 넘길 수 있음.
    """
    return SkinMetrics(
        L=agg.L, a=agg.a, b=agg.b, C=agg.C,
        warmness=agg.warmness,
        brightness=agg.brightness,
        saturation=agg.saturation,
        contrast=agg.contrast,
        undertone=agg.undertone,
        pixel_count=0,
        flat_field_applied=False,
        icc_note="aggregated",
        gradient_removed=0.0,
    )