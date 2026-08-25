import type { ReactNode } from 'react'
import '@/styles/page-hero.css'

type PageHeroProps = {
    eyebrow: string
    title: ReactNode
    description?: ReactNode
    align?: 'left' | 'center'
}

// 손 촬영 / 손 분석 결과 / 네일팁 출력 / 디자인 생성 결과 화면에서 공통으로 쓰는 제목 영역.
// 그라데이션 카드 배경 + 핑크색 영어 소제목 + 검정색 본제목 + 연한 설명 구성으로 통일한다.
export function PageHero({ eyebrow, title, description, align = 'left' }: PageHeroProps) {
    return (
        <header className={`page-hero${align === 'center' ? ' page-hero--center' : ''}`}>
            <p className="page-hero__eyebrow">{eyebrow}</p>
            <h1 className="page-hero__title">{title}</h1>
            {description && <p className="page-hero__description">{description}</p>}
        </header>
    )
}
