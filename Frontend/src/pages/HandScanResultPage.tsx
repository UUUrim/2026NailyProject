import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { AppShell } from '@/components/layout/AppShell'
import { PageBackLink } from '@/components/layout/PageBackLink'
import { FingerDetailModal } from '@/components/handScan/FingerDetailModal'
import { getNailShape, NAIL_SHAPES } from '@/constants/nailShapes'
import { getHandScanResult } from '@/utils/handScanStorage'
import '@/styles/hand-scan-result.css'

function MetricCard({
  title,
  metric,
  hint,
}: {
  title: string
  metric: { value: number; unit: string; percentile: number; comparisonLabel: string }
  hint: string
}) {
  return (
    <article className="scan-metric-card">
      <h3>{title}</h3>
      <p className="scan-metric-card__value">
        {metric.value}
        {metric.unit}
      </p>
      <p className="scan-metric-card__compare">{metric.comparisonLabel}</p>
      <div className="scan-metric-card__bar" aria-hidden="true">
        <span style={{ width: `${metric.percentile}%` }} />
      </div>
      <p className="scan-metric-card__hint">{hint}</p>
      <p className="scan-metric-card__percentile">상위 {100 - metric.percentile}% 수준</p>
    </article>
  )
}

export function HandScanResultPage() {
  const navigate = useNavigate()
  const result = getHandScanResult()
  const [showFingerModal, setShowFingerModal] = useState(false)

  if (!result) {
    return (
      <AppShell>
        <PageBackLink to="/scan/hand" label="손 촬영" />
        <div className="scan-result-empty">
          <p>손 스캔 결과가 없습니다. 먼저 손 촬영을 진행해 주세요.</p>
          <button type="button" className="scan-result-cta" onClick={() => navigate('/scan/hand')}>
            손 촬영하러 가기
          </button>
        </div>
      </AppShell>
    )
  }

  const recommended = getNailShape(result.recommendedShape)

  return (
    <AppShell mainClassName="scan-result-page">
      <PageBackLink to="/scan/hand" label="손 촬영" />

      <header className="scan-result-hero">
        <p className="scan-result-hero__eyebrow">Hand Scan Analysis</p>
        <h1>손 스캔 분석 결과</h1>
        <p>{result.summary}</p>
      </header>

      <section className="scan-result-section">
        <div className="scan-result-section__head">
          <h2>손톱 기본 지표</h2>
          <button type="button" className="scan-result-link" onClick={() => setShowFingerModal(true)}>
            상세보기
          </button>
        </div>
        <div className="scan-result-metrics">
          <MetricCard title="길이 (Length)" metric={result.length} hint="손톱 끝에서 베이스까지 평균 길이" />
          <MetricCard title="너비 (Width)" metric={result.width} hint="손톱 최대 너비 평균" />
          <MetricCard
            title="곡률 (C-curve)"
            metric={{ ...result.cCurve, unit: '' }}
            hint="손톱 측면 곡률 지수 (0~1)"
          />
        </div>
      </section>

      <section className="scan-result-section scan-result-section--grid">
        <article className="scan-tone-card">
          <h2>피부 톤</h2>
          <div className="scan-tone-card__swatch" style={{ background: result.skinToneHex }} />
          <p className="scan-tone-card__hex">{result.skinToneHex}</p>
          <p className="scan-tone-card__desc">손등·손바닥 영역에서 추출한 대표 피부색 HEX 값입니다.</p>
        </article>

        <article className="scan-season-card">
          <h2>퍼스널 컬러</h2>
          <p className="scan-season-card__name">{result.seasonNameKo}</p>
          <p className="scan-season-card__code">{result.seasonCode}</p>
          <div className="scan-palette">
            {result.personalColorPalette.map((hex) => (
              <button
                key={hex}
                type="button"
                className="scan-palette__chip"
                style={{ background: hex }}
                title={hex}
                aria-label={`팔레트 색 ${hex}`}
              />
            ))}
          </div>
          <p className="scan-season-card__desc">당신에게 어울리는 퍼스널 컬러 팔레트입니다.</p>
        </article>
      </section>

      <section className="scan-result-section">
        <h2>추천 네일팁 모양</h2>
        <p className="scan-result-section__sub">
          손톱 비율과 곡률을 기준으로 가장 잘 어울리는 쉐입은{' '}
          <strong>{recommended?.labelKo ?? result.recommendedShape}</strong> 입니다.
        </p>

        <div className="scan-shape-grid">
          {NAIL_SHAPES.map((shape) => {
            const isRecommended = shape.id === result.recommendedShape
            return (
              <article
                key={shape.id}
                className={`scan-shape-card ${isRecommended ? 'is-recommended' : ''}`}
              >
                {isRecommended && <span className="scan-shape-card__badge">추천</span>}
                <img src={shape.image} alt={shape.labelKo} />
                <h3>{shape.labelKo}</h3>
                <p>{shape.labelEn}</p>
              </article>
            )
          })}
        </div>
      </section>

      <div className="scan-result-actions">
        <button type="button" className="scan-result-cta" onClick={() => navigate('/design/preferences')}>
          네일 디자인 생성하기
        </button>
      </div>

      {showFingerModal && (
        <FingerDetailModal fingers={result.fingers} onClose={() => setShowFingerModal(false)} />
      )}
    </AppShell>
  )
}
