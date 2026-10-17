// 디자인 채팅 말풍선을 그리는 조각들 — 채팅 화면과 마이페이지 채팅 이력(확정 때 저장한 대화)이 같이 써서
// 두 곳의 말풍선이 똑같이 보이게 한다.
import { ANALYSIS_BUTTON_TOKEN, SMILE_ICON_TOKEN } from '@/features/nail-design/utils/chatBubbleTokens'

// 손 모양 아이콘 — '내 스캔 정보로 자동' 카드와 입력창의 '손 분석 결과' 버튼, 말풍선 속 손 아이콘이 같이 쓴다
// (손 그림이 24칸 안에서 왼쪽 위로 치우쳐 있어서(가로 중심 11, 세로 11.5) viewBox를 옮겨 한가운데에 놓는다)
export function HandIcon({ size = 16, strokeWidth = 1.8 }: { size?: number; strokeWidth?: number }) {
    return (
        <svg width={size} height={size} viewBox="-1 -0.5 24 24" fill="none" aria-hidden="true">
            <path
                d="M8 12.5V6a1.5 1.5 0 0 1 3 0v5M11 11V4.5a1.5 1.5 0 0 1 3 0V11M14 11.5V6a1.5 1.5 0 0 1 3 0v7c0 4-2.5 7-6.5 7C6.7 20 5 17 5 14.2v-2a1.4 1.4 0 0 1 2.8 0"
                stroke="currentColor"
                strokeWidth={strokeWidth}
                strokeLinecap="round"
                strokeLinejoin="round"
            />
        </svg>
    )
}

// 말풍선 글 안의 자리표시자 — 손 아이콘(입력창의 손 분석 버튼)으로 그리고, 예전 자유 입력 시작 멘트 끝에 있던
// 웃는 얼굴 자리표시자는 저장된 대화를 되살려도 아이콘 없이 지운다
const BUBBLE_ICON_TOKEN_PATTERN = new RegExp(
    `(${[ANALYSIS_BUTTON_TOKEN, SMILE_ICON_TOKEN].map((token) => token.replace(/[{}]/g, '\\$&')).join('|')})`,
)

// 말풍선 글 — 줄마다 <p>로 나누고, 손 분석 버튼 자리표시자는 손 아이콘으로 그린다
export function BubbleText({ text }: { text: string }) {
    return (
        <>
            {text.split('\n').map((line, i) => (
                <p key={i}>
                    {line.split(BUBBLE_ICON_TOKEN_PATTERN).map((part, j) =>
                        part === ANALYSIS_BUTTON_TOKEN ? (
                            <span key={j} className="design-chat__analysis-icon-inline">
                                <HandIcon size={17} />
                            </span>
                        ) : part === SMILE_ICON_TOKEN ? null : (
                            <span key={j}>{part}</span>
                        ),
                    )}
                </p>
            ))}
        </>
    )
}

// 디자인 결과 카드가 아닌 말풍선 한 줄 — 글, 사용자가 올린 참고 사진, 색 동그라미("컬러: ●●" / 그 아래 "기타(…)")
export function ChatMessageRow({
    role,
    text,
    imageUrls,
    colorSwatches,
    colorsInline,
    textAfterColors,
    onImageClick,
    onImageLoad,
}: {
    role: 'user' | 'assistant'
    text: string
    imageUrls?: string[] | null
    colorSwatches?: string[] | null
    colorsInline?: boolean | null
    textAfterColors?: string | null
    onImageClick?: (url: string) => void
    onImageLoad?: () => void
}) {
    const hasImages = !!imageUrls && imageUrls.length > 0
    const hasColors = !!colorSwatches && colorSwatches.length > 0
    return (
        <div className={`design-chat__row design-chat__row--${role}`}>
            {role === 'assistant' && <img src="/images/logo.png" alt="" className="design-chat__avatar" />}
            <div
                className={`design-chat__bubble design-chat__bubble--${role}${
                    !text && hasImages ? ' design-chat__bubble--image-only' : ''
                }`}
            >
                {/* 색 동그라미를 글 옆에 붙이는 말풍선은 글을 아래 색 줄에서 함께 그린다 */}
                {text && !(colorsInline && hasColors) && <BubbleText text={text} />}
                {/* 사용자가 올린 참고 사진 */}
                {hasImages && (
                    <div className="design-chat__bubble-images design-chat__bubble-images--user-photo">
                        {imageUrls.map((url, i) => (
                            <div key={i} className="design-chat__bubble-image-wrap">
                                <img
                                    src={url}
                                    alt="업로드한 참고 사진"
                                    onClick={onImageClick ? () => onImageClick(url) : undefined}
                                    onLoad={onImageLoad}
                                    style={onImageClick ? { cursor: 'zoom-in' } : undefined}
                                />
                            </div>
                        ))}
                    </div>
                )}
                {hasColors && (
                    <div className={`design-chat__bubble-colors${colorsInline ? ' design-chat__bubble-colors--inline' : ''}`}>
                        {colorsInline && text && <span className="design-chat__bubble-colors-label">{text}</span>}
                        {colorSwatches.map((hex, i) => (
                            <span key={i} className="design-chat__bubble-color-dot" style={{ background: hex }} />
                        ))}
                    </div>
                )}
                {textAfterColors && <p className="design-chat__bubble-after-colors">{textAfterColors}</p>}
            </div>
        </div>
    )
}

// 디자인 결과 — 이미지 카드 줄과, 글이 있으면 그 아래 별도 말풍선 (마이페이지 채팅 이력처럼 다 완성된 대화를 그릴 때.
// 채팅 화면은 생성 중 표시·나타나기 효과가 있는 카드를 따로 쓴다)
export function ChatDesignResultRows({
    imageUrls,
    text,
    onImageClick,
}: {
    imageUrls: string[]
    text: string
    onImageClick?: (url: string) => void
}) {
    return (
        <>
            <div className="design-chat__row design-chat__row--assistant">
                <img src="/images/logo.png" alt="" className="design-chat__avatar" />
                <div className="design-chat__design-cards">
                    {imageUrls.map((url, i) => (
                        <div key={i} className="design-chat__design-card is-loaded">
                            <img
                                src={url}
                                alt="생성된 네일 디자인"
                                onClick={onImageClick ? () => onImageClick(url) : undefined}
                            />
                        </div>
                    ))}
                </div>
            </div>
            {text && (
                <div className="design-chat__row design-chat__row--assistant">
                    <img src="/images/logo.png" alt="" className="design-chat__avatar" />
                    <div className="design-chat__bubble design-chat__bubble--assistant">
                        <BubbleText text={text} />
                    </div>
                </div>
            )}
        </>
    )
}
