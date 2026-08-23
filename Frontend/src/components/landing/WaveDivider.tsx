type WaveDividerProps = {
  variant?: 'top' | 'bottom'
  color?: string
}

export function WaveDivider({ variant = 'bottom', color = '#ffffff' }: WaveDividerProps) {
  return (
    <div className={`wave-divider wave-divider--${variant}`} aria-hidden="true">
      <svg viewBox="0 0 1440 80" preserveAspectRatio="none" xmlns="http://www.w3.org/2000/svg">
        <path
          d={
            variant === 'bottom'
              ? 'M0,40 C360,80 720,0 1080,40 C1260,60 1380,50 1440,40 L1440,80 L0,80 Z'
              : 'M0,40 C360,0 720,80 1080,40 C1260,20 1380,30 1440,40 L1440,0 L0,0 Z'
          }
          fill={color}
        />
      </svg>
    </div>
  )
}
