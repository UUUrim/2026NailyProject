import { memo, useEffect, useRef, useState } from 'react'
import { Icon } from '@/features/mypage/shared'

export type FolderSortOrder = 'name' | 'lastSaved'

type FolderSortControlProps = {
    value: FolderSortOrder
    onChange: (order: FolderSortOrder) => void
}

export const FolderSortControl = memo(function FolderSortControl({ value, onChange }: FolderSortControlProps) {
    const [open, setOpen] = useState(false)
    const ref = useRef<HTMLDivElement | null>(null)
    const label = value === 'name' ? '이름순' : '최근 저장순'

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
                <span>{label}</span>
                <span className="mypage-x__sort-caret" aria-hidden="true">{Icon.chevron}</span>
            </button>
            {open && (
                <div className="mypage-x__sort-menu" role="listbox">
                    {([
                        ['lastSaved', '최근 저장순'],
                        ['name', '이름순'],
                    ] as const).map(([optionValue, textLabel]) => (
                        <button
                            key={optionValue}
                            type="button"
                            role="option"
                            aria-selected={value === optionValue}
                            className={`mypage-x__sort-option${value === optionValue ? ' is-selected' : ''}`}
                            onClick={() => {
                                onChange(optionValue)
                                setOpen(false)
                            }}
                        >
                            {textLabel}
                        </button>
                    ))}
                </div>
            )}
        </div>
    )
})
