import { useEffect, useRef, useState } from 'react'

/** 요소의 현재 크기(px) — 카메라 화면 위 오버레이를 영상 좌표에 맞춰 그릴 때 쓴다. */
export function useBoxSize<T extends HTMLElement>() {
  const ref = useRef<T | null>(null)
  const [box, setBox] = useState({ w: 0, h: 0 })

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const update = () => setBox({ w: el.clientWidth, h: el.clientHeight })
    update()
    const observer = new ResizeObserver(update)
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  return [ref, box] as const
}
