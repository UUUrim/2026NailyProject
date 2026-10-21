import { memo } from 'react'
import { type PrintOrderResponse as NailTipPrintOrder } from '@/entities/print/api'
import { SHAPE_PREVIEW_IMAGES } from '@/shared/constants/designPreferences'
import { PRINT_STATUS_LABEL, getDisplayPrintStatus, Icon, formatDateTimeFull, formatTipExtension } from '@/features/mypage/shared'
import { RowActionMenu } from '@/features/mypage/components/RowActionMenu'

type PrintOrderRowProps = {
    order: NailTipPrintOrder
    activityId?: string
    interactive?: boolean
    activeActivityId: string | null
    onOpenDetail: (order: NailTipPrintOrder) => void | Promise<void>
    onSelectActivity: (id: string) => void
    onHoverActivity: (id: string | null) => void
    // 출력 내역 탭 목록에서만 넘긴다 — 출력 중인 주문을 뺀 나머지에 ⋮ 메뉴(출력 내역 삭제하기)를 단다
    onDelete?: (order: NailTipPrintOrder) => void
}

export const PrintOrderRow = memo(function PrintOrderRow({
                                                             order,
                                                             activityId: activityIdProp,
                                                             interactive,
                                                             activeActivityId,
                                                             onOpenDetail,
                                                             onSelectActivity,
                                                             onHoverActivity,
                                                             onDelete,
                                                         }: PrintOrderRowProps) {
    const activityId = activityIdProp ?? `print-${order.id}`
    const highlighted = interactive ? activeActivityId === activityId : false
    const timeLabel = formatDateTimeFull(order.orderedAt)
    const displayStatus = getDisplayPrintStatus(order)

    const row = (
        <button
            key={order.id}
            type="button"
            data-activity-id={interactive ? activityId : undefined}
            data-activity-side={interactive ? 'right' : undefined}
            className={`mypage-x__print-row${highlighted ? ' is-highlighted' : ''}`}
            onMouseEnter={() => interactive && onHoverActivity(activityId)}
            onMouseLeave={() => interactive && onHoverActivity(null)}
            onClick={() => {
                if (interactive) onSelectActivity(activityId)
                void onOpenDetail(order)
            }}
        >
            <div className="mypage-x__print-icon" aria-hidden="true">
                {SHAPE_PREVIEW_IMAGES[order.shapeId] ? (
                    <img src={SHAPE_PREVIEW_IMAGES[order.shapeId]} alt="" />
                ) : (
                    Icon.print
                )}
            </div>
            <div className="mypage-x__scan-info">
                <p className="mypage-x__print-shape">{order.shapeLabelKo} 네일 팁 출력</p>
                <p className="mypage-x__print-length">
                    {order.tipExtensionMm != null && '연장 길이 '}
                    {formatTipExtension(order.tipExtensionMm)}
                </p>
            </div>
            <div className="mypage-x__print-meta-end">
                <span className={`mypage-x__badge mypage-x__badge--${displayStatus.toLowerCase()}`}>
                    {PRINT_STATUS_LABEL[displayStatus]}
                </span>
                {timeLabel && <span className="mypage-x__item-meta">{timeLabel}</span>}
            </div>
        </button>
    )

    if (!onDelete) return row

    // 카드 버튼 안에 버튼을 넣을 수 없어서 카드 오른쪽 끝(상태·날짜 옆)에 ⋮ 메뉴를 겹쳐 둔다.
    // 출력 중인 주문은 지울 수 없어 메뉴가 없지만, 상태·날짜가 다른 카드와 같은 자리에 오도록 그 자리는 비워 둔다.
    return (
        <div className="mypage-x__row-shell mypage-x__row-shell--print">
            {row}
            {order.status !== 'PRINTING' && (
                <RowActionMenu
                    orientation="vertical"
                    triggerLabel={`${order.shapeLabelKo} 네일 팁 출력 내역 메뉴`}
                    deleteLabel="출력 내역 삭제하기"
                    onDelete={() => onDelete(order)}
                />
            )}
        </div>
    )
})
