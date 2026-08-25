import { memo } from 'react'
import { NextStepButton } from '@/shared/components/NextStepButton'
import { Icon } from '@/features/mypage/shared'

type EmptyStateProps = {
    icon: keyof typeof Icon
    title: string
    description: string
    actionLabel?: string
    onAction?: () => void
}

export const EmptyState = memo(function EmptyState({ icon, title, description, actionLabel, onAction }: EmptyStateProps) {
    return (
        <div className="mypage-x__empty-state">
            <span className="mypage-x__empty-icon" aria-hidden="true">{Icon[icon]}</span>
            <p className="mypage-x__empty-title">{title}</p>
            <p className="mypage-x__empty-desc">{description}</p>
            {actionLabel && onAction && <NextStepButton label={actionLabel} onClick={onAction} />}
        </div>
    )
})
