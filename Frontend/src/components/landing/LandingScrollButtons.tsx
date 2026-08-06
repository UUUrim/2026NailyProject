import { useEffect, useState } from 'react'

type ScrollPosition = 'top' | 'middle' | 'bottom'

const SCROLL_THRESHOLD = 24

function getScrollPosition(): ScrollPosition | null {
  const maxScroll = document.documentElement.scrollHeight - window.innerHeight

  if (maxScroll <= SCROLL_THRESHOLD) {
    return null
  }

  if (window.scrollY <= SCROLL_THRESHOLD) {
    return 'top'
  }

  if (window.scrollY >= maxScroll - SCROLL_THRESHOLD) {
    return 'bottom'
  }

  return 'middle'
}

function scrollToTop() {
  window.scrollTo({ top: 0, behavior: 'smooth' })
}

function scrollToBottom() {
  window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'smooth' })
}

export function LandingScrollButtons() {
  const [position, setPosition] = useState<ScrollPosition | null>(() => getScrollPosition())

  useEffect(() => {
    const update = () => {
      setPosition(getScrollPosition())
    }

    update()
    window.addEventListener('scroll', update, { passive: true })
    window.addEventListener('resize', update)

    return () => {
      window.removeEventListener('scroll', update)
      window.removeEventListener('resize', update)
    }
  }, [])

  if (!position) {
    return null
  }

  const showTop = position === 'middle' || position === 'bottom'
  const showBottom = position === 'middle' || position === 'top'

  return (
    <div className="landing-scroll-nav" aria-hidden={!showTop && !showBottom}>
      {showTop && (
        <button
          type="button"
          className="landing-scroll-nav__btn"
          onClick={scrollToTop}
          aria-label="맨 위로 이동"
        >
          <svg viewBox="0 0 16 16" aria-hidden="true">
            <path d="M8 3.5 3 10h10L8 3.5Z" fill="currentColor" />
          </svg>
        </button>
      )}
      {showBottom && (
        <button
          type="button"
          className="landing-scroll-nav__btn"
          onClick={scrollToBottom}
          aria-label="맨 아래로 이동"
        >
          <svg viewBox="0 0 16 16" aria-hidden="true">
            <path d="M8 12.5 3 6h10l-5 6.5Z" fill="currentColor" />
          </svg>
        </button>
      )}
    </div>
  )
}
