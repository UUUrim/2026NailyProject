import { useEffect, useState } from 'react'
import { prefersReducedMotion } from '@/features/home/hooks/useInView'

/**
 * 정해진 시각표대로 단계를 0 → 1 → … 로 올리고, 마지막 시각에 0으로 돌아가 반복한다.
 * timeline[i]는 i+1단계가 시작되는 시각(ms), 마지막 값은 한 바퀴의 길이다.
 * playing이 false면 처음 단계에 머문다. 동작 줄이기 설정이면 마지막 장면에 고정한다.
 */
export function useStepLoop(timeline: number[], playing: boolean) {
    const lastStep = timeline.length - 1
    const [reduced] = useState(prefersReducedMotion)
    const [step, setStep] = useState(0)

    useEffect(() => {
        if (reduced || !playing) return

        const timers: number[] = []
        const runCycle = () => {
            // 이전 바퀴의 타이머는 모두 실행된 뒤라(runCycle이 마지막 타이머) 비워도 된다
            timers.length = 0
            timeline.forEach((at, i) => {
                const next =
                    i === lastStep
                        ? () => {
                              setStep(0)
                              runCycle()
                          }
                        : () => setStep(i + 1)
                timers.push(window.setTimeout(next, at))
            })
        }
        runCycle()

        return () => {
            timers.forEach((id) => window.clearTimeout(id))
            setStep(0)
        }
    }, [reduced, playing, timeline, lastStep])

    if (reduced) return lastStep
    return playing ? step : 0
}
