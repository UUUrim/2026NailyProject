import { useEffect, useRef, useState } from 'react'
import type { Finger } from '@/features/hand-scan/hooks/useHandScanPage'
import { buildFingerGuideShape, type TopViewGuide } from '@/features/hand-scan/utils/topViewGuide'

/** place: 손가락을 놓기 전 / measuring: 손가락 인식돼 측정 중 / ready: 촬영 가능 */
export type FingerGuidePhase = 'place' | 'measuring' | 'ready'

type TopViewFingerGuideProps = {
  guide: TopViewGuide | null
  finger: Finger
  fingerLabel: string
  phase: FingerGuidePhase
}

const LINE_OVERHANG_PX = 16   // 강조선이 손가락 실루엣 밖으로 더 나가는 길이
const LABEL_GAP_PX     = 12
const EDGE_CLEAR_PX    = 16   // 라벨이 화면 왼쪽 끝에 붙지 않게 두는 여백
const COMPACT_BELOW_PX = 190  // 라벨 공간이 이보다 좁으면 설명 문구를 숨긴다
const HIDE_BELOW_PX    = 96   // 제목("큐티클 라인")조차 안 들어가면 라벨을 숨기고 선만 남긴다

/**
 * 탑뷰 스트림 위에 겹치는 손가락 위치/큐티클 라인 가이드.
 *
 * 스트림 <img>는 object-fit: cover(가운데 정렬)라 프레임 일부가 잘려 보이므로,
 * 같은 cover 계산으로 프레임 좌표를 이 박스의 픽셀 좌표로 옮겨서 그린다 —
 * 그래야 큐티클 라인이 측정이 실제로 쓰는 행과 정확히 겹친다.
 */
export function TopViewFingerGuide({ guide, finger, fingerLabel, phase }: TopViewFingerGuideProps) {
  const boxRef = useRef<HTMLDivElement | null>(null)
  const [box, setBox] = useState({ w: 0, h: 0 })

  useEffect(() => {
    const el = boxRef.current
    if (!el) return
    const update = () => setBox({ w: el.clientWidth, h: el.clientHeight })
    update()
    const observer = new ResizeObserver(update)
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  const canDraw = guide !== null && box.w > 0 && box.h > 0
  let content = null

  if (canDraw) {
    // object-fit: cover — 프레임 높이 1을 기준 단위로 둔 스케일(px)
    const scale = Math.max(box.w / guide.aspect, box.h)
    const offsetX = (box.w - guide.aspect * scale) / 2
    const offsetY = (box.h - scale) / 2
    const cx = offsetX + guide.centerX * guide.aspect * scale
    const cy = offsetY + guide.cuticleY * scale
    const pxPerMm = guide.mmToH * scale

    const shape = buildFingerGuideShape(finger, pxPerMm, box.h - cy + 24)
    const lineHalf = shape.halfWidth + LINE_OVERHANG_PX
    const labelRight = box.w - (cx - lineHalf - LABEL_GAP_PX)
    const labelSpace = cx - lineHalf - LABEL_GAP_PX - EDGE_CLEAR_PX
    const at = { transform: `translate(${cx}px, ${cy}px)` }

    content = (
      <>
        <svg className="hand-scan-guide__svg" width={box.w} height={box.h} aria-hidden="true">
          {/* 실루엣 바깥을 살짝 어둡게 — "이 모양 안에 손가락을 넣는다"는 걸 한눈에 */}
          <path
            className="hand-scan-guide__dim"
            d={shape.cutoutPath(box.w, box.h, cx, cy)}
            fillRule="evenodd"
          />

          <g className="hand-scan-guide__anchor" style={at}>
            <path className="hand-scan-guide__finger" d={shape.fingerPath} />
            <path className="hand-scan-guide__nail" d={shape.nailPath} />

            <line className="hand-scan-guide__track" x1={-cx} x2={box.w - cx} y1={0} y2={0} />
            <line className="hand-scan-guide__line-glow" x1={-lineHalf} x2={lineHalf} y1={0} y2={0} />
            <line className="hand-scan-guide__line-halo" x1={-lineHalf} x2={lineHalf} y1={0} y2={0} />
            <line className="hand-scan-guide__line" x1={-lineHalf} x2={lineHalf} y1={0} y2={0} />
            <circle className="hand-scan-guide__end" cx={-lineHalf} cy={0} r={4} />
            <circle className="hand-scan-guide__end" cx={lineHalf} cy={0} r={4} />
          </g>
        </svg>

        <div
          className="hand-scan-guide__place-label"
          style={{ transform: `translate(${cx}px, ${cy - shape.tipHeight - LABEL_GAP_PX}px) translate(-50%, -100%)` }}
        >
          여기에 {fingerLabel}를 올려주세요
          <svg viewBox="0 0 12 12" width="12" height="12" aria-hidden="true">
            <path d="M2 4l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </div>

        <div
          className={[
            'hand-scan-guide__cuticle-label',
            labelSpace < COMPACT_BELOW_PX ? 'hand-scan-guide__cuticle-label--compact' : '',
          ].filter(Boolean).join(' ')}
          style={{ right: labelRight, top: cy, maxWidth: labelSpace }}
          hidden={labelSpace < HIDE_BELOW_PX}
        >
          {/* 맞춰지면(ready) 선이 초록으로 바뀌고 이 라벨은 CSS로 사라진다 */}
          <strong className="hand-scan-guide__cuticle-title">큐티클 라인</strong>
          <span className="hand-scan-guide__cuticle-desc">큐티클을 이 선에 맞춰주세요</span>
        </div>
      </>
    )
  }

  return (
    <div ref={boxRef} className={`hand-scan-guide hand-scan-guide--${phase}`}>
      {content}
    </div>
  )
}
