import { useEffect, useRef, useState } from 'react'
import { Icon } from '@/features/mypage/shared'

type RowActionMenuProps = {
    // horizontal = ⋯ (손 분석 기록 카드), vertical = ⋮ (네일 팁 출력 카드)
    orientation: 'horizontal' | 'vertical'
    // 더보기 버튼의 스크린리더용 이름 (예: "2026. 10. 17. 14:20 손 분석 기록 메뉴")
    triggerLabel: string
    // 드롭다운의 삭제 항목 (예: "분석 기록 삭제하기")
    deleteLabel: string
    onDelete: () => void
}

// 목록 카드의 더보기 버튼 — 누르면 삭제 항목이 드롭다운으로 뜨고, 그 항목을 누르면 onDelete(삭제 확인 창)를 부른다.
// 바깥을 누르거나 Esc를 누르면 닫힌다.
export function RowActionMenu({ orientation, triggerLabel, deleteLabel, onDelete }: RowActionMenuProps) {
    const [open, setOpen] = useState(false)
    const ref = useRef<HTMLDivElement | null>(null)
    const triggerRef = useRef<HTMLButtonElement | null>(null)
    const itemRef = useRef<HTMLButtonElement | null>(null)
    // 키보드(Enter/Space)로 열었을 때만 삭제 항목으로 초점을 옮긴다 — 마우스로 열면 항목에 초점 테두리가 뜨지 않게
    const openedByKeyboardRef = useRef(false)

    useEffect(() => {
        if (!open) return
        if (openedByKeyboardRef.current) itemRef.current?.focus()
        const onPointerDown = (e: MouseEvent) => {
            if (!ref.current?.contains(e.target as Node)) setOpen(false)
        }
        const onKeyDown = (e: KeyboardEvent) => {
            if (e.key !== 'Escape') return
            setOpen(false)
            triggerRef.current?.focus()
        }
        document.addEventListener('mousedown', onPointerDown)
        document.addEventListener('keydown', onKeyDown)
        return () => {
            document.removeEventListener('mousedown', onPointerDown)
            document.removeEventListener('keydown', onKeyDown)
        }
    }, [open])

    return (
        <div className={`mypage-x__row-menu${open ? ' is-open' : ''}`} ref={ref}>
            <button
                ref={triggerRef}
                type="button"
                className="mypage-x__row-menu-trigger"
                onClick={(e) => {
                    // 키보드로 누른 클릭은 detail이 0이다
                    openedByKeyboardRef.current = e.detail === 0
                    setOpen((prev) => !prev)
                }}
                aria-haspopup="menu"
                aria-expanded={open}
                aria-label={triggerLabel}
                title="더보기"
            >
                <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
                    {(orientation === 'horizontal' ? [6, 12, 18].map((x) => [x, 12]) : [6, 12, 18].map((y) => [12, y])).map(
                        ([cx, cy]) => (
                            <circle key={`${cx}-${cy}`} cx={cx} cy={cy} r="1.7" fill="currentColor" />
                        ),
                    )}
                </svg>
            </button>
            {open && (
                <div className="mypage-x__row-menu-list" role="menu">
                    <button
                        ref={itemRef}
                        type="button"
                        role="menuitem"
                        className="mypage-x__row-menu-item mypage-x__row-menu-item--danger"
                        onClick={() => {
                            setOpen(false)
                            onDelete()
                        }}
                    >
                        {Icon.trash}
                        <span>{deleteLabel}</span>
                    </button>
                </div>
            )}
        </div>
    )
}
