// import { useState } from 'react'
// import { createPortal } from 'react-dom'  // 추가
// import { useNavigate } from 'react-router-dom'
// import { AppShell } from '@/components/layout/AppShell'
// import { PageBackLink } from '@/components/layout/PageBackLink'
// import { FingerDetailModal } from '@/components/handScan/FingerDetailModal'
// import { getNailShape, NAIL_SHAPES } from '@/constants/nailShapes'
// import { getHandScanResult } from '@/utils/handScanStorage'
// import '@/styles/hand-scan-result.css'

// function MetricCard({
//   title,
//   metric,
//   hint,
// }: {
//   title: string
//   metric: { value: number; unit: string; percentile: number; comparisonLabel: string }
//   hint: string
// }) {
//   return (
//     <article className="scan-metric-card">
//       <h3>{title}</h3>
//       <p className="scan-metric-card__value">
//         {metric.value}
//         {metric.unit}
//       </p>
//       <p className="scan-metric-card__compare">{metric.comparisonLabel}</p>
//       <div className="scan-metric-card__bar" aria-hidden="true">
//         <span style={{ width: `${metric.percentile}%` }} />
//       </div>
//       <p className="scan-metric-card__hint">{hint}</p>
//       <p className="scan-metric-card__percentile">상위 {100 - metric.percentile}% 수준</p>
//     </article>
//   )
// }

// export function HandScanResultPage() {
//   const navigate = useNavigate()
//   const result = getHandScanResult()
//   const [showFingerModal, setShowFingerModal] = useState(false)
//   const [selectedShape, setSelectedShape] = useState<string | null>(null)   //추가
//   const [showPrintModal, setShowPrintModal] = useState(false)   //추가

//   if (!result) {
//     return (
//       <AppShell>
//         <PageBackLink to="/scan/hand" label="손 촬영" />
//         <div className="scan-result-empty">
//           <p>손 스캔 결과가 없습니다. 먼저 손 촬영을 진행해 주세요.</p>
//           <button type="button" className="scan-result-cta" onClick={() => navigate('/scan/hand')}>
//             손 촬영하러 가기
//           </button>
//         </div>
//       </AppShell>
//     )
//   }

//   const recommended = getNailShape(result.recommendedShape)

//   return (
//     <AppShell mainClassName="scan-result-page">
//       <PageBackLink to="/scan/hand" label="손 촬영" />

//       <header className="scan-result-hero">
//         <p className="scan-result-hero__eyebrow">Hand Scan Analysis</p>
//         <h1>손 스캔 분석 결과</h1>
//         <p>{result.summary}</p>
//       </header>

//       <section className="scan-result-section">
//         <div className="scan-result-section__head">
//           <h2>손톱 기본 지표</h2>
//           <button type="button" className="scan-result-link" onClick={() => setShowFingerModal(true)}>
//             상세보기
//           </button>
//         </div>
//         <div className="scan-result-metrics">
//           <MetricCard title="길이 (Length)" metric={result.length} hint="손톱 끝에서 베이스까지 평균 길이" />
//           <MetricCard title="너비 (Width)" metric={result.width} hint="손톱 최대 너비 평균" />
//           <MetricCard
//             title="곡률 (C-curve)"
//             metric={{ ...result.cCurve, unit: '' }}
//             hint="손톱 측면 곡률 지수 (0~1)"
//           />
//         </div>
//       </section>

//       <section className="scan-result-section scan-result-section--grid">
//         <article className="scan-tone-card">
//           <h2>피부 톤</h2>
//           <div className="scan-tone-card__swatch" style={{ background: result.skinToneHex }} />
//           <p className="scan-tone-card__hex">{result.skinToneHex}</p>
//           <p className="scan-tone-card__desc">손등·손바닥 영역에서 추출한 대표 피부색 HEX 값입니다.</p>
//         </article>

//         <article className="scan-season-card">
//           <h2>퍼스널 컬러</h2>
//           <p className="scan-season-card__name">{result.seasonNameKo}</p>
//           <div className="scan-palette">
//             {result.personalColorPalette.map((hex) => (
//               <button
//                 key={hex}
//                 type="button"
//                 className="scan-palette__chip"
//                 style={{ background: hex }}
//                 title={hex}
//                 aria-label={`팔레트 색 ${hex}`}
//               />
//             ))}
//           </div>
//           <p className="scan-season-card__desc">당신에게 어울리는 퍼스널 컬러 팔레트입니다.</p>
//         </article>
//       </section>

//       <section className="scan-result-section">
//         <h2>출력 네일팁 모양</h2>
//         <p className="scan-result-section__sub">
//           출력할 네일팁 모양을 선택해 주세요.
//           당신에게 가장 잘 어울리는 쉐입은{' '}
//           <strong>{recommended?.labelKo ?? result.recommendedShape}</strong> 입니다.
//         </p>

//         {/* <div className="scan-shape-grid">
//           {NAIL_SHAPES.map((shape) => {
//             const isRecommended = shape.id === result.recommendedShape
//             return (
//               <article
//                 key={shape.id}
//                 className={`scan-shape-card ${isRecommended ? 'is-recommended' : ''}`}
//               >
//                 {isRecommended && <span className="scan-shape-card__badge">추천</span>}
//                 <img src={shape.image} alt={shape.labelKo} />
//                 <h3>{shape.labelKo}</h3>
//                 <p>{shape.labelEn}</p>
//               </article>
//             )
//           })}
//         </div> */}

//         <div className="scan-shape-grid">
//           {NAIL_SHAPES.map((shape) => {
//             const isRecommended = shape.id === result.recommendedShape
//             const activeShape = selectedShape ?? result.recommendedShape
//             const isSelected = shape.id === activeShape
//             return (
//               <article
//                 key={shape.id}
//                 className={`scan-shape-card ${isRecommended ? 'is-recommended' : ''} ${isSelected ? 'is-selected' : ''}`}
//                 onClick={() => setSelectedShape(shape.id)}
//                 role="button"
//                 tabIndex={0}
//                 onKeyDown={(e) => e.key === 'Enter' && setSelectedShape(shape.id)}
//                 aria-pressed={isSelected}
//               >
//                 {isRecommended && <span className="scan-shape-card__badge">추천</span>}
//                 <img src={shape.image} alt={shape.labelKo} />
//                 <h3>{shape.labelKo}</h3>
//                 <p>{shape.labelEn}</p>
//               </article>
//             )
//           })}
//         </div>
//       </section>

//       <div className="scan-result-actions">
//         <button type="button" className="scan-result-cta" onClick={() => setShowPrintModal(true)}>
//           네일팁 출력하기
//         </button>
//         <button type="button" className="scan-result-cta" onClick={() => navigate('/design/preferences')}>
//           네일 디자인 생성하기
//         </button>
//       </div>

//       {showFingerModal && (
//         <FingerDetailModal fingers={result.fingers} onClose={() => setShowFingerModal(false)} />
//       )}

//       {showPrintModal && createPortal(
//         <div className="print-modal">
//           <button type="button" className="print-modal__backdrop" onClick={() => setShowPrintModal(false)} />
//           <div className="print-modal__panel" role="dialog" aria-modal="true">
//             <p className="print-modal__icon">🖨️</p>
//             <h2>출력 신청 완료</h2>
//             <p>
//               당신의 네일팁이{' '}
//               <strong>{getNailShape(selectedShape ?? result.recommendedShape)?.labelKo ?? (selectedShape ?? result.recommendedShape)}</strong>
//               {' '}(으)로 출력 신청되었습니다.
//             </p>
//             <button type="button" className="scan-result-cta" onClick={() => setShowPrintModal(false)}>
//               확인
//             </button>
//           </div>
//         </div>,
//         document.body   // AppShell 바깥 body에 직접 마운트
//       )}

//     </AppShell>
//   )
// }


// 수정
// import { useState } from 'react'
// import { createPortal } from 'react-dom'  // 추가
// import { useNavigate } from 'react-router-dom'
// import { AppShell } from '@/components/layout/AppShell'
// import { PageBackLink } from '@/components/layout/PageBackLink'
// import { FingerDetailModal } from '@/components/handScan/FingerDetailModal'
// import { getNailShape, NAIL_SHAPES } from '@/constants/nailShapes'
// import { getHandScanResult } from '@/utils/handScanStorage'
// import { addNailTipPrintOrder, saveHandScanRecord } from '@/utils/mypageStorage'
// import '@/styles/hand-scan-result.css'

// function MetricCard({
//   title,
//   metric,
//   hint,
// }: {
//   title: string
//   metric: { value: number; unit: string; percentile: number; comparisonLabel: string }
//   hint: string
// }) {
//   return (
//     <article className="scan-metric-card">
//       <h3>{title}</h3>
//       <p className="scan-metric-card__value">
//         {metric.value}
//         {metric.unit}
//       </p>
//       <p className="scan-metric-card__compare">{metric.comparisonLabel}</p>
//       <div className="scan-metric-card__bar" aria-hidden="true">
//         <span style={{ width: `${metric.percentile}%` }} />
//       </div>
//       <p className="scan-metric-card__hint">{hint}</p>
//       <p className="scan-metric-card__percentile">상위 {100 - metric.percentile}% 수준</p>
//     </article>
//   )
// }

// export function HandScanResultPage() {
//   const navigate = useNavigate()
//   const result = getHandScanResult()
//   const [showFingerModal, setShowFingerModal] = useState(false)
//   const [selectedShape, setSelectedShape] = useState<string | null>(null)   //추가
//   const [showPrintModal, setShowPrintModal] = useState(false)   //추가
//   const [printConfirmed, setPrintConfirmed] = useState(false)

//   // 결과 페이지 진입 시 손 분석 결과 마이페이지에 저장
//   useState(() => {
//     if (result) saveHandScanRecord(result)
//   })

//   if (!result) {
//     return (
//       <AppShell>
//         <PageBackLink to="/scan/hand" label="손 촬영" />
//         <div className="scan-result-empty">
//           <p>손 스캔 결과가 없습니다. 먼저 손 촬영을 진행해 주세요.</p>
//           <button type="button" className="scan-result-cta" onClick={() => navigate('/scan/hand')}>
//             손 촬영하러 가기
//           </button>
//         </div>
//       </AppShell>
//     )
//   }

//   const recommended = getNailShape(result.recommendedShape)

//   return (
//     <AppShell mainClassName="scan-result-page">
//       <PageBackLink to="/scan/hand" label="손 촬영" />

//       <header className="scan-result-hero">
//         <p className="scan-result-hero__eyebrow">Hand Scan Analysis</p>
//         <h1>손 스캔 분석 결과</h1>
//         <p>{result.summary}</p>
//       </header>

//       <section className="scan-result-section">
//         <div className="scan-result-section__head">
//           <h2>손톱 기본 지표</h2>
//           <button type="button" className="scan-result-link" onClick={() => setShowFingerModal(true)}>
//             상세보기
//           </button>
//         </div>
//         <div className="scan-result-metrics">
//           <MetricCard title="길이 (Length)" metric={result.length} hint="손톱 끝에서 베이스까지 평균 길이" />
//           <MetricCard title="너비 (Width)" metric={result.width} hint="손톱 최대 너비 평균" />
//           <MetricCard
//             title="곡률 (C-curve)"
//             metric={{ ...result.cCurve, unit: '' }}
//             hint="손톱 측면 곡률 지수 (0~1)"
//           />
//         </div>
//       </section>

//       <section className="scan-result-section scan-result-section--grid">
//         <article className="scan-tone-card">
//           <h2>피부 톤</h2>
//           <div className="scan-tone-card__swatch" style={{ background: result.skinToneHex }} />
//           <p className="scan-tone-card__hex">{result.skinToneHex}</p>
//           <p className="scan-tone-card__desc">손등·손바닥 영역에서 추출한 대표 피부색 HEX 값입니다.</p>
//         </article>

//         <article className="scan-season-card">
//           <h2>퍼스널 컬러</h2>
//           <p className="scan-season-card__name">{result.seasonNameKo}</p>
//           <div className="scan-palette">
//             {result.personalColorPalette.map((hex) => (
//               <button
//                 key={hex}
//                 type="button"
//                 className="scan-palette__chip"
//                 style={{ background: hex }}
//                 title={hex}
//                 aria-label={`팔레트 색 ${hex}`}
//               />
//             ))}
//           </div>
//           <p className="scan-season-card__desc">당신에게 어울리는 퍼스널 컬러 팔레트입니다.</p>
//         </article>
//       </section>

//       <section className="scan-result-section">
//         <h2>출력 네일팁 모양</h2>
//         <p className="scan-result-section__sub">
//           출력할 네일팁 모양을 선택해 주세요.
//           당신에게 가장 잘 어울리는 쉐입은{' '}
//           <strong>{recommended?.labelKo ?? result.recommendedShape}</strong> 입니다.
//         </p>

//         {/* <div className="scan-shape-grid">
//           {NAIL_SHAPES.map((shape) => {
//             const isRecommended = shape.id === result.recommendedShape
//             return (
//               <article
//                 key={shape.id}
//                 className={`scan-shape-card ${isRecommended ? 'is-recommended' : ''}`}
//               >
//                 {isRecommended && <span className="scan-shape-card__badge">추천</span>}
//                 <img src={shape.image} alt={shape.labelKo} />
//                 <h3>{shape.labelKo}</h3>
//                 <p>{shape.labelEn}</p>
//               </article>
//             )
//           })}
//         </div> */}

//         <div className="scan-shape-grid">
//           {NAIL_SHAPES.map((shape) => {
//             const isRecommended = shape.id === result.recommendedShape
//             const activeShape = selectedShape ?? result.recommendedShape
//             const isSelected = shape.id === activeShape
//             return (
//               <article
//                 key={shape.id}
//                 className={`scan-shape-card ${isRecommended ? 'is-recommended' : ''} ${isSelected ? 'is-selected' : ''}`}
//                 onClick={() => setSelectedShape(shape.id)}
//                 role="button"
//                 tabIndex={0}
//                 onKeyDown={(e) => e.key === 'Enter' && setSelectedShape(shape.id)}
//                 aria-pressed={isSelected}
//               >
//                 {isRecommended && <span className="scan-shape-card__badge">추천</span>}
//                 <img src={shape.image} alt={shape.labelKo} />
//                 <h3>{shape.labelKo}</h3>
//                 <p>{shape.labelEn}</p>
//               </article>
//             )
//           })}
//         </div>
//       </section>

//       <div className="scan-result-actions">
//         <button type="button" className="scan-result-cta" onClick={() => setShowPrintModal(true)} disabled={printConfirmed}>
//           {printConfirmed ? '출력 신청 완료 ✓' : '네일팁 출력하기'}
//         </button>
//         <button type="button" className="scan-result-cta" onClick={() => navigate('/design/preferences')}>
//           네일 디자인 생성하기
//         </button>
//       </div>

//       {showFingerModal && (
//         <FingerDetailModal fingers={result.fingers} onClose={() => setShowFingerModal(false)} />
//       )}

//       {showPrintModal && createPortal(
//         <div className="print-modal">
//           <button type="button" className="print-modal__backdrop" onClick={() => setShowPrintModal(false)} />
//           <div className="print-modal__panel" role="dialog" aria-modal="true">
//             <p className="print-modal__icon">🖨️</p>
//             <h2>출력 신청 완료</h2>
//             <p>
//               당신의 네일팁이{' '}
//               <strong>{getNailShape(selectedShape ?? result.recommendedShape)?.labelKo ?? (selectedShape ?? result.recommendedShape)}</strong>
//               {' '}(으)로 출력 신청되었습니다.
//             </p>
//             <button type="button" className="scan-result-cta" onClick={() => {
//               const shapeId = selectedShape ?? result.recommendedShape
//               const shapeLabelKo = getNailShape(shapeId)?.labelKo ?? shapeId
//               addNailTipPrintOrder({ shapeId, shapeLabelKo })
//               setPrintConfirmed(true)
//               setShowPrintModal(false)
//             }}>
//               확인
//             </button>
//           </div>
//         </div>,
//         document.body   // AppShell 바깥 body에 직접 마운트
//       )}

//     </AppShell>
//   )
// }


//수정
import { useState } from 'react'
import { createPortal } from 'react-dom'  // 추가
import { useNavigate, useLocation } from 'react-router-dom'
import { AppShell } from '@/components/layout/AppShell'
import { PageBackLink } from '@/components/layout/PageBackLink'
import { FingerDetailModal } from '@/components/handScan/FingerDetailModal'
import { getNailShape, NAIL_SHAPES } from '@/constants/nailShapes'
import { getHandScanResult } from '@/utils/handScanStorage'
import { addNailTipPrintOrder, saveHandScanRecord, type HandScanRecord } from '@/utils/mypageStorage'
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
  const location = useLocation()
  const fromMypage = !!(location.state as { fromMypage?: boolean } | null)?.fromMypage
  const recordFromState = (location.state as { record?: HandScanRecord } | null)?.record ?? null

  // 마이페이지에서 넘어온 경우 state의 record 사용, 아니면 sessionStorage 사용
  const result = recordFromState ?? getHandScanResult()

  const [showFingerModal, setShowFingerModal] = useState(false)
  const [selectedShape, setSelectedShape] = useState<string | null>(null)   //추가
  const [showPrintModal, setShowPrintModal] = useState(false)   //추가
  const [printConfirmed, setPrintConfirmed] = useState(false)

  // 새 스캔 결과 진입 시에만 마이페이지에 저장 (마이페이지에서 온 경우 제외)
  useState(() => {
    if (!fromMypage && result) saveHandScanRecord(result)
  })

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
      {fromMypage
        ? <PageBackLink to="/mypage" label="손 분석 기록" state={{ tab: 'scan' }} />
        : <PageBackLink to="/scan/hand" label="손 촬영" />
      }

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
        <h2>출력 네일팁 모양</h2>
        <p className="scan-result-section__sub">
          출력할 네일팁 모양을 선택해 주세요.
          당신에게 가장 잘 어울리는 쉐입은{' '}
          <strong>{recommended?.labelKo ?? result.recommendedShape}</strong> 입니다.
        </p>

        {/* <div className="scan-shape-grid">
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
        </div> */}

        <div className="scan-shape-grid">
          {NAIL_SHAPES.map((shape) => {
            const isRecommended = shape.id === result.recommendedShape
            const activeShape = selectedShape ?? result.recommendedShape
            const isSelected = shape.id === activeShape
            return (
              <article
                key={shape.id}
                className={`scan-shape-card ${isRecommended ? 'is-recommended' : ''} ${isSelected ? 'is-selected' : ''}`}
                onClick={() => setSelectedShape(shape.id)}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => e.key === 'Enter' && setSelectedShape(shape.id)}
                aria-pressed={isSelected}
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
        <button type="button" className="scan-result-cta" onClick={() => setShowPrintModal(true)} disabled={printConfirmed}>
          {printConfirmed ? '출력 신청 완료 ✓' : '네일팁 출력하기'}
        </button>
        <button type="button" className="scan-result-cta" onClick={() => navigate('/design/preferences')}>
          네일 디자인 생성하기
        </button>
      </div>

      {showFingerModal && (
        <FingerDetailModal fingers={result.fingers} onClose={() => setShowFingerModal(false)} />
      )}

      {showPrintModal && createPortal(
        <div className="print-modal">
          <button type="button" className="print-modal__backdrop" onClick={() => setShowPrintModal(false)} />
          <div className="print-modal__panel" role="dialog" aria-modal="true">
            <p className="print-modal__icon">🖨️</p>
            <h2>출력 신청 완료</h2>
            <p>
              당신의 네일팁이{' '}
              <strong>{getNailShape(selectedShape ?? result.recommendedShape)?.labelKo ?? (selectedShape ?? result.recommendedShape)}</strong>
              {' '}(으)로 출력 신청되었습니다.
            </p>
            <button type="button" className="scan-result-cta" onClick={() => {
              const shapeId = selectedShape ?? result.recommendedShape
              const shapeLabelKo = getNailShape(shapeId)?.labelKo ?? shapeId
              addNailTipPrintOrder({ shapeId, shapeLabelKo })
              setPrintConfirmed(true)
              setShowPrintModal(false)
            }}>
              확인
            </button>
          </div>
        </div>,
        document.body   // AppShell 바깥 body에 직접 마운트
      )}

    </AppShell>
  )
}
