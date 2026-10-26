import { canReprintOrder, type PrintOrderResponse } from '@/entities/print/api'
import '@/styles/print.css'

type Props = {
    order: PrintOrderResponse
    busy: boolean
    error: string | null
    // 같은 설정으로 새 주문을 만든다 (성공하면 상세 화면이 새 주문으로 바뀐다)
    onReprint: (order: PrintOrderResponse) => void
}

/**
 * "이 설정으로 재출력" 버튼 - 끝난 주문(완료/실패/취소)의 진행 상태 카드 아래에 둔다.
 * 쉐입, 연장 길이, 손 분석 기록이 같은 새 출력 주문을 만든다 (주문 번호는 새로 생긴다).
 */
export function PrintReprintAction({ order, busy, error, onReprint }: Props) {
    const canReprint = canReprintOrder(order)

    return (
        <div className="print-actions print-actions--reprint">
            <div className="print-actions__row">
                <button
                    type="button"
                    className="print-actions__btn print-actions__btn--primary"
                    disabled={!canReprint || busy}
                    onClick={() => onReprint(order)}
                >
                    <svg className="print-actions__icon" viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" focusable="false">
                        <path
                            d="M14.3 10.29A6.7 6.7 0 1 1 13.74 4.55M13.74 1.3v3.25h-3.4"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2.4"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                        />
                    </svg>
                    {busy ? '신청 중…' : '이 설정으로 재출력'}
                </button>
            </div>
            <p className="print-actions__hint">
                {canReprint
                    ? '쉐입, 연장 길이, 손 분석 기록이 같은 새 출력으로 신청돼요.'
                    : '손 분석 기록이 없는 예전 주문은 재출력할 수 없어요.'}
            </p>
            {error && (
                <p className="print-actions__error" role="alert">
                    {error}
                </p>
            )}
        </div>
    )
}
