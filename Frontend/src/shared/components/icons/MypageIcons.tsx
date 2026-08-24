import type { SVGProps } from 'react'

const svgDefaults = {
  viewBox: '0 0 24 24',
  fill: 'none' as const,
  xmlns: 'http://www.w3.org/2000/svg',
}

export function MypageHandIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...svgDefaults} {...props}>
      <path
        d="M8 12.5V6a1.5 1.5 0 0 1 3 0v5M11 11V4.5a1.5 1.5 0 0 1 3 0V11M14 11.5V6a1.5 1.5 0 0 1 3 0v7c0 4-2.5 7-6.5 7C6.7 20 5 17 5 14.2v-2a1.4 1.4 0 0 1 2.8 0"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

export function MypageDesignIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...svgDefaults} {...props}>
      <rect x="4" y="4" width="16" height="16" rx="3" stroke="currentColor" strokeWidth="1.7" />
      <path
        d="m8 14 2.5-3 2 2L16 9l2 2.5"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="9" cy="9" r="1.1" fill="currentColor" />
    </svg>
  )
}

export function MypagePrintIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...svgDefaults} {...props}>
      <path
        d="M7 8V4h10v4M6 17h12a1 1 0 0 0 1-1v-4a1 1 0 0 0-1-1H6a1 1 0 0 0-1 1v4a1 1 0 0 0 1 1z"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
      <rect x="8" y="14" width="8" height="6" stroke="currentColor" strokeWidth="1.6" />
    </svg>
  )
}

export function MypageWebIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...svgDefaults} {...props}>
      <rect x="3.5" y="4.5" width="17" height="15" rx="2.2" stroke="currentColor" strokeWidth="1.6" />
      <line x1="3.5" y1="8.5" x2="20.5" y2="8.5" stroke="currentColor" strokeWidth="1.5" />
      <circle cx="6" cy="6.5" r="0.75" fill="currentColor" />
      <circle cx="8.2" cy="6.5" r="0.75" fill="currentColor" />
      <circle cx="10.4" cy="6.5" r="0.75" fill="currentColor" />
      <rect
        x="6.5"
        y="10.5"
        width="11"
        height="6"
        rx="1"
        stroke="currentColor"
        strokeWidth="1.3"
        opacity="0.75"
      />
      <line x1="8" y1="13" x2="16" y2="13" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" opacity="0.55" />
    </svg>
  )
}

export function MypageHomeIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...svgDefaults} {...props}>
      <path
        d="M4 11.5 12 4l8 7.5M6 10v9h12v-9"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

export function MypageNailArtIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...svgDefaults} {...props}>
      <rect x="9" y="3" width="6" height="10" rx="2.5" stroke="currentColor" strokeWidth="1.6" />
      <path
        d="M10.4 4.6q1.6-.5 3.2 0"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinecap="round"
      />
      <rect x="5.5" y="12" width="13" height="9" rx="3.5" stroke="currentColor" strokeWidth="1.6" />
      <path
        d="M10.2 18.2h3.6"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
      />
    </svg>
  )
}

export function MypageUserIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...svgDefaults} {...props}>
      <circle cx="12" cy="8" r="3.4" stroke="currentColor" strokeWidth="1.7" />
      <path
        d="M4.5 20c1.4-3.6 4.4-5.5 7.5-5.5s6.1 1.9 7.5 5.5"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
      />
    </svg>
  )
}

export function MypageTimelineIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...svgDefaults} {...props}>
      <path d="M4 6h16M4 12h16M4 18h10" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
      <circle cx="4" cy="6" r="1.6" fill="currentColor" />
      <circle cx="4" cy="12" r="1.6" fill="currentColor" />
      <circle cx="4" cy="18" r="1.6" fill="currentColor" />
    </svg>
  )
}

export function MypageHeartIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...svgDefaults} {...props}>
      <path
        d="M12 20s-7-4.35-9.5-8.8C.8 8 2 4.5 5.4 4a4.9 4.9 0 0 1 6.6 2 4.9 4.9 0 0 1 6.6-2c3.4.5 4.6 4 3.9 7.2C19 15.65 12 20 12 20z"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
    </svg>
  )
}

export function MypageLogoutIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...svgDefaults} width="14" height="14" {...props}>
      <path
        d="M9 4H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h3M15 16l4-4-4-4M19 12H9"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

export function MypageChevronIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...svgDefaults} width="16" height="16" {...props}>
      <path
        d="m9 6 6 6-6 6"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

export const MypageIcons = {
  home: MypageHomeIcon,
  user: MypageUserIcon,
  hand: MypageHandIcon,
  design: MypageDesignIcon,
  timeline: MypageTimelineIcon,
  heart: MypageHeartIcon,
  print: MypagePrintIcon,
  logout: MypageLogoutIcon,
  chevron: MypageChevronIcon,
  nailArt: MypageNailArtIcon,
  web: MypageWebIcon,
} as const

export type MypageIconName = keyof typeof MypageIcons

export function MypageIcon({ name, ...props }: { name: MypageIconName } & SVGProps<SVGSVGElement>) {
  const Icon = MypageIcons[name]
  return <Icon {...props} />
}
