import { memo } from 'react'
import { type PrintOrderResponse as NailTipPrintOrder } from '@/entities/print/api'
import { SHAPE_PREVIEW_IMAGES } from '@/shared/constants/designPreferences'
import { PRINT_STATUS_LABEL, Icon, formatDateTimeFull } from '@/features/mypage/shared'

type PrintOrderRowProps = {
    order: NailTipPrintOrder
    activityId?: string
    interactive?: boolean
    activeActivityId: string | null
    onOpenDetail: (order: NailTipPrintOrder) => void | Promise<void>
    onSelectActivity: (id: string) => void
    onHoverActivity: (id: string | null) => void
}

export const PrintOrderRow = memo(function PrintOrderRow({
    order,
    activityId: activityIdProp,
    interactive,
    activeActivityId,
    onOpenDetail,
    onSelectActivity,
    onHoverActivity,
}: PrintOrderRowProps) {
    const activityId = activityIdProp ?? `print-${order.id}`
    const highlighted = interactive ? activeActivityId === activityId : false
    const timeLabel = formatDateTimeFull(order.orderedAt)

    return (
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
                <p className="mypage-x__print-shape">{order.shapeLabelKo} 네일팁 출력</p>
            </div>
            <div className="mypage-x__print-meta-end">
                <span className={`mypage-x__badge mypage-x__badge--${order.status.toLowerCase()}`}>
                    {PRINT_STATUS_LABEL[order.status]}
                </span>
                {timeLabel && <span className="mypage-x__item-meta">{timeLabel}</span>}
            </div>
        </button>
    )
})
