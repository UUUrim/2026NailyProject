import { useBoxSize } from '@/features/hand-scan/hooks/useBoxSize'
import { coverMap, type TopViewGuide, type TopViewMeasure } from '@/features/hand-scan/utils/topViewGuide'

type TopViewNailMeasureProps = {
  /** 스트림 화면 비율(aspect)을 쓰려고 받는다 */
  guide: TopViewGuide | null
  /** 안정(촬영 가능)일 때만 값이 있다 — 없으면 아무것도 그리지 않는다 */
  measure: TopViewMeasure | null
}

const LENGTH_GAP_PX = 18   // 길이 치수선을 손톱 오른쪽 끝에서 띄우는 거리
const TICK_PX       = 7    // 치수선 양 끝 짧은 눈금 절반 길이
const LABEL_GAP_PX  = 12

const fmt = (mm: number) => mm.toFixed(1)

/**
 * 촬영 가능(안정) 상태에서만 손톱 위에 너비·길이를 치수선으로 보여준다.
 * 너비는 손톱 가운데 높이를 가로지르는 선, 길이는 손톱 오른쪽에 손톱 끝~큐티클을 잇는 선.
 * 불안정할 때는 서버가 measure를 보내지 않아 아무것도 그리지 않는다.
 */
export function TopViewNailMeasure({ guide, measure }: TopViewNailMeasureProps) {
  const [boxRef, box] = useBoxSize<HTMLDivElement>()
  const canDraw = guide !== null && measure !== null && box.w > 0 && box.h > 0

  let content = null
  if (canDraw) {
    const map = coverMap(box.w, box.h, guide.aspect)
    const cx = map.x(measure.tipX)
    const tipY = map.y(measure.tipY)
    const cutY = map.y(measure.cuticleY)
    const half = measure.halfW * map.scale
    const midY = (tipY + cutY) / 2
    const lenX = cx + half + LENGTH_GAP_PX

    content = (
      // 불안정 → 안정이 될 때마다 새로 붙어서 등장 애니메이션이 다시 돈다
      <div className="hand-scan-measure__layer">
        <svg className="hand-scan-measure__svg" width={box.w} height={box.h} aria-hidden="true">
          {/* 너비: 손톱 가운데 높이 */}
          <g className="hand-scan-measure__dim">
            <line x1={cx - half} x2={cx + half} y1={midY} y2={midY} className="hand-scan-measure__halo" />
            <line x1={cx - half} x2={cx - half} y1={midY - TICK_PX} y2={midY + TICK_PX} className="hand-scan-measure__halo" />
            <line x1={cx + half} x2={cx + half} y1={midY - TICK_PX} y2={midY + TICK_PX} className="hand-scan-measure__halo" />
            <line x1={cx - half} x2={cx + half} y1={midY} y2={midY} className="hand-scan-measure__line" />
            <line x1={cx - half} x2={cx - half} y1={midY - TICK_PX} y2={midY + TICK_PX} className="hand-scan-measure__line" />
            <line x1={cx + half} x2={cx + half} y1={midY - TICK_PX} y2={midY + TICK_PX} className="hand-scan-measure__line" />
          </g>
          {/* 길이: 손톱 끝 ~ 큐티클, 손톱 오른쪽 */}
          <g className="hand-scan-measure__dim hand-scan-measure__dim--length">
            <line x1={lenX} x2={lenX} y1={tipY} y2={cutY} className="hand-scan-measure__halo" />
            <line x1={lenX - TICK_PX} x2={lenX + TICK_PX} y1={tipY} y2={tipY} className="hand-scan-measure__halo" />
            <line x1={lenX - TICK_PX} x2={lenX + TICK_PX} y1={cutY} y2={cutY} className="hand-scan-measure__halo" />
            <line x1={lenX} x2={lenX} y1={tipY} y2={cutY} className="hand-scan-measure__line" />
            <line x1={lenX - TICK_PX} x2={lenX + TICK_PX} y1={tipY} y2={tipY} className="hand-scan-measure__line" />
            <line x1={lenX - TICK_PX} x2={lenX + TICK_PX} y1={cutY} y2={cutY} className="hand-scan-measure__line" />
          </g>
        </svg>

        <div
            className="hand-scan-measure__label hand-scan-measure__label--width"
            style={{ right: box.w - (cx - half - LABEL_GAP_PX), top: midY }}
        >
          <span className="hand-scan-measure__name">너비</span>
          <span className="hand-scan-measure__value">{fmt(measure.widthMm)}<small>mm</small></span>
        </div>
        <div
            className="hand-scan-measure__label hand-scan-measure__label--length"
            style={{ left: lenX + TICK_PX + LABEL_GAP_PX, top: (tipY + cutY) / 2 }}
        >
          <span className="hand-scan-measure__name">길이</span>
          <span className="hand-scan-measure__value">{fmt(measure.lengthMm)}<small>mm</small></span>
        </div>
      </div>
    )
  }

  return (
    <div ref={boxRef} className="hand-scan-measure" aria-live="polite">
      {content}
      {canDraw ? (
        <span className="hand-scan-measure__sr">
          {`손톱 너비 ${fmt(measure.widthMm)}밀리미터, 길이 ${fmt(measure.lengthMm)}밀리미터`}
        </span>
      ) : null}
    </div>
  )
}
