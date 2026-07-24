import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

type CameraFeedSelectProps = {
  label: string
  value: string
  devices: MediaDeviceInfo[]
  onChange: (deviceId: string) => void
}

export function CameraFeedSelect({ label, value, devices, onChange }: CameraFeedSelectProps) {
  const [open, setOpen] = useState(false)
  const [menuPos, setMenuPos] = useState<{ top: number; left: number } | null>(null)
  const wrapRef = useRef<HTMLDivElement | null>(null)
  const triggerRef = useRef<HTMLButtonElement | null>(null)
  const menuRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    const handleOutsideClick = (e: MouseEvent) => {
      const target = e.target as Node
      if (wrapRef.current?.contains(target)) return
      if (menuRef.current?.contains(target)) return
      setOpen(false)
    }
    document.addEventListener('mousedown', handleOutsideClick)
    return () => document.removeEventListener('mousedown', handleOutsideClick)
  }, [])

  const openMenu = () => {
    const rect = triggerRef.current?.getBoundingClientRect()
    if (rect) {
      setMenuPos({ top: rect.bottom + 6, left: rect.left + rect.width / 2 })
    }
    setOpen((prev) => !prev)
  }

  const options = [
    { value: 'default', label: '기본 카메라' },
    ...devices.map((device, index) => ({
      value: device.deviceId,
      label: device.label || `카메라 ${index + 1}`,
    })),
  ]
  const current = options.find((o) => o.value === value)

  return (
      <div className="hand-scan-fs__feed-select-wrap" ref={wrapRef}>
        <div className="hand-scan-fs__feed-select-label">
          <span className="hand-scan-fs__feed-select-name">{label}</span>
          <span className="hand-scan-fs__feed-select-inner">
          <button
              ref={triggerRef}
              type="button"
              className="hand-scan-fs__feed-select"
              aria-label={`${label} 선택`}
              aria-expanded={open}
              onClick={openMenu}
          >
            <span className="hand-scan-fs__feed-select-current">{current?.label ?? '기본 카메라'}</span>
          </button>
          <svg
              className={`hand-scan-fs__feed-select-chevron${open ? ' is-open' : ''}`}
              viewBox="0 0 12 12"
              width="12"
              height="12"
              aria-hidden="true"
          >
            <path d="M2 4l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        </span>
        </div>

        {open && menuPos &&
            createPortal(
                <div
                    ref={menuRef}
                    className="hand-scan-fs__feed-select-menu"
                    style={{ position: 'fixed', top: menuPos.top, left: menuPos.left, transform: 'translateX(-50%)' }}
                >
                  {options.map((option) => (
                      <button
                          key={option.value}
                          type="button"
                          className={`hand-scan-fs__feed-select-option${option.value === value ? ' is-active' : ''}`}
                          onClick={() => {
                            onChange(option.value)
                            setOpen(false)
                          }}
                      >
                        {option.label}
                      </button>
                  ))}
                </div>,
                document.body,
            )}
      </div>
  )
}