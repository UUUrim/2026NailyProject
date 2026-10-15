import { useEffect, useState, type RefObject } from 'react'

/** 요소가 화면에 들어와 있는지 — 화면 밖에 있는 섹션의 반복 애니메이션을 멈출 때 쓴다. */
export function useInView<T extends Element>(ref: RefObject<T | null>, rootMargin = '0px') {
    const [inView, setInView] = useState(false)

    useEffect(() => {
        const el = ref.current
        if (!el) return

        const observer = new IntersectionObserver(([entry]) => setInView(entry.isIntersecting), { rootMargin })
        observer.observe(el)
        return () => observer.disconnect()
    }, [ref, rootMargin])

    return inView
}

export function prefersReducedMotion() {
    return typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
}
