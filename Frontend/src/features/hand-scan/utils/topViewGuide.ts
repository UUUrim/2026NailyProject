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

/**
 * 실제 손가락 지지대 가로 중심이 서버의 손가락 자리(guide.centerX — 마커 오른쪽 끝 +
 * server.py FINGER_SLOT_FROM_MARKER_MM)보다 오른쪽으로 떨어진 거리(mm). 흰 배경 + 받침대 위
 * 마커 세팅에서 찍은 탑뷰 화면으로 잰 값 — 지지대(검은 직사각형) 가운데가 가이드보다 6.5mm 오른쪽.
 * 받침대 배치가 바뀌면 여기만 다시 잰다.
 */
const SUPPORT_FROM_SLOT_MM = 6.5
// 지지대를 가운데로 당기면서 화면 끝이 비지 않게 하려면 영상을 키워야 하는데, 서버가 손가락 자리를
// 화면 끝 가까이에 둔 예외 크롭(server.py _top_view_rect의 좁은 창)에서는 그 배율이 커진다 —
// 이보다 더 키우지는 않는다(그때만 화면 끝에 띠가 조금 남을 수 있다).
const MAX_DISPLAY_ZOOM = 1.5
// 브라우저가 소수점 픽셀을 그리는 과정의 오차로 영상 끝이 칸 끝에 못 미쳐 가는 선이 비치지 않도록
// 좌우를 이만큼(CSS px) 더 덮는다 — 배율이 0.1~0.5% 커질 뿐, 가이드도 같은 배율로 그려 크기는 그대로 맞다.
const EDGE_OVERSCAN_PX = 1

/**
 * 탑뷰 화면 표시용 좌표 변환 — coverMap에 "지지대 맞춤 확대·이동"을 더한 것.
 * 영상(<img>)·손가락 가이드·W/L 표시가 모두 이 하나로 그려져서 서로 정확히 겹친다.
 *
 * - 지지대 가운데(서버 손가락 자리 + SUPPORT_FROM_SLOT_MM)가 예전 가이드 자리(coverMap의 centerX)에 온다.
 * - 그렇게 옆으로 옮겨도 화면 끝이 비지 않을 만큼만(좌우 EDGE_OVERSCAN_PX 여유 포함) 영상을 키운다
 *   (세로는 화면 가운데 기준).
 * - 같은 배율로 그리므로 가이드 실루엣·W/L 치수선도 확대된 영상 속 손가락과 같은 크기가 된다.
 *
 * 순수 표시용이다: 서버가 보내는 스트림 프레임, 측정, 저장 사진, 서버가 주는 가이드/측정 값은
 * 하나도 바뀌지 않고, 그 값을 화면 어디에 그릴지만 정한다.
 * scale은 프레임 높이 1에 해당하는 화면 픽셀 수(coverMap과 같은 뜻, 확대 배율 포함).
 */
export function topViewDisplayMap(w: number, h: number, guide: TopViewGuide) {
  const base = coverMap(w, h, guide.aspect)
  const targetX = base.x(guide.centerX)   // 지지대 가운데가 놓일 화면 x (예전 가이드 가운데)
  // 지지대 가운데 — 프레임 가로 비율. mm 기준이라 카메라 높이/화면 크기와 무관하게 같은 실제 거리.
  let supportX = guide.centerX + (SUPPORT_FROM_SLOT_MM * guide.mmToH) / guide.aspect
  let fromX = base.x(supportX)
  let zoom = 1
  // 확대 전, 지지대 가운데에서 영상 왼쪽/오른쪽 끝까지
  const spaceL = fromX - base.x(0)
  const spaceR = base.x(1) - fromX
  if (spaceL > 0 && spaceR > 0) {
    zoom = Math.min(
      Math.max(1, (targetX + EDGE_OVERSCAN_PX) / spaceL, (w - targetX + EDGE_OVERSCAN_PX) / spaceR),
      MAX_DISPLAY_ZOOM,
    )
  } else {
    // 지지대가 영상 밖으로 계산되는 이상한 값 — 맞추지 않고 서버 가이드 그대로 둔다
    supportX = guide.centerX
    fromX = targetX
  }
  // 화면 좌표 p → p' = t + zoom·p. 가로는 지지대 가운데가 targetX로, 세로는 화면 가운데 고정.
  const tx = targetX - zoom * fromX
  const ty = (h / 2) * (1 - zoom)
  return {
    scale: base.scale * zoom,
    x: (fracOfWidth: number) => tx + zoom * base.x(fracOfWidth),
    y: (fracOfHeight: number) => ty + zoom * base.y(fracOfHeight),
    /** 손가락 가이드 가로 중심(프레임 가로 비율) = 지지대 가운데 */
    supportX,
    /** object-fit: cover로 그려진 <img>에 그대로 씌우는 CSS transform (transform-origin: 0 0) */
    imageTransform: `translate(${tx}px, ${ty}px) scale(${zoom})`,
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
