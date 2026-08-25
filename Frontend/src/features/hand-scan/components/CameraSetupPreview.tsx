import type { ReactNode } from 'react'
import '@/styles/hand-scan.css'

const FINGER_TOP_SRC = '/images/hand-scan/finger-top-view.png'
const FINGER_CURVATURE_SRC = '/images/hand-scan/finger-curvature.png'

function BoxFrame() {
    return (
        <>
            <defs>
                <linearGradient id="prep-box-gradient" x1="0%" y1="0%" x2="100%" y2="100%">
                    <stop offset="0%" stopColor="#3d3d3d" />
                    <stop offset="100%" stopColor="#252525" />
                </linearGradient>
            </defs>
            <rect x="24" y="28" width="152" height="108" rx="12" fill="url(#prep-box-gradient)" stroke="#555" strokeWidth="1.5" />
            <rect x="36" y="40" width="128" height="84" rx="8" fill="#1a1a1a" stroke="#444" strokeWidth="1" />
        </>
    )
}

function OverlayLayer({ scanArea, camera }: { scanArea: ReactNode; camera: ReactNode }) {
    return (
        <svg viewBox="0 0 200 160" className="hand-scan__prep-svg hand-scan__prep-svg--overlay" aria-hidden="true">
            {scanArea}
            {camera}
        </svg>
    )
}

function TopDownIllustration() {
    return (
        <div className="hand-scan__prep-scene">
            <svg viewBox="0 0 200 160" className="hand-scan__prep-svg hand-scan__prep-svg--box" aria-hidden="true">
                <BoxFrame />
            </svg>

            <div className="hand-scan__prep-finger-wrap">
                <img
                    src={FINGER_TOP_SRC}
                    className="hand-scan__prep-finger hand-scan__prep-finger--top"
                    alt=""
                    draggable={false}
                />
            </div>

            <OverlayLayer
                scanArea={
                    <path
                        d="M 86 44 L 72 82 L 100 90 L 128 82 L 114 44 Z"
                        fill="rgba(222,134,159,0.12)"
                        stroke="rgba(222,134,159,0.35)"
                        strokeWidth="1"
                    />
                }
                camera={
                    <g transform="translate(100, 12)">
                        <rect x="-14" y="-6" width="28" height="16" rx="4" fill="#444" stroke="#888" strokeWidth="1" />
                        <circle cx="0" cy="2" r="5" fill="#222" stroke="#de869f" strokeWidth="1.2" />
                        <line x1="0" y1="10" x2="0" y2="32" stroke="#de869f" strokeWidth="1.5" strokeDasharray="3 2" opacity="0.8" />
                        <polygon points="0,32 -6,24 6,24" fill="#de869f" opacity="0.7" />
                    </g>
                }
            />
        </div>
    )
}

function SideViewIllustration() {
    return (
        <div className="hand-scan__prep-scene">
            <svg viewBox="0 0 200 160" className="hand-scan__prep-svg hand-scan__prep-svg--box" aria-hidden="true">
                <BoxFrame />
            </svg>

            <div className="hand-scan__prep-finger-wrap">
                <img
                    src={FINGER_CURVATURE_SRC}
                    className="hand-scan__prep-finger hand-scan__prep-finger--side"
                    alt=""
                    draggable={false}
                />
            </div>

            <OverlayLayer
                scanArea={
                    <path
                        d="M 88 118 L 74 78 L 100 68 L 126 78 L 112 118 Z"
                        fill="rgba(222,134,159,0.12)"
                        stroke="rgba(222,134,159,0.35)"
                        strokeWidth="1"
                    />
                }
                camera={
                    <g transform="translate(100, 148)">
                        <rect x="-14" y="-6" width="28" height="16" rx="4" fill="#444" stroke="#888" strokeWidth="1" />
                        <circle cx="0" cy="2" r="5" fill="#222" stroke="#de869f" strokeWidth="1.2" />
                        <line x1="0" y1="-6" x2="0" y2="-30" stroke="#de869f" strokeWidth="1.5" strokeDasharray="3 2" opacity="0.8" />
                        <polygon points="0,-30 -6,-22 6,-22" fill="#de869f" opacity="0.7" />
                    </g>
                }
            />
        </div>
    )
}

export function CameraSetupPreview() {
    return (
        <div className="hand-scan__prep-cards">
            <article className="hand-scan__prep-card">
                <div className="hand-scan__prep-card-visual">
                    <TopDownIllustration />
                </div>
                <div className="hand-scan__prep-card-body">
                    <span className="hand-scan__prep-card-tag">카메라 1</span>
                    <h3 className="hand-scan__prep-card-title">탑뷰 촬영</h3>
                    <p className="hand-scan__prep-card-desc">
                        위에서 아래로 손톱 형태가
                        <br />
                        선명하게 보이도록 촬영합니다
                    </p>
                </div>
            </article>

            <article className="hand-scan__prep-card">
                <div className="hand-scan__prep-card-visual">
                    <SideViewIllustration />
                </div>
                <div className="hand-scan__prep-card-body">
                    <span className="hand-scan__prep-card-tag">카메라 2</span>
                    <h3 className="hand-scan__prep-card-title">측면 촬영</h3>
                    <p className="hand-scan__prep-card-desc">
                        손톱과 수평인 위치에서
                        <br />
                        손톱 곡률을 측정합니다
                    </p>
                </div>
            </article>
        </div>
    )
}
