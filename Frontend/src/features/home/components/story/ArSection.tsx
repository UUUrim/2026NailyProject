import type { CSSProperties } from 'react'
import { StoryFeature } from '@/features/home/components/story/StoryFeature'
import { DESIGN_DEMO, STORY_STEPS } from '@/features/home/constants/home'

// 채팅 데모에서 완성한 디자인(06.png)의 네일 팁 5개를 모양 그대로 오려 둔 이미지 —
// 흰 바닥과 그림자는 지우고 팁만 남겨, 손에 붙이기 좋게 끝이 위로 가도록 180° 돌려 저장했다 (왼쪽 팁부터 1~5).
// 왼쪽 팁부터 엄지 · 검지 · 중지 · 약지 · 새끼에 붙인다
const TIP_BY_FINGER = { thumb: 1, index: 2, middle: 3, ring: 4, pinky: 5 } as const
const tipImage = (n: number) => `/images/showcase/ar-tips/06-${n}.webp`

// hands.png(1320×800) 왼손 손톱 위치(%)·크기(%)·기울기(deg) — 새끼 → 엄지
const HAND_NAILS = [
  { finger: 'pinky', x: 10.6, y: 25.6, w: 2.4, h: 5.2, r: -20 },
  { finger: 'ring', x: 16.2, y: 13.2, w: 2.85, h: 5.9, r: -15 },
  { finger: 'middle', x: 26, y: 7.3, w: 2.85, h: 6.3, r: 2 },
  { finger: 'index', x: 35.4, y: 13.3, w: 2.85, h: 5.9, r: 12 },
  { finger: 'thumb', x: 42.6, y: 41, w: 3.05, h: 6.3, r: 24 },
] as const

const HAND_ASPECT = 800 / 1320

// 팁 폭 = 손톱 폭보다 살짝 넓게 (손톱을 다 덮도록)
const TIP_WIDTH_SCALE = 1.1

/**
 * 팁 하나를 손톱 위에 놓는다. 팁 그림의 아래 가운데(큐티클 쪽)를 손톱 뿌리에 맞추고
 * 손가락 기울기만큼 돌린다 — 팁은 자르지 않고 통째로 쓰므로 손끝 위로 길게 뻗는다.
 */
function tipStyle(nailIndex: number): CSSProperties {
  const nail = HAND_NAILS[nailIndex]
  const radians = (nail.r * Math.PI) / 180
  // 손톱 길이의 절반만큼 손가락 아래쪽(손목 방향)으로 내려간 점 = 손톱 뿌리 (캔버스 폭 기준 좌표로 계산)
  const halfLength = (nail.h / 100) * HAND_ASPECT * 0.5
  const baseX = nail.x / 100 - Math.sin(radians) * halfLength
  const baseY = (nail.y / 100) * HAND_ASPECT + Math.cos(radians) * halfLength

  return {
    left: `${baseX * 100}%`,
    top: `${(baseY / HAND_ASPECT) * 100}%`,
    width: `${nail.w * TIP_WIDTH_SCALE}%`,
    '--tip-rotate': `${nail.r}deg`,
    '--tip-delay': `${0.35 + nailIndex * 0.12}s`,
  } as CSSProperties
}

function ArDemo() {
  return (
    <div className="ar-demo">
      <span className="ar-demo__live">
        <i />
        LIVE
      </span>

      {/* 손 그림은 배경과 multiply로 섞어야 해서, 같은 흔들림 애니메이션을 가진 별도 층에 둔다 */}
      <div className="ar-demo__hand ar-demo__hand--image">
        <img src="/images/hands.png" alt="" draggable={false} />
      </div>

      <div className="ar-demo__hand">
        {HAND_NAILS.map((nail, nailIndex) => (
          <img
            key={nail.finger}
            src={tipImage(TIP_BY_FINGER[nail.finger])}
            alt=""
            className="ar-demo__tip"
            style={tipStyle(nailIndex)}
            draggable={false}
          />
        ))}
      </div>

      {/* 적용 중인 디자인 — 오른쪽 아래에 이미지만 */}
      <span className="ar-demo__design">
        <img src={DESIGN_DEMO.image} alt="" />
      </span>
    </div>
  )
}

export function ArSection() {
  return (
    <StoryFeature
      step={STORY_STEPS[3]}
      reverse
      title={
        <>
          바르기 전에,
          <br />
          내 손에 미리 입혀보기
        </>
      }
      description="카메라에 손등을 비추면 손가락을 실시간으로 따라가며, 만든 디자인을 내 손톱 위에 그대로 보여줘요."
      points={['미리 확인하는 네일 디자인', '손 움직임을 따라가는 실시간 추적', '앱 설치 없이 브라우저 카메라로']}
      renderMedia={() => <ArDemo />}
    />
  )
}
