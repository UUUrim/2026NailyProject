import { useEffect, useState } from 'react'
import { ApiError } from '@/shared/utils/apiClient'
import {
    cancelPrintOrder,
    pausePrintOrder,
    resumePrintOrder,
    type PrintOrderResponse,
} from '@/entities/print/api'
import { describeActionError } from '@/features/mypage/shared'
import '@/styles/print.css'

// 이 주문에 대한 프린터의 상태 — 진행 상황 위젯이 5초마다 확인한 값
//  running: 이 주문을 출력 중 / paused: 이 주문이 일시정지 중 / other: 그 외(예열 중, 다른 주문 처리 중, 상태 모름)
export type PrinterStateForOrder = 'running' | 'paused' | 'other'

type Props = {
    orderId: number
    orderStatus: PrintOrderResponse['status']
    // 넘기면 일시정지/재개 버튼도 보인다 (프린터 상태를 알 때만 쓸 수 있다). 안 넘기면 취소 버튼만.
    printerState?: PrinterStateForOrder
    // 요청이 성공했을 때 서버가 돌려준 주문 — 목록/상세에 바로 반영한다
    onUpdated?: (order: PrintOrderResponse) => void
}

const PAUSE_WAIT_MS = 20000

/**
 * 출력 주문의 취소 / 일시정지 / 재개 버튼.
 *  - 대기·병합 중인 주문: "출력 취소"만 (바로 취소됨)
 *  - 출력 중인 주문: 일시정지 ↔ 재개, 출력 취소 (취소하면 프린터가 멈출 때까지 "취소 중")
 *  - 취소 중(CANCELING): 모든 버튼을 막고 안내 문구만 보인다 (중복 요청 방지)
 */
export function PrintOrderActions({ orderId, orderStatus, printerState, onUpdated }: Props) {
    const [busy, setBusy] = useState(false) // 요청을 보내는 중
    const [awaiting, setAwaiting] = useState<'pause' | 'resume' | null>(null) // 요청은 갔고 프린터 상태에 반영되기를 기다리는 중
    const [confirmingCancel, setConfirmingCancel] = useState(false)
    const [error, setError] = useState<{ message: string; detail?: string } | null>(null)

    const showPauseControls = printerState !== undefined
    const canceling = orderStatus === 'CANCELING'
    const locked = busy || canceling

    // 일시정지/재개 요청이 프린터 상태에 아직 반영되지 않은 동안은 버튼을 막는다 (위젯이 5초마다 상태를 확인한다).
    // 반영되지 않아도 20초 뒤에는 풀어서 다시 누를 수 있게 한다.
    const waitingForPrinter =
        (awaiting === 'pause' && printerState !== 'paused') || (awaiting === 'resume' && printerState !== 'running')

    useEffect(() => {
        if (!awaiting) return
        const timer = setTimeout(() => setAwaiting(null), PAUSE_WAIT_MS)
        return () => clearTimeout(timer)
    }, [awaiting])

    const run = async (kind: 'pause' | 'resume' | 'cancel') => {
        if (busy) return
        setBusy(true)
        setError(null)
        try {
            const request = kind === 'pause' ? pausePrintOrder : kind === 'resume' ? resumePrintOrder : cancelPrintOrder
            const updated = await request(orderId)
            if (kind === 'cancel') setConfirmingCancel(false)
            else setAwaiting(kind)
            onUpdated?.(updated)
        } catch (e) {
            setError(
                e instanceof ApiError
                    ? describeActionError(e.message)
                    : { message: '요청을 처리하지 못했어요. 잠시 후 다시 시도해 주세요.' },
            )
        } finally {
            setBusy(false)
        }
    }

    const canPause = printerState === 'running'

    return (
        <div className="print-actions">
            {showPauseControls && (
                <div className="print-actions__row">
                    {printerState === 'paused' ? (
                        <button
                            type="button"
                            className="print-actions__btn"
                            disabled={locked || waitingForPrinter}
                            onClick={() => void run('resume')}
                        >
                            {waitingForPrinter ? '재개 중…' : '재개'}
                        </button>
                    ) : (
                        <button
                            type="button"
                            className="print-actions__btn"
                            disabled={locked || waitingForPrinter || !canPause}
                            title={canPause ? undefined : '출력이 시작된 뒤에 일시정지할 수 있어요'}
                            onClick={() => void run('pause')}
                        >
                            {waitingForPrinter ? '일시정지 중…' : '일시정지'}
                        </button>
                    )}
                    {!confirmingCancel && (
                        <button
                            type="button"
                            className="print-actions__btn print-actions__btn--danger"
                            disabled={locked}
                            onClick={() => setConfirmingCancel(true)}
                        >
                            {canceling ? '취소 중…' : '출력 취소'}
                        </button>
                    )}
                </div>
            )}

            {!showPauseControls && !confirmingCancel && (
                <div className="print-actions__row">
                    <button
                        type="button"
                        className="print-actions__btn print-actions__btn--danger"
                        disabled={locked}
                        onClick={() => setConfirmingCancel(true)}
                    >
                        {canceling ? '취소 중…' : '출력 취소'}
                    </button>
                </div>
            )}

            {confirmingCancel && !canceling && (
                <div className="print-actions__confirm" role="alertdialog" aria-label="출력 취소 확인">
                    <p>
                        {showPauseControls
                            ? '출력을 멈추고 취소할까요? 이미 출력된 부분은 되돌릴 수 없어요.'
                            : '이 출력 신청을 취소할까요?'}
                    </p>
                    <div className="print-actions__row">
                        <button
                            type="button"
                            className="print-actions__btn print-actions__btn--danger"
                            disabled={busy}
                            onClick={() => void run('cancel')}
                        >
                            {busy ? '취소하는 중…' : '출력 취소'}
                        </button>
                        <button
                            type="button"
                            className="print-actions__btn"
                            disabled={busy}
                            onClick={() => setConfirmingCancel(false)}
                        >
                            돌아가기
                        </button>
                    </div>
                </div>
            )}

            {canceling && (
                <p className="print-actions__note">
                    취소하는 중이에요. 프린터가 멈출 때까지 잠시 기다려 주세요.
                </p>
            )}
            {error && (
                <div role="alert">
                    <p className="print-actions__error">{error.message}</p>
                    {error.detail && (
                        <details className="print-actions__error-detail">
                            <summary>자세히 보기</summary>
                            <code>{error.detail}</code>
                        </details>
                    )}
                </div>
            )}
        </div>
    )
}
