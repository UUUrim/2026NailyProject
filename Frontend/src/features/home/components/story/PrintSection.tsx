import { useState, type CSSProperties } from 'react'
import { StoryFeature } from '@/features/home/components/story/StoryFeature'
import { STORY_STEPS } from '@/features/home/constants/home'
import { NAIL_SHAPE_MAP, type NailShapeId } from '@/shared/constants/nailShapes'

// 위에서 내려다본 네일 팁 외곽선 (viewBox 0 -20 100 190, 아래쪽 큐티클 라인은 모두 같다)
const CUTICLE = 'L96 140 C96 160 78 166 50 166 C22 166 4 160 4 140 Z'

// 실제 쉐입 사진 기준 — 라운드·오벌은 짧은 자연 손톱, 아몬드·스틸레토·발레리나·스퀘어는 길게 연장한 팁
const TIP_PATHS: Record<NailShapeId, string> = {
  // 나란한 옆선 + 손끝을 따라 둥근 반원
  round: `M4 140 L4 66 A46 42 0 0 1 96 66 ${CUTICLE}`,
  // 라운드보다 길고, 끝으로 갈수록 갸름해지는 달걀형
  oval: `M4 140 L4 88 C4 40 26 4 50 4 C74 4 96 40 96 88 ${CUTICLE}`,
  // 손톱 바닥부터는 나란하다가 끝으로 좁아져 둥글게 뾰족한 끝
  almond: `M4 140 L4 90 C4 50 32 -8 50 -8 C68 -8 96 50 96 90 ${CUTICLE}`,
  // 가장 길고, 옆선이 곧게 모여 날카로운 끝
  stiletto: `M4 140 L4 100 C4 62 38 8 50 -18 C62 8 96 62 96 100 ${CUTICLE}`,
  // 바닥에서 곧게 좁아지다가 끝은 평평하게 자른 관 모양
  ballerina: `M4 140 Q4 110 8 84 L22 -2 Q24 -10 32 -10 L68 -10 Q76 -10 78 -2 L92 84 Q96 110 96 140 ${CUTICLE}`,
  // 나란한 옆선 + 일자로 반듯한 끝
  square: `M4 140 L4 10 Q4 0 14 0 L86 0 Q96 0 96 10 ${CUTICLE}`,
}

// 출력되는 쉐입 순서 — 한 판이 끝날 때마다 다음 쉐입으로 넘어간다
const PRINT_ORDER: NailShapeId[] = ['round', 'oval', 'almond', 'stiletto', 'ballerina', 'square']
const PRINT_SHAPES = PRINT_ORDER.map((id) => NAIL_SHAPE_MAP[id])

// 다섯 개 팁의 크기 비율 — 큰 것부터 왼쪽에 놓는다
const TIP_SCALES = [1.2, 1.06, 1, 0.95, 0.8]

function PrintDemo() {
  const [shapeIndex, setShapeIndex] = useState(0)
  const shape = PRINT_SHAPES[shapeIndex]

  // 한 판 출력이 끝날 때마다(빌드 애니메이션 한 바퀴) 다음 쉐입으로 바꿔 다시 출력한다
  const handleCycle = () => setShapeIndex((prev) => (prev + 1) % PRINT_SHAPES.length)

  return (
    <div className="print-demo">
      <svg className="print-demo__defs" aria-hidden="true">
        <defs>
          <pattern id="print-demo-layers" width="4" height="3.2" patternUnits="userSpaceOnUse">
            <rect y="2.4" width="4" height="0.8" fill="rgba(200, 102, 133, 0.12)" />
          </pattern>
        </defs>
      </svg>

      <div className="print-demo__top">
        <span className="print-demo__shape" key={shape.id}>
          {shape.labelKo}
          <em>{shape.labelEn}</em>
        </span>
        <span className="print-demo__percent" />
      </div>

      <div className="print-demo__stage">
        <div className="print-demo__build" onAnimationIteration={handleCycle}>
          {TIP_SCALES.map((scale, index) => (
            <svg
              key={index}
              className="print-demo__tip"
              viewBox="0 -20 100 190"
              style={{ '--tip-scale': scale } as CSSProperties}
            >
              <path d={TIP_PATHS[shape.id]} className="print-demo__tip-fill" />
              <path d={TIP_PATHS[shape.id]} fill="url(#print-demo-layers)" />
              <path d={TIP_PATHS[shape.id]} className="print-demo__tip-edge" />
            </svg>
          ))}
        </div>

        <div className="print-demo__head-track">
          <span className="print-demo__head">
            <span className="print-demo__nozzle" />
          </span>
        </div>

        <span className="print-demo__plate" />
      </div>

      <span className="print-demo__progress">
        <span />
      </span>
    </div>
  )
}

export function PrintSection() {
  return (
    <StoryFeature
      step={STORY_STEPS[1]}
      reverse
      title={
        <>
          측정한 그대로,
          <br />
          내 손톱에 맞는 팁으로
        </>
      }
      description="측정값을 기반으로 맞춤형 네일 팁을 만들어요. 쉐입과 길이를 고르면 3D 프린터가 출력해요."
      points={['열 손톱 각각의 크기 · 곡률 반영', '6가지 쉐입과 원하는 연장 길이 선택', '셀프 네일아트의 베이스가 되는 반투명 팁']}
      renderMedia={() => <PrintDemo />}
    />
  )
}
