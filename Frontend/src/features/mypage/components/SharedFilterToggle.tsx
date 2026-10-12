import { memo } from 'react'
import { ModalActionIcons } from '@/shared/components/ModalActionIcons'

type SharedFilterToggleProps = {
    active: boolean
    onToggle: () => void
}

/** 디자인 목록에서 "둘러보기에 공유한 디자인만" 모아 보는 토글 칩 (정렬 버튼 왼쪽에 놓인다) */
export const SharedFilterToggle = memo(function SharedFilterToggle({ active, onToggle }: SharedFilterToggleProps) {
    return (
        <button
            type="button"
            className={`mypage-x__filter-chip${active ? ' is-active' : ''}`}
            onClick={onToggle}
            aria-pressed={active}
        >
            <span className="mypage-x__filter-chip-icon" aria-hidden="true">{ModalActionIcons.share}</span>
            <span>공유한 디자인</span>
        </button>
    )
})
