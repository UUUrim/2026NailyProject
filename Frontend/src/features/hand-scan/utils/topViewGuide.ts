import type { Finger } from '@/features/hand-scan/hooks/useHandScanPage'

/**
 * 탑뷰 손가락/큐티클 가이드 위치 — 스캔 서버 /capture/stability 응답의 `guide`.
 * 모두 스트림 화면(마커 crop 후) 기준 비율이라 화면 크기와 무관하다.
 * cuticleY는 측정 로직이 큐티클 행으로 쓰는 guide_y 그대로(server.py _top_guide).
 */
export type TopViewGuide = {
  /** 스트림 프레임 가로/세로 비율 */
  aspect: number
  /** 큐티클 라인 세로 위치, 0(위)~1(아래) */
  cuticleY: number
  /** 손가락 실루엣 가로 중심, 0(왼쪽)~1(오른쪽) */
  centerX: number
  /** 1mm가 프레임 높이에서 차지하는 비율 — 실루엣을 실제 크기로 그리는 데 사용 */
  mmToH: number
}

export function parseTopViewGuide(raw: unknown): TopViewGuide | null {
  if (!raw || typeof raw !== 'object') return null
  const { aspect, cuticleY, centerX, mmToH } = raw as Record<string, unknown>
  const values = [aspect, cuticleY, centerX, mmToH]
  if (!values.every((v) => typeof v === 'number' && Number.isFinite(v))) return null
  if ((aspect as number) <= 0 || (mmToH as number) <= 0) return null
  return {
    aspect: aspect as number,
    cuticleY: cuticleY as number,
    centerX: centerX as number,
    mmToH: mmToH as number,
  }
}

/**
 * 촬영 가능(안정) 상태일 때만 오는 손톱 너비/길이와 위치 — /capture/stability 응답의 `measure`.
 * W/L은 지금 촬영하면 최종값이 되는 구간 평균, 위치는 스트림 화면 기준 비율(server.py _top_measure).
 */
export type TopViewMeasure = {
  widthMm: number
  lengthMm: number
  /** 손톱 가운데 열, 0(왼쪽)~1(오른쪽) */
  tipX: number
  /** 손톱 끝 행, 0(위)~1(아래) */
  tipY: number
  /** 큐티클 행, 0(위)~1(아래) */
  cuticleY: number
  /** 손톱 너비의 절반 — 화면 높이 비율(mmToH와 같은 단위) */
  halfW: number
}

export function parseTopViewMeasure(raw: unknown): TopViewMeasure | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  const keys = ['widthMm', 'lengthMm', 'tipX', 'tipY', 'cuticleY', 'halfW'] as const
  if (!keys.every((k) => typeof r[k] === 'number' && Number.isFinite(r[k]))) return null
  const m = Object.fromEntries(keys.map((k) => [k, r[k] as number])) as TopViewMeasure
  if (m.widthMm <= 0 || m.lengthMm <= 0 || m.halfW <= 0 || m.cuticleY <= m.tipY) return null
  return m
}

/**
 * 스트림 <img>의 object-fit: cover(가운데 정렬)와 같은 계산으로 프레임 비율 좌표를
 * w×h 박스의 픽셀 좌표로 옮긴다 — 가이드와 W/L 표시가 실제 영상 위치와 정확히 겹치도록.
 * scale은 프레임 높이 1에 해당하는 픽셀 수.
 */
export function coverMap(w: number, h: number, aspect: number) {
  const scale = Math.max(w / aspect, h)
  const offsetX = (w - aspect * scale) / 2
  const offsetY = (h - scale) / 2
  return {
    scale,
    x: (fracOfWidth: number) => offsetX + fracOfWidth * aspect * scale,
    y: (fracOfHeight: number) => offsetY + fracOfHeight * scale,
  }
}

/** 실루엣 크기용 성인 평균 치수(mm) — 안내용일 뿐 측정에는 쓰이지 않는다. */
const FINGER_GUIDE_MM: Record<Finger, { finger: number; nailW: number; nailL: number }> = {
  THUMB:  { finger: 20,   nailW: 14,   nailL: 13 },
  INDEX:  { finger: 16,   nailW: 11,   nailL: 11 },
  MIDDLE: { finger: 16.5, nailW: 11.5, nailL: 12 },
  RING:   { finger: 15.5, nailW: 10.5, nailL: 11.5 },
  PINKY:  { finger: 13.5, nailW: 9,    nailL: 9.5 },
}

const TIP_BEYOND_NAIL_MM = 2    // 손톱 끝보다 손가락 살이 더 나오는 정도
const CUTICLE_ARCH_MM    = 1.4  // 큐티클 곡선이 가운데보다 양 끝에서 올라가는 높이
const K = 0.5523                // 사분원 베지어 근사 상수

export type FingerGuideShape = {
  fingerPath: string
  nailPath: string
  /**
   * w×h 박스 전체에서 (cx, cy)에 놓인 손가락 모양만 뚫은 path(evenodd) — 실루엣
   * 바깥 어둡게 처리용. SVG <mask> 안의 CSS transform은 Edge에서 가장자리가 덜
   * 칠해지는 경우가 있어서, 마스크 대신 절대 좌표 path 하나로 그린다.
   */
  cutoutPath: (w: number, h: number, cx: number, cy: number) => string
  /** 손가락 절반 폭(px) — 라벨/강조선 배치용 */
  halfWidth: number
  /** 큐티클 라인에서 손가락 끝까지 높이(px) */
  tipHeight: number
}

/**
 * 큐티클 중심(0,0) 기준 손가락/손톱 실루엣 path. 손끝이 위(-y), 손바닥 쪽이
 * 아래(+y)로 화면 밖까지 이어진다. 손톱 뿌리 곡선의 가장 아래 점이 정확히
 * y=0(큐티클 라인)에 닿도록 그린다.
 */
export function buildFingerGuideShape(finger: Finger, pxPerMm: number, bottom: number): FingerGuideShape {
  const dims = FINGER_GUIDE_MM[finger]
  const r = (dims.finger / 2) * pxPerMm
  const n = (dims.nailW / 2) * pxPerMm
  const nailTop = -dims.nailL * pxPerMm
  const top = nailTop - TIP_BEYOND_NAIL_MM * pxPerMm
  const arch = CUTICLE_ARCH_MM * pxPerMm

  const domeH = r * 1.05
  const shoulder = top + domeH
  const base = r * 1.06   // 손가락 뿌리 쪽이 살짝 넓어지게
  const fingerAt = (ox: number, oy: number) => [
    `M ${ox - base} ${oy + bottom}`,
    `L ${ox - r} ${oy + shoulder}`,
    `C ${ox - r} ${oy + shoulder - domeH * K} ${ox - r * K} ${oy + top} ${ox} ${oy + top}`,
    `C ${ox + r * K} ${oy + top} ${ox + r} ${oy + shoulder - domeH * K} ${ox + r} ${oy + shoulder}`,
    `L ${ox + base} ${oy + bottom}`,
    'Z',
  ].join(' ')
  const fingerPath = fingerAt(0, 0)
  const cutoutPath = (w: number, h: number, cx: number, cy: number) =>
    `M 0 0 H ${w} V ${h} H 0 Z ${fingerAt(cx, cy)}`

  const nailDome = n * 0.85
  const nailShoulder = nailTop + nailDome
  const nailPath = [
    `M ${-n} ${-arch}`,
    `L ${-n} ${nailShoulder}`,
    `C ${-n} ${nailShoulder - nailDome * K} ${-n * K} ${nailTop} 0 ${nailTop}`,
    `C ${n * K} ${nailTop} ${n} ${nailShoulder - nailDome * K} ${n} ${nailShoulder}`,
    `L ${n} ${-arch}`,
    // 제어점을 (0, +arch)에 두면 이차 베지어의 중간점이 정확히 y=0에 온다.
    `Q 0 ${arch} ${-n} ${-arch}`,
    'Z',
  ].join(' ')

  return { fingerPath, nailPath, cutoutPath, halfWidth: r, tipHeight: -top }
}
