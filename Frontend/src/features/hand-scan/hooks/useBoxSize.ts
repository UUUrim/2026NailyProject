import { useEffect, useRef, useState } from 'react'

/**
 * 요소의 현재 크기(px, 소수점까지) — 카메라 화면 위 오버레이를 영상 좌표에 맞춰 그릴 때 쓴다.
 * 레이아웃 크기라 CSS transform(탑뷰 영상 확대)의 영향을 받지 않는다.
 */
export function useBoxSize<T extends HTMLElement>() {
  const ref = useRef<T | null>(null)
  const [box, setBox] = useState({ w: 0, h: 0 })

  useEffect(() => {
    const el = ref.current
    if (!el) return
    // contentRect는 소수점까지 준다 — clientWidth/Height는 정수로 반올림돼서, 화면 칸이 278.53px처럼
    // 소수일 때 탑뷰 영상 확대 계산이 칸 끝에 소수점 픽셀만큼 못 미쳐 가는 선이 비쳤다.
    // 관찰을 시작하면 지금 크기로 한 번 바로 불린다.
    const observer = new ResizeObserver(([entry]) => {
      setBox({ w: entry.contentRect.width, h: entry.contentRect.height })
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  return [ref, box] as const
}
