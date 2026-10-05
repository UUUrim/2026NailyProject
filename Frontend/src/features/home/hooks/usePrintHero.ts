import { useCallback, useEffect, useRef, useState } from 'react'
import { PrintHeroEngine, type PrintPhase } from '@/features/home/utils/printHeroEngine'

export function usePrintHero() {
    const rootRef = useRef<HTMLElement>(null)
    const engineRef = useRef<PrintHeroEngine | null>(null)
    const [phase, setPhase] = useState<PrintPhase>('loading')
    const [revealed, setRevealed] = useState(false)

    useEffect(() => {
        const root = rootRef.current
        if (!root) return

        const engine = PrintHeroEngine.mount(root, {
            onPhaseChange: setPhase,
            onReveal: () => setRevealed(true),
        })
        engineRef.current = engine

        return () => {
            engine?.destroy()
            engineRef.current = null
        }
    }, [])

    const replay = useCallback(() => {
        engineRef.current?.replay()
    }, [])

    return { rootRef, phase, revealed, replay }
}
