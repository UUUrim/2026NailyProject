import type { ReactNode } from 'react'
import { StoryFeature } from '@/features/home/components/story/StoryFeature'
import { STORY_STEPS } from '@/features/home/constants/home'

const TOP_VIEW_IMAGE = '/images/hand-scan/finger-top-view.png'
const SIDE_VIEW_IMAGE = '/images/hand-scan/finger-curvature.png'

const CORNERS = ['tl', 'tr', 'bl', 'br'] as const

const CheckIcon = (
  <svg viewBox="0 0 16 16" aria-hidden="true">
    <path d="m3.5 8.5 3 3 6-7" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
)

/** 카메라 한 대가 보는 영역 — 네 모서리에 둥근 표시가 측정 중엔 깜빡이고, 완료되면 초록으로 멈춘다 */
function ScanView({ children }: { children: ReactNode }) {
  return (
    <div className="scan-demo__view">
      {children}
      {CORNERS.map((corner) => (
        <span key={corner} className={`scan-demo__corner scan-demo__corner--${corner}`} />
      ))}
    </div>
  )
}

function ScanDemo() {
  return (
    <div className="scan-demo">
      {/* 실제 촬영 화면처럼 흰 화면 하나에 탑뷰(왼쪽)·곡률(오른쪽)을 나란히 — 스캔 선은 화면 전체를 한 줄로 훑는다 */}
      <div className="scan-demo__feed">
        <ScanView>
          {/* finger-top-view.png(454×379) 좌표로 손톱 너비·길이 치수선을 그린다 */}
          <div className="scan-demo__figure scan-demo__figure--top">
            <img src={TOP_VIEW_IMAGE} alt="" draggable={false} />
            <svg className="scan-demo__measure" viewBox="0 0 454 379">
              <path pathLength={1} d="M190 72 V96 M190 84 H260 M260 72 V96" />
              <path pathLength={1} className="scan-demo__measure-late" d="M213 40 H237 M225 40 V136 M213 136 H237" />
            </svg>
          </div>
        </ScanView>

        <ScanView>
          {/* finger-curvature.png(389×389) 좌표로 손톱 단면의 아랫면 곡선을 따라 그린다 */}
          <div className="scan-demo__figure scan-demo__figure--side">
            <img src={SIDE_VIEW_IMAGE} alt="" draggable={false} />
            <svg className="scan-demo__measure" viewBox="0 0 389 389">
              <path pathLength={1} d="M112 268 Q197 246 282 268" />
            </svg>
          </div>
        </ScanView>

        <span className="scan-demo__beam" />
      </div>

      <div className="scan-demo__result">
        <span className="scan-demo__pill scan-demo__pill--run">
          <span className="scan-demo__spinner" />
          측정 중
        </span>
        <span className="scan-demo__pill scan-demo__pill--done">
          <span className="scan-demo__done">
            {CheckIcon}
            측정 완료
          </span>
          <span className="scan-demo__divider" />
          <span className="scan-demo__values">
            <span>
              길이 <b>11.5</b>mm
            </span>
            <span>
              너비 <b>10.1</b>mm
            </span>
            <span>
              곡률 <b>2.3</b>mm
            </span>
          </span>
        </span>
      </div>
    </div>
  )
}

export function ScanSection() {
  return (
    <StoryFeature
      step={STORY_STEPS[0]}
      title={
        <>
          카메라 촬영으로
          <br />
          열 손톱을 정확하게
        </>
      }
      description="가이드에 맞춰 손을 비추기만 하면 돼요. 손톱마다 길이·너비·곡률을 mm 단위로 측정하고, 피부 톤까지 함께 분석해요."
      points={['손톱별 길이 · 너비 · 곡률 측정', '피부 톤에 어울리는 컬러 추천', '손 모양에 맞는 쉐입 추천']}
      renderMedia={() => <ScanDemo />}
    />
  )
}
