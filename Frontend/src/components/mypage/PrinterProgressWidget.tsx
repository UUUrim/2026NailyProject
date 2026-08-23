import { useEffect, useRef, useState } from 'react'
import { getPrinterProgress, type PrinterProgress } from '@/apis/prints'
import '@/styles/print.css'

const STATE_LABEL_KO: Record<string, string> = {
    IDLE: '대기 중',
    PREPARE: '준비 중',
    CALIBRATING_EXTRUSION: '필라멘트 보정 중',
    PRINTING: '출력 중',
    PAUSE: '일시정지',
    FINISH: '출력 완료',
    UNKNOWN: '상태 확인 중',
}

/**
 * 프린터 실시간 진행 상황 위젯. 마운트되면 5초 간격으로 /users/me/prints/progress를
 * 폴링해서 진행률 바 + 온도 + 남은 시간을 보여준다.
 * PrintOrder.status가 PRINTING일 때 마이페이지/출력 페이지에서 이 컴포넌트를 띄우면 된다.
 */
export function PrinterProgressWidget() {
    const [progress, setProgress] = useState<PrinterProgress | null>(null)
    const [error, setError] = useState<string | null>(null)
    const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

    useEffect(() => {
        let cancelled = false

        const poll = async () => {
            try {
                const data = await getPrinterProgress()
                if (cancelled) return
                if (!data.success) {
                    setError(data.message ?? '프린터 상태를 가져오지 못했어요.')
                    return
                }
                setError(null)
                setProgress(data)
            } catch {
                if (!cancelled) setError('프린터 상태를 가져오지 못했어요.')
            }
        }

        void poll()
        intervalRef.current = setInterval(poll, 5000)

        return () => {
            cancelled = true
            if (intervalRef.current) clearInterval(intervalRef.current)
        }
    }, [])

    if (error) {
        return (
            <div className="printer-progress printer-progress--error">
                <p>{error}</p>
            </div>
        )
    }

    if (!progress) {
        return (
            <div className="printer-progress printer-progress--loading">
                <p>프린터 상태를 불러오는 중...</p>
            </div>
        )
    }

    const pct = progress.percentage ?? 0
    const stateLabel = progress.state ? (STATE_LABEL_KO[progress.state] ?? progress.state) : '알 수 없음'

    return (
        <div className="printer-progress">
            <div className="printer-progress__head">
                <span className="printer-progress__state">{stateLabel}</span>
                <span className="printer-progress__percentage">{pct}%</span>
            </div>

            <div className="printer-progress__bar" aria-hidden="true">
                <span style={{ width: `${pct}%` }} />
            </div>

            <div className="printer-progress__meta">
                {progress.remainingTimeMin != null && (
                    <span>남은 시간 약 {progress.remainingTimeMin}분</span>
                )}
                {progress.nozzleTemp != null && (
                    <span>노즐 {progress.nozzleTemp.toFixed(1)}°C</span>
                )}
                {progress.bedTemp != null && (
                    <span>베드 {progress.bedTemp.toFixed(1)}°C</span>
                )}
            </div>
        </div>
    )
}