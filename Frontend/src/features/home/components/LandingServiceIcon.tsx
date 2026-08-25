import { MypageIcon, type MypageIconName } from '@/shared/components/icons/MypageIcons'

type LandingServiceIconProps = {
  name: MypageIconName
  variant: 'step' | 'feature' | 'benefit'
  className?: string
}

const iconGlyphScale: Partial<Record<MypageIconName, number>> = {
  hand: 0.9,
  print: 0.88,
  design: 0.88,
  nailArt: 0.9,
  web: 0.88,
}

export function LandingServiceIcon({ name, variant, className = '' }: LandingServiceIconProps) {
  const glyphScale = iconGlyphScale[name] ?? 0.9

  return (
    <div
      className={['landing-service-icon', `landing-service-icon--${variant}`, className]
        .filter(Boolean)
        .join(' ')}
      aria-hidden="true"
    >
      <MypageIcon
        name={name}
        className="landing-service-icon__glyph"
        style={{ transform: `scale(${glyphScale})` }}
      />
    </div>
  )
}

export function LandingBenefitIcon({
  name,
  className = '',
}: {
  name: MypageIconName
  className?: string
}) {
  return (
    <div className={['why-naily__benefit-icon', className].filter(Boolean).join(' ')}>
      <LandingServiceIcon name={name} variant="benefit" />
    </div>
  )
}

export function mapBenefitIcon(icon: 'fit' | 'transparent' | 'design' | 'web'): MypageIconName {
  const mapping: Record<'fit' | 'transparent' | 'design' | 'web', MypageIconName> = {
    fit: 'hand',
    transparent: 'print',
    design: 'design',
    web: 'web',
  }

  return mapping[icon]
}

export function mapFeatureIcon(icon: 'scan' | 'print' | 'design'): MypageIconName {
  const mapping: Record<'scan' | 'print' | 'design', MypageIconName> = {
    scan: 'hand',
    print: 'print',
    design: 'design',
  }

  return mapping[icon]
}

export function mapStepIcon(step: number): MypageIconName {
  if (step === 1) return 'hand'
  if (step === 2) return 'print'
  if (step === 3) return 'design'
  return 'nailArt'
}
