import { Fragment } from 'react'
import type { NailShapeInfo } from '@/shared/constants/nailShapes'

// nailShapes.ts의 analysis 문장에서 사용자 이름이 들어갈 자리
const NAME_PLACEHOLDER = 'ㅇㅇ'

// '**'로 감싼 부분(손톱 특징, 쉐입의 효과)을 형광펜 강조로 렌더링한다
function renderEmphasis(text: string) {
    return text.split('**').map((part, i) =>
        i % 2 === 1 ? (
            <strong key={i} className="scan-shape-insight__em">{part}</strong>
        ) : (
            <Fragment key={i}>{part}</Fragment>
        ),
    )
}

/**
 * 손 분석 결과 화면의 "추천 네일팁 쉐입" 카드.
 * 위쪽은 쉐입 이름/아이콘, 아래쪽은 손톱 분석 문장과 추천 이유를 이어 붙인 설명 한 단락을 보여준다.
 */
export function RecommendedShapeCard({ shape, userName }: { shape: NailShapeInfo; userName?: string }) {
    const text = `${shape.analysis.replace(NAME_PLACEHOLDER, userName || '회원')} ${shape.reason}`

    return (
        <div className="scan-shape-highlight">
            <div className="scan-shape-highlight__top">
                <div className="scan-shape-highlight__body">
                    <p className="scan-shape-highlight__name">{shape.labelKo}</p>
                    <p className="scan-shape-highlight__label-en">{shape.labelEn}</p>
                    <p className="scan-shape-highlight__desc">{shape.description}</p>
                </div>
                <div className="scan-shape-highlight__icon" aria-hidden="true">
                    <img src={shape.image} alt="" />
                </div>
            </div>

            <div className="scan-shape-insight">
                <p className="scan-shape-insight__label">
                    <svg viewBox="0 0 24 24" width="13" height="13" fill="currentColor" aria-hidden="true">
                        <path d="M12 2l1.9 6.1L20 10l-6.1 1.9L12 18l-1.9-6.1L4 10l6.1-1.9z" />
                        <path d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z" />
                    </svg>
                    추천 이유
                </p>
                <p className="scan-shape-insight__text">{renderEmphasis(text)}</p>
            </div>
        </div>
    )
}
