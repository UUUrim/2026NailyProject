type ImagePlaceholderProps = {
  variant?: 'wide' | 'square'
  label?: string
}

export function ImagePlaceholder({
  variant = 'wide',
  label,
}: ImagePlaceholderProps) {
  return (
    <div
      className={`image-placeholder image-placeholder--${variant}`}
      role="img"
      aria-label={label ?? '이미지 준비 중'}
    >
      <svg viewBox="0 0 64 64" aria-hidden="true">
        <line x1="8" y1="8" x2="56" y2="56" />
        <line x1="56" y1="8" x2="8" y2="56" />
      </svg>
    </div>
  )
}
