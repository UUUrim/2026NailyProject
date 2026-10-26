import { useEffect, useRef, useState } from 'react'
import {
    getPrinterProgress,
    completePrintOrder,
    type PrinterProgress,
    type PrintOrderResponse,
} from '@/entities/print/api'
import { PrintOrderActions, type PrinterStateForOrder } from '@/features/mypage/components/PrintOrderActions'
import '@/styles/print.css'

const STATE_LABEL_KO: Record<string, string> = {
    IDLE: '대기 중',
    PREPARE: '준비 중',
    CALIBRATING_EXTRUSION: '필라멘트 보정 중',
    PRINTING: '출력 중',
    HEATBED_PREHEATING: '베드 예열 중',
    HEATING_NOZZLE: '노즐 예열 중',
    AUTO_BED_LEVELING: '베드 레벨링 중',
    CLEANING_NOZZLE_TIP: '노즐 청소 중',
    PAUSE: '일시정지',
    PAUSED_USER: '일시정지',
    FINISH: '출력 완료',
    UNKNOWN: '상태 확인 중',
}

/**
 * 프린터 실시간 진행 상황 위젯. 마운트되면 5초 간격으로 /users/me/prints/progress를
 * 폴링해서 진행률 바 + 온도 + 남은 시간을 보여주고, 일시정지/재개/취소 버튼을 함께 보여준다.
 * PrintOrder.status가 PRINTING(또는 취소 중인 CANCELING)일 때 마이페이지/출력 페이지에서 이 컴포넌트를 띄우면 된다.
 */

type Props = {
    orderId: number
    orderStatus: PrintOrderResponse['status']
    onComplete?: () => void
    onOrderUpdated?: (order: PrintOrderResponse) => void
}

export function PrinterProgressWidget({ orderId, orderStatus, onComplete, onOrderUpdated }: Props) {
    const [progress, setProgress] = useState<PrinterProgress | null>(null)
    const [error, setError] = useState<string | null>(null)
    const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
    const completedRef = useRef(false)
    // 이 주문이 실제로 출력되는 것(RUNNING)을 한 번이라도 본 적이 있는지 — 아래 완료 감지에서 쓴다
    const sawRunningRef = useRef(false)
    const statusRef = useRef(orderStatus)

    useEffect(() => {
        statusRef.current = orderStatus
    }, [orderStatus])

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

                // 프린터가 지금 처리 중인 주문이 이 주문일 때만 이 주문의 진행으로 본다
                const mine = data.currentOrderId === orderId
                if (mine && data.gcodeState === 'RUNNING') sawRunningRef.current = true

                // 완료 감지 (서버가 보내는 완료 콜백의 보조 수단).
                // 프린터는 직전 출력이 끝난 뒤에도 FINISH/진행률 100%를 들고 있어서, 그 값만 보고 완료로 바꾸면
                // 막 시작한 주문(또는 취소한 주문)이 완료로 잘못 표시된다. 그래서 (1) 이 주문이 처리 중이고
                // (2) 이 주문이 출력되는 것을 본 뒤에 (3) FINISH가 된 경우에만, (4) 취소 중이 아닐 때 완료로 본다.
                if (
                    !completedRef.current &&
                    statusRef.current === 'PRINTING' &&
                    mine &&
                    sawRunningRef.current &&
                    data.gcodeState === 'FINISH'
                ) {
                    completedRef.current = true
                    await completePrintOrder(orderId)
                    onComplete?.()
                }
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
    }, [orderId, onComplete])

    // 프린터 상태를 몰라도(불러오는 중/실패) 취소는 할 수 있어야 해서 버튼은 항상 보인다
    const mine = progress?.currentOrderId === orderId
    const printerState: PrinterStateForOrder =
        mine && progress?.gcodeState === 'PAUSE' ? 'paused' : mine && progress?.gcodeState === 'RUNNING' ? 'running' : 'other'
    const actions = (
        <PrintOrderActions
            orderId={orderId}
            orderStatus={orderStatus}
            printerState={printerState}
            onUpdated={onOrderUpdated}
        />
    )

    if (error) {
        return (
            <>
                <div className="printer-progress printer-progress--error">
                    <p>{error}</p>
                </div>
                {actions}
            </>
        )
    }

    if (!progress) {
        return (
            <>
                <div className="printer-progress printer-progress--loading">
                    <p>프린터 상태를 불러오는 중...</p>
                </div>
                {actions}
            </>
        )
    }

    const pct = progress.percentage ?? 0
    const stateLabel =
        orderStatus === 'CANCELING'
            ? '취소 중'
            : printerState === 'paused'
                ? '일시정지'
                : progress.state
                    ? (STATE_LABEL_KO[progress.state] ?? progress.state)
                    : '알 수 없음'

    return (
        <>
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
            {actions}
        </>
    )
}
