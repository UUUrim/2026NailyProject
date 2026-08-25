import { useEffect, useRef, type ReactNode } from 'react'

type ScrollRevealProps = {
  children: ReactNode
  className?: string
  delay?: number
}

export function ScrollReveal({ children, className = '', delay = 0 }: ScrollRevealProps) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = ref.current
    if (!el) return

    const reveal = () => {
      el.style.setProperty('--reveal-delay', `${delay}ms`)
      el.classList.add('is-visible')
    }

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          reveal()
          observer.unobserve(el)
        }
      },
      { threshold: 0.15, rootMargin: '0px 0px -6% 0px' },
    )

    observer.observe(el)

    requestAnimationFrame(() => {
      const rect = el.getBoundingClientRect()
      if (rect.top < window.innerHeight * 0.92 && rect.bottom > 0) {
        reveal()
        observer.unobserve(el)
      }
    })

    return () => observer.disconnect()
  }, [delay])

  return (
    <div ref={ref} className={`scroll-reveal${className ? ` ${className}` : ''}`}>
      {children}
    </div>
  )
}
