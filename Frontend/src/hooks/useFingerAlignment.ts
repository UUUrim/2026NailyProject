import { useEffect, useState, type RefObject } from 'react'
import { isDualFeedAligned } from '@/utils/fingerAlignment'

const CHECK_INTERVAL_MS = 180
const ALIGN_FRAMES_REQUIRED = 7
const UNALIGN_FRAMES_REQUIRED = 4

export function useFingerAlignment(
  active: boolean,
  leftVideoRef: RefObject<HTMLVideoElement | null>,
  rightVideoRef: RefObject<HTMLVideoElement | null>,
  resetKey: number,
) {
  const [isAligned, setIsAligned] = useState(false)

  useEffect(() => {
    setIsAligned(false)
  }, [resetKey])

  useEffect(() => {
    if (!active) {
      setIsAligned(false)
      return
    }

    let alignedStreak = 0
    let unalignedStreak = 0
    let cancelled = false

    const tick = () => {
      if (cancelled) return

      const aligned = isDualFeedAligned(leftVideoRef.current, rightVideoRef.current)

      if (aligned) {
        alignedStreak++
        unalignedStreak = 0
        if (alignedStreak >= ALIGN_FRAMES_REQUIRED) {
          setIsAligned(true)
        }
      } else {
        unalignedStreak++
        alignedStreak = 0
        if (unalignedStreak >= UNALIGN_FRAMES_REQUIRED) {
          setIsAligned(false)
        }
      }
    }

    const id = window.setInterval(tick, CHECK_INTERVAL_MS)
    return () => {
      cancelled = true
      window.clearInterval(id)
    }
  }, [active, leftVideoRef, rightVideoRef, resetKey])

  return isAligned
}
