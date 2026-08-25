import { memo, useEffect, useRef, useState } from 'react'
import { Icon } from '@/features/mypage/shared'

export type SortOrder = 'newest' | 'oldest'

type SortControlProps = {
    value: SortOrder
    onChange: (order: SortOrder) => void
}

export const SortControl = memo(function SortControl({ value, onChange }: SortControlProps) {
    const [open, setOpen] = useState(false)
    const ref = useRef<HTMLDivElement | null>(null)

    useEffect(() => {
        if (!open) return
        const onPointerDown = (e: MouseEvent) => {
            if (!ref.current?.contains(e.target as Node)) setOpen(false)
        }
        document.addEventListener('mousedown', onPointerDown)
        return () => document.removeEventListener('mousedown', onPointerDown)
    }, [open])

    return (
        <div className="mypage-x__sort" ref={ref}>
            <button
                type="button"
                className={`mypage-x__sort-trigger${open ? ' is-open' : ''}`}
                onClick={() => setOpen((prev) => !prev)}
                aria-haspopup="listbox"
                aria-expanded={open}
            >
                <span>{value === 'newest' ? '최신순' : '오래된순'}</span>
                <span className="mypage-x__sort-caret" aria-hidden="true">{Icon.chevron}</span>
            </button>
            {open && (
                <div className="mypage-x__sort-menu" role="listbox">
                    <button
                        type="button"
                        role="option"
                        aria-selected={value === 'newest'}
                        className={`mypage-x__sort-option${value === 'newest' ? ' is-selected' : ''}`}
                        onClick={() => {
                            onChange('newest')
                            setOpen(false)
                        }}
                    >
                        최신순
                    </button>
                    <button
                        type="button"
                        role="option"
                        aria-selected={value === 'oldest'}
                        className={`mypage-x__sort-option${value === 'oldest' ? ' is-selected' : ''}`}
                        onClick={() => {
                            onChange('oldest')
                            setOpen(false)
                        }}
                    >
                        오래된순
                    </button>
                </div>
            )}
        </div>
    )
})
