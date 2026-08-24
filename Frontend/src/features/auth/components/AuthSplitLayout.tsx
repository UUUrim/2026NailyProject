import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { AuthNav } from '@/shared/layout/AuthNav'

type AuthSplitLayoutProps = {
    children: ReactNode
}

type PhotoItem = { type: 'photo'; src: string }
type FeatureItem = {
    type: 'feature'
    accent: 'a' | 'b' | 'c' | 'd'
    title: string
    caption: string
    icon: ReactNode
}
type MarqueeItem = PhotoItem | FeatureItem

const ScanIcon = (
    <svg viewBox="0 0 24 24" fill="none" width="26" height="26" aria-hidden="true">
        <path
            d="M4 8V5a1 1 0 0 1 1-1h3M20 8V5a1 1 0 0 0-1-1h-3M4 16v3a1 1 0 0 0 1 1h3M20 16v3a1 1 0 0 1-1 1h-3"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
        />
        <rect x="9" y="7" width="6" height="10" rx="3" stroke="currentColor" strokeWidth="1.6" />
    </svg>
)

const AnalyzeIcon = (
    <svg viewBox="0 0 24 24" fill="none" width="26" height="26" aria-hidden="true">
        <path d="M4 19h16M7 19V10M12 19V5M17 19v-7" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
)

const PrintIcon = (
    <svg viewBox="0 0 24 24" fill="none" width="26" height="26" aria-hidden="true">
        <path
            d="M7 8V4h10v4M6 17h12a1 1 0 0 0 1-1v-4a1 1 0 0 0-1-1H6a1 1 0 0 0-1 1v4a1 1 0 0 0 1 1z"
            stroke="currentColor"
            strokeWidth="1.7"
            strokeLinejoin="round"
        />
        <rect x="8" y="14" width="8" height="6" stroke="currentColor" strokeWidth="1.7" />
    </svg>
)

// 마이페이지의 디자인 아이콘과 동일한 그림(사각 프레임 + 산 모양 + 점)을 가져오되,
// 다른 카드 아이콘들과 같은 스타일(width/height/aria-hidden)로 맞췄다.
const DesignIcon = (
    <svg viewBox="0 0 24 24" fill="none" width="26" height="26" aria-hidden="true">
        <rect x="4" y="4" width="16" height="16" rx="3" stroke="currentColor" strokeWidth="1.7" />
        <path d="m8 14 2.5-3 2 2L16 9l2 2.5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
        <circle cx="9" cy="9" r="1.1" fill="currentColor" />
    </svg>
)

const MARQUEE_COLUMN_A: MarqueeItem[] = [
    { type: 'photo', src: '/images/auth-split/design1.png' },
    { type: 'feature', accent: 'a', title: '손 스캔', caption: '길이·너비·곡률 정밀 분석', icon: ScanIcon },
    { type: 'photo', src: '/images/auth-split/design1.png' },
    { type: 'feature', accent: 'd', title: '네일팁 제작', caption: '3D 프린터로 내 손에 꼭 맞는 네일팁 출력', icon: PrintIcon },
]

const MARQUEE_COLUMN_B: MarqueeItem[] = [
    { type: 'photo', src: '/images/auth-split/design1.png' },
    { type: 'feature', accent: 'c', title: '피부 톤 맞춤 진단', caption: '나에게 어울리는 색상과 손톱 모양 추천', icon: AnalyzeIcon },
    { type: 'photo', src: '/images/auth-split/design1.png' },
    { type: 'feature', accent: 'b', title: 'AI 디자인 생성', caption: 'AI로 완성하는 나만의 디자인', icon: DesignIcon },
]

function MarqueeColumn({ items, direction }: { items: MarqueeItem[]; direction: 'up' | 'down' }) {
    const track = [...items, ...items]
    return (
        <div className="auth-split__marquee-col">
            <div className={`auth-split__marquee-track auth-split__marquee-track--${direction}`}>
                {track.map((item, i) =>
                    item.type === 'photo' ? (
                        <span className="auth-split__frame auth-split__frame--photo" key={`${item.src}-${i}`}>
                            <img src={item.src} alt="" />
                            <span className="auth-split__frame-tint" />
                        </span>
                    ) : (
                        <span className={`auth-split__frame auth-split__feature auth-split__feature--${item.accent}`} key={`${item.title}-${i}`}>
                            <span className="auth-split__feature-icon">{item.icon}</span>
                            <strong className="auth-split__feature-title">{item.title}</strong>
                            <span className="auth-split__feature-caption">{item.caption}</span>
                        </span>
                    ),
                )}
            </div>
        </div>
    )
}

export function AuthSplitLayout({ children }: AuthSplitLayoutProps) {
    return (
        <div className="auth-split">
            <aside className="auth-split__visual" aria-hidden="true">
                <div className="auth-split__marquee">
                    <MarqueeColumn items={MARQUEE_COLUMN_A} direction="up" />
                    <MarqueeColumn items={MARQUEE_COLUMN_B} direction="down" />
                </div>

                <span className="auth-split__scrim auth-split__scrim--top" />
                <span className="auth-split__scrim auth-split__scrim--bottom" />

                <Link to="/" className="auth-split__logo">
                    <img src="/images/logo.png" alt="Naily" className="auth-split__logo-image" />
                </Link>

                <span className="auth-split__eyebrow">SCAN · PRINT · DESIGN</span>
                <h2 className="auth-split__headline">
                    스캔한 손톱 그대로
                    <br />
                    나만의 네일팁 완성
                </h2>
                <span className="auth-split__sparkle auth-split__sparkle--1">✦</span>
                <span className="auth-split__sparkle auth-split__sparkle--2">✧</span>
            </aside>

            <section className="auth-split__panel">
                <header className="auth-split__header">
                    <nav className="auth-split__nav" aria-label="회원가입 상단 메뉴">
                        <AuthNav
                            loginClassName="auth-split__link"
                            signupClassName="auth-split__cta"
                            profileClassName="auth-split__profile"
                        />
                    </nav>
                </header>

                <main className="auth-split__content">{children}</main>
            </section>
        </div>
    )
}
