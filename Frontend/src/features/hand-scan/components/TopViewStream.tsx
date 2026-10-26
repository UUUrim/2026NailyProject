import { useBoxSize } from '@/features/hand-scan/hooks/useBoxSize'
import { topViewDisplayMap, type TopViewGuide } from '@/features/hand-scan/utils/topViewGuide'

type TopViewStreamProps = {
  src: string
  guide: TopViewGuide | null
}

/**
 * 탑뷰 스트림 <img> — 실제 지지대가 손가락 가이드 가운데에 오고 화면 끝이 비지 않도록
 * 화면에서만 확대·이동한다(topViewDisplayMap, CSS transform). 가이드와 W/L 표시도 같은
 * 계산으로 그려져 영상과 정확히 겹친다.
 *
 * 브라우저가 그리는 모습만 바뀐다 — 서버가 보내는 스트림 프레임, 측정, 저장 사진은 그대로다.
 * 마커를 못 잡아 guide가 없을 땐(서버가 크롭 없는 원본을 보냄) 손대지 않는다.
 */
export function TopViewStream({ src, guide }: TopViewStreamProps) {
  const [imgRef, box] = useBoxSize<HTMLImageElement>()
  const transform = guide !== null && box.w > 0 && box.h > 0
    ? topViewDisplayMap(box.w, box.h, guide).imageTransform
    : undefined

  return (
    <img
      ref={imgRef}
      src={src}
      className="hand-scan-fs__video hand-scan-fs__video--top"
      style={transform ? { transform } : undefined}
      alt="탑뷰 스캔 피드"
    />
  )
}
