// import { useEffect, useState } from 'react'
// import { createPortal } from 'react-dom'
// import { useNavigate, useLocation } from 'react-router-dom'
// import { AppShell } from '@/components/layout/AppShell'
// import { PageBackLink } from '@/components/layout/PageBackLink'
// import { FingerDetailModal } from '@/components/handScan/FingerDetailModal'
// import { getNailShape, NAIL_SHAPES } from '@/constants/nailShapes'
// import { addNailTipPrintOrder } from '@/utils/mypageStorage'
// import { getScanResult, generateStl, type ScanResultResponse } from '@/api/scan'
// import { ApiError } from '@/utils/apiClient'
// import '@/styles/hand-scan-result.css'
//
// function MetricCard({ title, value, hint }: { title: string; value: string; hint: string }) {
//     return (
//         <article className="scan-metric-card">
//             <h3>{title}</h3>
//             <p className="scan-metric-card__value">{value}</p>
//             <p className="scan-metric-card__hint">{hint}</p>
//         </article>
//     )
// }
//
// export function HandScanResultPage() {
//     const navigate = useNavigate()
//     const location = useLocation()
//     const scanId = (location.state as { scanId?: number })?.scanId
//     const fromMypage = !!(location.state as { fromMypage?: boolean } | null)?.fromMypage
//
//     const [result, setResult] = useState<ScanResultResponse | null>(null)
//     const [isLoading, setIsLoading] = useState(true)
//     const [error, setError] = useState<string | null>(null)
//     const [showFingerModal, setShowFingerModal] = useState(false)
//     const [selectedShape, setSelectedShape] = useState<string>('round')
//     const [isGeneratingStl, setIsGeneratingStl] = useState(false)
//     const [showPrintModal, setShowPrintModal] = useState(false)
//     const [printConfirmed, setPrintConfirmed] = useState(false)
//
//     // 폴링: GET /scans/{scanId} — status가 MEASURED 또는 COMPLETED 될 때까지
//     useEffect(() => {
//         if (!scanId) {
//             return
//         }
//
//         const fetchResult = async (): Promise<string | null> => {
//             try {
//                 const data = await getScanResult(scanId)
//                 // 추가
//                 console.log("status =", data.status)
//                 setResult(data)
//                 if (data.shape) setSelectedShape(data.shape)
//
//                 return data.status
//             } catch (e) {
//                 const msg = e instanceof ApiError ? e.message : '오류가 발생했습니다.'
//                 setError(msg)
//                 return null
//             } finally {
//                 setIsLoading(false)
//             }
//         }
//
//         const poll = async () => {
//             const status = await fetchResult()
//             // READY | ANALYZING 상태면 3초 후 재시도
//             if (status !== null && status !== 'MEASURED' && status !== 'COMPLETED' && status !== 'FAILED') {
//                 setTimeout(() => void poll(), 3000)
//             }
//         }
//
//         void poll()
//     }, [scanId, fromMypage])
//
//     // POST /scans/{scanId}/generate-stl { shape }
//     const handleGenerateStl = async () => {
//         if (!scanId) return
//         setIsGeneratingStl(true)
//         try {
//             await generateStl(scanId, selectedShape)
//             navigate('/design/preferences', { state: { scanId } })
//         } catch (e) {
//             const msg = e instanceof ApiError ? e.message : 'STL 생성 요청에 실패했습니다.'
//             alert(msg)
//         } finally {
//             setIsGeneratingStl(false)
//         }
//     }
//
//     if (isLoading) {
//         return (
//             <AppShell>
//                 <div className="scan-result-empty">
//                     <p>결과를 불러오는 중...</p>
//                 </div>
//             </AppShell>
//         )
//     }
//
//     if (!scanId || !result || error) {
//         return (
//             <AppShell>
//                 <PageBackLink to="/scan/hand" label="손 촬영" />
//                 <div className="scan-result-empty">
//                     <p>{error ?? '손 스캔 결과가 없습니다. 먼저 손 촬영을 진행해 주세요.'}</p>
//                     <button type="button" className="scan-result-cta" onClick={() => navigate('/scan/hand')}>
//                         손 촬영하러 가기
//                     </button>
//                 </div>
//             </AppShell>
//         )
//     }
//
//     const recommended = getNailShape(result.shape)
//
//     return (
//         <AppShell mainClassName="scan-result-page">
//             {fromMypage
//                 ? <PageBackLink to="/mypage" label="손 분석 기록" state={{ tab: 'scan' }} />
//                 : <PageBackLink to="/scan/hand" label="손 촬영" />
//             }
//
//             <header className="scan-result-hero">
//                 <p className="scan-result-hero__eyebrow">Hand Scan Analysis</p>
//                 <h1>손 스캔 분석 결과</h1>
//                 <p>손 스캔이 완료되었습니다.</p>
//             </header>
//
//             <section className="scan-result-section">
//                 <div className="scan-result-section__head">
//                     <h2>손톱 기본 지표</h2>
//                     {result.fingers.length > 0 && (
//                         <button type="button" className="scan-result-link" onClick={() => setShowFingerModal(true)}>
//                             상세보기
//                         </button>
//                     )}
//                 </div>
//                 <div className="scan-result-metrics">
//                     <MetricCard title="전체 크기" value={result.overallSize ?? '-'} hint="손톱 전체 크기 분류" />
//                     <MetricCard title="손 방향" value={result.handSide === 'RIGHT' ? '오른손' : '왼손'} hint="촬영한 손 방향" />
//                     <MetricCard title="분석 상태" value={result.status} hint="현재 분석 진행 상태" />
//                 </div>
//             </section>
//
//             {result.skinToneHex && (
//                 <section className="scan-result-section scan-result-section--grid">
//                     <article className="scan-tone-card">
//                         <h2>피부 톤</h2>
//                         <div className="scan-tone-card__swatch" style={{ background: result.skinToneHex }} />
//                         <p className="scan-tone-card__hex">{result.skinToneHex}</p>
//                         <p className="scan-tone-card__desc">손등·손바닥 영역에서 추출한 대표 피부색 HEX 값입니다.</p>
//                     </article>
//
//                     {result.recommendedColors && result.recommendedColors.length > 0 && (
//                         <article className="scan-season-card">
//                             <h2>추천 컬러</h2>
//                             <div className="scan-palette">
//                                 {result.recommendedColors.map((hex) => (
//                                     <button
//                                         key={hex}
//                                         type="button"
//                                         className="scan-palette__chip"
//                                         style={{ background: hex }}
//                                         title={hex}
//                                         aria-label={`팔레트 색 ${hex}`}
//                                     />
//                                 ))}
//                             </div>
//                             <p className="scan-season-card__desc">당신에게 어울리는 추천 컬러 팔레트입니다.</p>
//                         </article>
//                     )}
//                 </section>
//             )}
//
//             <section className="scan-result-section">
//                 <h2>네일팁 모양 선택</h2>
//                 <p className="scan-result-section__sub">
//                     추천 쉐입은 <strong>{recommended?.labelKo ?? result.shape}</strong>입니다. 원하는 모양을 선택해 주세요.
//                 </p>
//                 <div className="scan-shape-grid">
//                     {NAIL_SHAPES.map((shape) => {
//                         const isRecommended = shape.id === result.shape
//                         const isSelected = shape.id === selectedShape
//                         return (
//                             <article
//                                 key={shape.id}
//                                 className={`scan-shape-card ${isSelected ? 'is-recommended' : ''} ${isSelected ? 'is-selected' : ''}`}
//                                 onClick={() => setSelectedShape(shape.id)}
//                                 role="button"
//                                 tabIndex={0}
//                                 onKeyDown={(e) => e.key === 'Enter' && setSelectedShape(shape.id)}
//                                 aria-pressed={isSelected}
//                                 style={{ cursor: 'pointer' }}
//                             >
//                                 {isRecommended && <span className="scan-shape-card__badge">추천</span>}
//                                 <img src={shape.image} alt={shape.labelKo} />
//                                 <h3>{shape.labelKo}</h3>
//                                 <p>{shape.labelEn}</p>
//                             </article>
//                         )
//                     })}
//                 </div>
//             </section>
//
//             <div className="scan-result-actions">
//                 <button
//                     type="button"
//                     className="scan-result-cta"
//                     onClick={() => setShowPrintModal(true)}
//                     disabled={printConfirmed}
//                 >
//                     {printConfirmed ? '출력 신청 완료 ✓' : '네일팁 출력하기'}
//                 </button>
//                 <button
//                     type="button"
//                     className="scan-result-cta"
//                     onClick={() => void handleGenerateStl()}
//                     disabled={isGeneratingStl}
//                 >
//                     {isGeneratingStl ? 'STL 생성 중...' : '네일 디자인 생성하기'}
//                 </button>
//             </div>
//
//             {showFingerModal && result.fingers.length > 0 && (
//                 <FingerDetailModal fingers={result.fingers as never} onClose={() => setShowFingerModal(false)} />
//             )}
//
//             {showPrintModal && createPortal(
//                 <div className="print-modal">
//                     <button type="button" className="print-modal__backdrop" onClick={() => setShowPrintModal(false)} />
//                     <div className="print-modal__panel" role="dialog" aria-modal="true">
//                         <p className="print-modal__icon">🖨️</p>
//                         <h2>출력 신청 완료</h2>
//                         <p>
//                             당신의 네일팁이{' '}
//                             <strong>{getNailShape(selectedShape)?.labelKo ?? selectedShape}</strong>
//                             {' '}(으)로 출력 신청되었습니다.
//                         </p>
//                         <button
//                             type="button"
//                             className="scan-result-cta"
//                             onClick={() => {
//                                 const shapeLabelKo = getNailShape(selectedShape)?.labelKo ?? selectedShape
//                                 addNailTipPrintOrder({ shapeId: selectedShape, shapeLabelKo })
//                                 setPrintConfirmed(true)
//                                 setShowPrintModal(false)
//                             }}
//                         >
//                             확인
//                         </button>
//                     </div>
//                 </div>,
//                 document.body,
//             )}
//         </AppShell>
//     )
// }
//
// import { useEffect, useState } from 'react'
// import { createPortal } from 'react-dom'
// import { useNavigate, useLocation } from 'react-router-dom'
// import { AppShell } from '@/components/layout/AppShell'
// import { PageBackLink } from '@/components/layout/PageBackLink'
// import { FingerDetailModal } from '@/components/handScan/FingerDetailModal'
// import { getNailShape, NAIL_SHAPES } from '@/constants/nailShapes'
// import { addNailTipPrintOrder } from '@/utils/mypageStorage'
// import { getScanResult, generateStl, type ScanResultResponse } from '@/api/scan'
// import { ApiError } from '@/utils/apiClient'
// import '@/styles/hand-scan-result.css'
//
// function MetricCard({ title, value, hint }: { title: string; value: string; hint: string }) {
//     return (
//         <article className="scan-metric-card">
//             <h3>{title}</h3>
//             <p className="scan-metric-card__value">{value}</p>
//             <p className="scan-metric-card__hint">{hint}</p>
//         </article>
//     )
// }
//
// export function HandScanResultPage() {
//     const navigate = useNavigate()
//     const location = useLocation()
//     const scanId = (location.state as { scanId?: number })?.scanId
//     const fromMypage = !!(location.state as { fromMypage?: boolean } | null)?.fromMypage
//
//     const [result, setResult] = useState<ScanResultResponse | null>(null)
//     const [isLoading, setIsLoading] = useState(true)
//     const [error, setError] = useState<string | null>(null)
//     const [showFingerModal, setShowFingerModal] = useState(false)
//     const [selectedShape, setSelectedShape] = useState<string>('round')
//     const [isGeneratingStl, setIsGeneratingStl] = useState(false)
//     const [showPrintModal, setShowPrintModal] = useState(false)
//     const [printConfirmed, setPrintConfirmed] = useState(false)
//
//     // 폴링: GET /scans/{scanId} — status가 MEASURED 또는 COMPLETED 될 때까지
//     useEffect(() => {
//         if (!scanId) {
//             return
//         }
//
//         const fetchResult = async (): Promise<string | null> => {
//             try {
//                 const data = await getScanResult(scanId)
//                 // 추가
//                 console.log("status =", data.status)
//                 setResult(data)
//                 if (data.shape) setSelectedShape(data.shape)
//
//                 return data.status
//             } catch (e) {
//                 const msg = e instanceof ApiError ? e.message : '오류가 발생했습니다.'
//                 setError(msg)
//                 return null
//             } finally {
//                 setIsLoading(false)
//             }
//         }
//
//         const poll = async () => {
//             const status = await fetchResult()
//             // READY | ANALYZING 상태면 3초 후 재시도
//             if (status !== null && status !== 'MEASURED' && status !== 'COMPLETED' && status !== 'FAILED') {
//                 setTimeout(() => void poll(), 3000)
//             }
//         }
//
//         void poll()
//     }, [scanId, fromMypage])
//
//     // 네일 디자인 생성하기 → 디자인 선호도 페이지로 이동
//     const handleGoToDesign = () => {
//         navigate('/design/preferences', { state: { scanId } })
//     }
//
//     // POST /scans/{scanId}/generate-stl { shape } — 네일팁 출력하기 버튼에서 호출
//     const handleGenerateStl = async () => {
//         if (!scanId) return
//         setIsGeneratingStl(true)
//         try {
//             await generateStl(scanId, selectedShape)
//             const shapeLabelKo = getNailShape(selectedShape)?.labelKo ?? selectedShape
//             addNailTipPrintOrder({ shapeId: selectedShape, shapeLabelKo })
//             setPrintConfirmed(true)
//             setShowPrintModal(true)
//         } catch (e) {
//             const msg = e instanceof ApiError ? e.message : 'STL 생성 요청에 실패했습니다.'
//             alert(msg)
//         } finally {
//             setIsGeneratingStl(false)
//         }
//     }
//
//     if (isLoading) {
//         return (
//             <AppShell>
//                 <div className="scan-result-empty">
//                     <p>결과를 불러오는 중...</p>
//                 </div>
//             </AppShell>
//         )
//     }
//
//     if (!scanId || !result || error) {
//         return (
//             <AppShell>
//                 <PageBackLink to="/scan/hand" label="손 촬영" />
//                 <div className="scan-result-empty">
//                     <p>{error ?? '손 스캔 결과가 없습니다. 먼저 손 촬영을 진행해 주세요.'}</p>
//                     <button type="button" className="scan-result-cta" onClick={() => navigate('/scan/hand')}>
//                         손 촬영하러 가기
//                     </button>
//                 </div>
//             </AppShell>
//         )
//     }
//
//     const recommended = getNailShape(result.shape)
//
//     return (
//         <AppShell mainClassName="scan-result-page">
//             {fromMypage
//                 ? <PageBackLink to="/mypage" label="손 분석 기록" state={{ tab: 'scan' }} />
//                 : <PageBackLink to="/scan/hand" label="손 촬영" />
//             }
//
//             <header className="scan-result-hero">
//                 <p className="scan-result-hero__eyebrow">Hand Scan Analysis</p>
//                 <h1>손 스캔 분석 결과</h1>
//                 <p>손 스캔이 완료되었습니다.</p>
//             </header>
//
//             <section className="scan-result-section">
//                 <div className="scan-result-section__head">
//                     <h2>손톱 기본 지표</h2>
//                     {result.fingers.length > 0 && (
//                         <button type="button" className="scan-result-link" onClick={() => setShowFingerModal(true)}>
//                             상세보기
//                         </button>
//                     )}
//                 </div>
//                 <div className="scan-result-metrics">
//                     <MetricCard title="전체 크기" value={result.overallSize ?? '-'} hint="손톱 전체 크기 분류" />
//                     <MetricCard title="손 방향" value={result.handSide === 'RIGHT' ? '오른손' : '왼손'} hint="촬영한 손 방향" />
//                     <MetricCard title="분석 상태" value={result.status} hint="현재 분석 진행 상태" />
//                 </div>
//             </section>
//
//             {result.skinToneHex && (
//                 <section className="scan-result-section scan-result-section--grid">
//                     <article className="scan-tone-card">
//                         <h2>피부 톤</h2>
//                         <div className="scan-tone-card__swatch" style={{ background: result.skinToneHex }} />
//                         <p className="scan-tone-card__hex">{result.skinToneHex}</p>
//                         <p className="scan-tone-card__desc">손등·손바닥 영역에서 추출한 대표 피부색 HEX 값입니다.</p>
//                     </article>
//
//                     {result.recommendedColors && result.recommendedColors.length > 0 && (
//                         <article className="scan-season-card">
//                             <h2>추천 컬러</h2>
//                             <div className="scan-palette">
//                                 {result.recommendedColors.map((hex) => (
//                                     <button
//                                         key={hex}
//                                         type="button"
//                                         className="scan-palette__chip"
//                                         style={{ background: hex }}
//                                         title={hex}
//                                         aria-label={`팔레트 색 ${hex}`}
//                                     />
//                                 ))}
//                             </div>
//                             <p className="scan-season-card__desc">당신에게 어울리는 추천 컬러 팔레트입니다.</p>
//                         </article>
//                     )}
//                 </section>
//             )}
//
//             <section className="scan-result-section">
//                 <h2>네일팁 모양 선택</h2>
//                 <p className="scan-result-section__sub">
//                     추천 쉐입은 <strong>{recommended?.labelKo ?? result.shape}</strong>입니다. 원하는 모양을 선택해 주세요.
//                 </p>
//                 <div className="scan-shape-grid">
//                     {NAIL_SHAPES.map((shape) => {
//                         const isRecommended = shape.id === result.shape
//                         const isSelected = shape.id === selectedShape
//                         return (
//                             <article
//                                 key={shape.id}
//                                 className={`scan-shape-card ${isSelected ? 'is-recommended' : ''} ${isSelected ? 'is-selected' : ''}`}
//                                 onClick={() => setSelectedShape(shape.id)}
//                                 role="button"
//                                 tabIndex={0}
//                                 onKeyDown={(e) => e.key === 'Enter' && setSelectedShape(shape.id)}
//                                 aria-pressed={isSelected}
//                                 style={{ cursor: 'pointer' }}
//                             >
//                                 {isRecommended && <span className="scan-shape-card__badge">추천</span>}
//                                 <img src={shape.image} alt={shape.labelKo} />
//                                 <h3>{shape.labelKo}</h3>
//                                 <p>{shape.labelEn}</p>
//                             </article>
//                         )
//                     })}
//                 </div>
//             </section>
//
//             <div className="scan-result-actions">
//                 <button
//                     type="button"
//                     className="scan-result-cta"
//                     onClick={() => void handleGenerateStl()}
//                     disabled={printConfirmed || isGeneratingStl}
//                 >
//                     {isGeneratingStl ? 'STL 생성 중...' : printConfirmed ? '출력 신청 완료 ✓' : '네일팁 출력하기'}
//                 </button>
//                 <button
//                     type="button"
//                     className="scan-result-cta"
//                     onClick={handleGoToDesign}
//                 >
//                     네일 디자인 생성하기
//                 </button>
//             </div>
//
//             {showFingerModal && result.fingers.length > 0 && (
//                 <FingerDetailModal fingers={result.fingers as never} onClose={() => setShowFingerModal(false)} />
//             )}
//
//             {showPrintModal && createPortal(
//                 <div className="print-modal">
//                     <button type="button" className="print-modal__backdrop" onClick={() => setShowPrintModal(false)} />
//                     <div className="print-modal__panel" role="dialog" aria-modal="true">
//                         <p className="print-modal__icon">🖨️</p>
//                         <h2>출력 신청 완료</h2>
//                         <p>
//                             당신의 네일팁이{' '}
//                             <strong>{getNailShape(selectedShape)?.labelKo ?? selectedShape}</strong>
//                             {' '}(으)로 출력 신청되었습니다.
//                         </p>
//                         <button
//                             type="button"
//                             className="scan-result-cta"
//                             onClick={() => setShowPrintModal(false)}
//                         >
//                             확인
//                         </button>
//                     </div>
//                 </div>,
//                 document.body,
//             )}
//         </AppShell>
//     )
// }

// import { useEffect, useState } from 'react'
// import { createPortal } from 'react-dom'
// import { useNavigate, useLocation } from 'react-router-dom'
// import { AppShell } from '@/components/layout/AppShell'
// import { PageBackLink } from '@/components/layout/PageBackLink'
// import { FingerDetailModal } from '@/components/handScan/FingerDetailModal'
// import { getNailShape, NAIL_SHAPES } from '@/constants/nailShapes'
// import { addNailTipPrintOrder } from '@/utils/mypageStorage'
// import { getScanResult, generateStl, type ScanResultResponse } from '@/apis/scan'
// import { ApiError } from '@/utils/apiClient'
// import { PERSONAL_COLOR_SWATCHES, SEASON_ROWS } from '@/constants/designPreferences'
// import '@/styles/hand-scan-result.css'
//
// function MetricCard({ title, value, hint }: { title: string; value: string; hint: string }) {
//     return (
//         <article className="scan-metric-card">
//             <h3>{title}</h3>
//             <p className="scan-metric-card__value">{value}</p>
//             <p className="scan-metric-card__hint">{hint}</p>
//         </article>
//     )
// }
//
// export function HandScanResultPage() {
//     const navigate = useNavigate()
//     const location = useLocation()
//     const scanId = (location.state as { scanId?: number })?.scanId
//     const fromMypage = !!(location.state as { fromMypage?: boolean } | null)?.fromMypage
//
//     const [result, setResult] = useState<ScanResultResponse | null>(null)
//     const [isLoading, setIsLoading] = useState(true)
//     const [error, setError] = useState<string | null>(null)
//     const [showFingerModal, setShowFingerModal] = useState(false)
//     const [selectedShape, setSelectedShape] = useState<string>('round')
//     const [isGeneratingStl, setIsGeneratingStl] = useState(false)
//     const [showPrintModal, setShowPrintModal] = useState(false)
//     const [printConfirmed, setPrintConfirmed] = useState(false)
//
//     useEffect(() => {
//         if (!scanId) return
//
//         const fetchResult = async (): Promise<string | null> => {
//             try {
//                 const data = await getScanResult(scanId)
//                 console.log("status =", data.status)
//                 setResult(data)
//                 if (data.shape) setSelectedShape(data.shape)
//                 return data.status
//             } catch (e) {
//                 const msg = e instanceof ApiError ? e.message : '오류가 발생했습니다.'
//                 setError(msg)
//                 return null
//             } finally {
//                 setIsLoading(false)
//             }
//         }
//
//         const poll = async () => {
//             const status = await fetchResult()
//             if (status !== null && status !== 'MEASURED' && status !== 'COMPLETED' && status !== 'FAILED') {
//                 setTimeout(() => void poll(), 3000)
//             }
//         }
//
//         void poll()
//     }, [scanId, fromMypage])
//
//     const handleGoToDesign = () => {
//         navigate('/design/preferences', {
//             state: { scanId, seasonCode: result?.seasonCode ?? null },
//         })
//     }
//
//     const handleGenerateStl = async () => {
//         if (!scanId) return
//         setIsGeneratingStl(true)
//         try {
//             await generateStl(scanId, selectedShape)
//             const shapeLabelKo = getNailShape(selectedShape)?.labelKo ?? selectedShape
//             addNailTipPrintOrder({ shapeId: selectedShape, shapeLabelKo })
//             setPrintConfirmed(true)
//             setShowPrintModal(true)
//         } catch (e) {
//             const msg = e instanceof ApiError ? e.message : 'STL 생성 요청에 실패했습니다.'
//             alert(msg)
//         } finally {
//             setIsGeneratingStl(false)
//         }
//     }
//
//     if (isLoading) {
//         return (
//             <AppShell>
//                 <div className="scan-result-empty">
//                     <p>결과를 불러오는 중...</p>
//                 </div>
//             </AppShell>
//         )
//     }
//
//     if (!scanId || !result || error) {
//         return (
//             <AppShell>
//                 <PageBackLink to="/scan/hand" label="손 촬영" />
//                 <div className="scan-result-empty">
//                     <p>{error ?? '손 스캔 결과가 없습니다. 먼저 손 촬영을 진행해 주세요.'}</p>
//                     <button type="button" className="scan-result-cta" onClick={() => navigate('/scan/hand')}>
//                         손 촬영하러 가기
//                     </button>
//                 </div>
//             </AppShell>
//         )
//     }
//
//     const recommended = getNailShape(result.shape)
//     const seasonRow = SEASON_ROWS.find(r => r.code === result.seasonCode)
//     const personalColorSwatches = result.seasonCode ? (PERSONAL_COLOR_SWATCHES[result.seasonCode] ?? []) : []
//
//     return (
//         <AppShell mainClassName="scan-result-page">
//             {fromMypage
//                 ? <PageBackLink to="/mypage" label="손 분석 기록" state={{ tab: 'scan' }} />
//                 : <PageBackLink to="/scan/hand" label="손 촬영" />
//             }
//
//             <header className="scan-result-hero">
//                 <p className="scan-result-hero__eyebrow">Hand Scan Analysis</p>
//                 <h1>손 스캔 분석 결과</h1>
//                 <p>손 스캔이 완료되었습니다.</p>
//             </header>
//
//             <section className="scan-result-section">
//                 <div className="scan-result-section__head">
//                     <h2>손톱 기본 지표</h2>
//                     {result.fingers.length > 0 && (
//                         <button type="button" className="scan-result-link" onClick={() => setShowFingerModal(true)}>
//                             상세보기
//                         </button>
//                     )}
//                 </div>
//                 <div className="scan-result-metrics">
//                     <MetricCard title="전체 크기" value={result.overallSize ?? '-'} hint="손톱 전체 크기 분류" />
//                     <MetricCard title="손 방향" value={result.handSide === 'RIGHT' ? '오른손' : '왼손'} hint="촬영한 손 방향" />
//                     <MetricCard title="분석 상태" value={result.status} hint="현재 분석 진행 상태" />
//                 </div>
//             </section>
//
//             {result.seasonCode && (
//                 <section className="scan-result-section scan-result-section--grid">
//                     <article className="scan-tone-card">
//                         <h2>퍼스널 컬러</h2>
//                         <p className="scan-tone-card__hex" style={{ fontSize: '1.1rem', fontWeight: 700 }}>
//                             {result.seasonNameKo ?? result.seasonCode}
//                         </p>
//                         {seasonRow && (
//                             <p className="scan-tone-card__desc">
//                                 {seasonRow.tone} 톤 · {seasonRow.brightness} · {seasonRow.saturation}
//                             </p>
//                         )}
//                         {/*{result.skinToneHex && (*/}
//                         {/*    <>*/}
//                         {/*        <div className="scan-tone-card__swatch" style={{ background: result.skinToneHex }} />*/}
//                         {/*        <p className="scan-tone-card__hex">{result.skinToneHex}</p>*/}
//                         {/*    </>*/}
//                         {/*)}*/}
//                     </article>
//
//                     {personalColorSwatches.length > 0 && (
//                         <article className="scan-season-card">
//                             <h2>추천 컬러</h2>
//                             <div className="scan-palette">
//                                 {personalColorSwatches.map((hex) => (
//                                     <button
//                                         key={hex}
//                                         type="button"
//                                         className="scan-palette__chip"
//                                         style={{ background: hex }}
//                                         title={hex}
//                                         aria-label={`팔레트 색 ${hex}`}
//                                     />
//                                 ))}
//                             </div>
//                             <p className="scan-season-card__desc">
//                                 {result.seasonNameKo} 타입에 어울리는 추천 컬러 팔레트입니다.
//                             </p>
//                         </article>
//                     )}
//                 </section>
//             )}
//
//             <section className="scan-result-section">
//                 <h2>네일팁 모양 선택</h2>
//                 <p className="scan-result-section__sub">
//                     추천 쉐입은 <strong>{recommended?.labelKo ?? result.shape}</strong>입니다. 원하는 모양을 선택해 주세요.
//                 </p>
//                 <div className="scan-shape-grid">
//                     {NAIL_SHAPES.map((shape) => {
//                         const isRecommended = shape.id === result.shape
//                         const isSelected = shape.id === selectedShape
//                         return (
//                             <article
//                                 key={shape.id}
//                                 className={`scan-shape-card ${isSelected ? 'is-recommended' : ''} ${isSelected ? 'is-selected' : ''}`}
//                                 onClick={() => setSelectedShape(shape.id)}
//                                 role="button"
//                                 tabIndex={0}
//                                 onKeyDown={(e) => e.key === 'Enter' && setSelectedShape(shape.id)}
//                                 aria-pressed={isSelected}
//                                 style={{ cursor: 'pointer' }}
//                             >
//                                 {isRecommended && <span className="scan-shape-card__badge">추천</span>}
//                                 <img src={shape.image} alt={shape.labelKo} />
//                                 <h3>{shape.labelKo}</h3>
//                                 <p>{shape.labelEn}</p>
//                             </article>
//                         )
//                     })}
//                 </div>
//             </section>
//
//             <div className="scan-result-actions">
//                 <button
//                     type="button"
//                     className="scan-result-cta"
//                     onClick={() => void handleGenerateStl()}
//                     disabled={printConfirmed || isGeneratingStl}
//                 >
//                     {isGeneratingStl ? 'STL 생성 중...' : printConfirmed ? '출력 신청 완료 ✓' : '네일팁 출력하기'}
//                 </button>
//                 <button
//                     type="button"
//                     className="scan-result-cta"
//                     onClick={handleGoToDesign}
//                 >
//                     네일 디자인 생성하기
//                 </button>
//             </div>
//
//             {showFingerModal && result.fingers.length > 0 && (
//                 <FingerDetailModal fingers={result.fingers as never} onClose={() => setShowFingerModal(false)} />
//             )}
//
//             {showPrintModal && createPortal(
//                 <div className="print-modal">
//                     <button type="button" className="print-modal__backdrop" onClick={() => setShowPrintModal(false)} />
//                     <div className="print-modal__panel" role="dialog" aria-modal="true">
//                         <p className="print-modal__icon">🖨️</p>
//                         <h2>출력 신청 완료</h2>
//                         <p>
//                             당신의 네일팁이{' '}
//                             <strong>{getNailShape(selectedShape)?.labelKo ?? selectedShape}</strong>
//                             {' '}(으)로 출력 신청되었습니다.
//                         </p>
//                         <button
//                             type="button"
//                             className="scan-result-cta"
//                             onClick={() => setShowPrintModal(false)}
//                         >
//                             확인
//                         </button>
//                     </div>
//                 </div>,
//                 document.body,
//             )}
//         </AppShell>
//     )
// }

//0713 수정
import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate, useLocation } from 'react-router-dom'
import { AppShell } from '@/components/layout/AppShell'
import { PageBackLink } from '@/components/layout/PageBackLink'
import { FingerDetailModal } from '@/components/handScan/FingerDetailModal'
import { getNailShape, NAIL_SHAPES } from '@/constants/nailShapes'
import { addNailTipPrintOrder } from '@/utils/mypageStorage'
import { getScanResult, generateStl, type ScanResultResponse } from '@/apis/scan'
import { ApiError } from '@/utils/apiClient'
import { PERSONAL_COLOR_SWATCHES, SEASON_ROWS } from '@/constants/designPreferences'
import '@/styles/hand-scan-result.css'
import type { FingerDetail } from '@/utils/handScanAnalysis'

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
    const scanId = (location.state as { scanId?: number })?.scanId
    const fromMypage = !!(location.state as { fromMypage?: boolean } | null)?.fromMypage

    const [result, setResult] = useState<ScanResultResponse | null>(null)
    const [isLoading, setIsLoading] = useState(true)
    const [error, setError] = useState<string | null>(null)
    const [showFingerModal, setShowFingerModal] = useState(false)
    const [selectedShape, setSelectedShape] = useState<string>('round')
    const [isGeneratingStl, setIsGeneratingStl] = useState(false)
    const [showPrintModal, setShowPrintModal] = useState(false)
    const [printConfirmed, setPrintConfirmed] = useState(false)

    // TODO: 백엔드에 길이/너비/곡률 통계 API 완성되면 이 상수 제거하고
    // result.length / result.width / result.cCurve 로 교체
    const MOCK_METRICS = {
        length: { value: 12.5, unit: 'mm', percentile: 68, comparisonLabel: '평균보다 약간 긺' },
        width: { value: 14.2, unit: 'mm', percentile: 55, comparisonLabel: '평균과 비슷함' },
        cCurve: { value: 0.62, unit: '', percentile: 72, comparisonLabel: '곡률이 뚜렷한 편' },
    }

    useEffect(() => {
        if (!scanId) return

        const fetchResult = async (): Promise<string | null> => {
            try {
                const data = await getScanResult(scanId)
                console.log("status =", data.status)
                setResult(data)
                if (data.shape) setSelectedShape(data.shape)
                return data.status
            } catch (e) {
                const msg = e instanceof ApiError ? e.message : '오류가 발생했습니다.'
                setError(msg)
                return null
            } finally {
                setIsLoading(false)
            }
        }


        const poll = async () => {
            const status = await fetchResult()
            if (status !== null && status !== 'MEASURED' && status !== 'COMPLETED' && status !== 'FAILED') {
                setTimeout(() => void poll(), 3000)
            }
        }

        void poll()
    }, [scanId, fromMypage])

    const handleGoToDesign = () => {
        navigate('/design/preferences', {
            state: { scanId, seasonCode: result?.seasonCode ?? null },
        })
    }

    const handleGenerateStl = async () => {
        if (!scanId) return
        setIsGeneratingStl(true)
        try {
            await generateStl(scanId, selectedShape)
            const shapeLabelKo = getNailShape(selectedShape)?.labelKo ?? selectedShape
            addNailTipPrintOrder({ shapeId: selectedShape, shapeLabelKo })
            setPrintConfirmed(true)
            setShowPrintModal(true)
        } catch (e) {
            const msg = e instanceof ApiError ? e.message : 'STL 생성 요청에 실패했습니다.'
            alert(msg)
        } finally {
            setIsGeneratingStl(false)
        }
    }

    if (isLoading) {
        return (
            <AppShell>
                <div className="scan-result-empty">
                    <p>결과를 불러오는 중...</p>
                </div>
            </AppShell>
        )
    }

    if (!scanId || !result || error) {
        return (
            <AppShell>
                <PageBackLink to="/scan/hand" label="손 촬영" />
                <div className="scan-result-empty">
                    <p>{error ?? '손 스캔 결과가 없습니다. 먼저 손 촬영을 진행해 주세요.'}</p>
                    <button type="button" className="scan-result-cta" onClick={() => navigate('/scan/hand')}>
                        손 촬영하러 가기
                    </button>
                </div>
            </AppShell>
        )
    }

    const recommended = getNailShape(result.shape)
    const seasonRow = SEASON_ROWS.find(r => r.code === result.seasonCode)
    const personalColorSwatches = result.seasonCode ? (PERSONAL_COLOR_SWATCHES[result.seasonCode] ?? []) : []

    //0716 추가
    const apiFingers = result?.fingers ?? []

    const displayFingers =
        apiFingers.length === 5
            ? [...apiFingers, ...apiFingers]
            : apiFingers

    const FINGER_OVERLAYS = [
        { x: 42, y: 47 },
        { x: 35, y: 24 },
        { x: 27, y: 16 },
        { x: 19, y: 22 },
        { x: 14, y: 34 },
        { x: 58, y: 47 },
        { x: 65, y: 24 },
        { x: 73, y: 16 },
        { x: 81, y: 22 },
        { x: 86, y: 34 },
    ]

    const FINGER_NAMES = [
        '엄지',
        '검지',
        '중지',
        '약지',
        '소지',
        '엄지 (오른손)',
        '검지 (오른손)',
        '중지 (오른손)',
        '약지 (오른손)',
        '소지 (오른손)',
    ]

    const fingerDetails: FingerDetail[] = displayFingers.map((finger, index) => {
        let measurements: any = {}

        try {
            const parsed = JSON.parse(finger.measurements ?? '{}')
            measurements = parsed || {}
        } catch {
            measurements = {}
        }

        return {
            id: `finger-${index}`,
            name: FINGER_NAMES[index] ?? finger.finger,

            // 백엔드 값이 있으면 사용
            // 없으면 임시 Mock 값
            lengthMm: Number(
                measurements?.lengthMm ??
                measurements?.length ??
                (12 + index * 0.3)
            ),

            widthMm: Number(
                measurements?.widthMm ??
                measurements?.width ??
                (9 + index * 0.2)
            ),

            cCurve: Number(
                measurements?.cCurve ??
                measurements?.curve ??
                0.55
            ),

            overlay: FINGER_OVERLAYS[index] ?? { x: 50, y: 50 },
        }
    })

    return (
        <AppShell mainClassName="scan-result-page">
            {fromMypage
                ? <PageBackLink to="/mypage" label="손 분석 기록" state={{ tab: 'scan' }} />
                : <PageBackLink to="/scan/hand" label="손 촬영" />
            }

            <header className="scan-result-hero">
                <p className="scan-result-hero__eyebrow">Hand Scan Analysis</p>
                <h1>손 스캔 분석 결과</h1>
                <p>손 스캔이 완료되었습니다.</p>
            </header>

            <section className="scan-result-section">
                <div className="scan-result-section__head">
                    <h2>손톱 기본 지표</h2>
                    {result.fingers.length > 0 && (
                        <button type="button" className="scan-result-link" onClick={() => setShowFingerModal(true)}>
                            상세보기
                        </button>
                    )}
                </div>
                <div className="scan-result-metrics">
                    <MetricCard title="길이 (Length)" metric={MOCK_METRICS.length} hint="손톱 끝에서 베이스까지 평균 길이" />
                    <MetricCard title="너비 (Width)" metric={MOCK_METRICS.width} hint="손톱 최대 너비 평균" />
                    <MetricCard
                        title="곡률 (C-curve)"
                        metric={MOCK_METRICS.cCurve}
                        hint="손톱 측면 곡률 지수 (0~1)"
                    />
                </div>
            </section>

            {result.seasonCode && (
                <section className="scan-result-section scan-result-section--grid">
                    <article className="scan-tone-card">
                        <h2>퍼스널 컬러</h2>
                        <p className="scan-tone-card__hex" style={{ fontSize: '1.1rem', fontWeight: 700 }}>
                            {result.seasonNameKo ?? result.seasonCode}
                        </p>
                        {seasonRow && (
                            <p className="scan-tone-card__desc">
                                {seasonRow.tone} 톤 · {seasonRow.brightness} · {seasonRow.saturation}
                            </p>
                        )}
                        {/*{result.skinToneHex && (*/}
                        {/*    <>*/}
                        {/*        <div className="scan-tone-card__swatch" style={{ background: result.skinToneHex }} />*/}
                        {/*        <p className="scan-tone-card__hex">{result.skinToneHex}</p>*/}
                        {/*    </>*/}
                        {/*)}*/}
                    </article>

                    {personalColorSwatches.length > 0 && (
                        <article className="scan-season-card">
                            <h2>추천 컬러</h2>
                            <div className="scan-palette">
                                {personalColorSwatches.map((hex) => (
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
                            <p className="scan-season-card__desc">
                                {result.seasonNameKo} 타입에 어울리는 추천 컬러 팔레트입니다.
                            </p>
                        </article>
                    )}
                </section>
            )}

            <section className="scan-result-section">
                <h2>네일팁 모양 선택</h2>
                <p className="scan-result-section__sub">
                    추천 쉐입은 <strong>{recommended?.labelKo ?? result.shape}</strong>입니다. 원하는 모양을 선택해 주세요.
                </p>
                <div className="scan-shape-grid">
                    {NAIL_SHAPES.map((shape) => {
                        const isRecommended = shape.id === result.shape
                        const isSelected = shape.id === selectedShape
                        return (
                            <article
                                key={shape.id}
                                className={`scan-shape-card ${isSelected ? 'is-recommended' : ''} ${isSelected ? 'is-selected' : ''}`}
                                onClick={() => setSelectedShape(shape.id)}
                                role="button"
                                tabIndex={0}
                                onKeyDown={(e) => e.key === 'Enter' && setSelectedShape(shape.id)}
                                aria-pressed={isSelected}
                                style={{ cursor: 'pointer' }}
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
                <button
                    type="button"
                    className="scan-result-cta"
                    onClick={() => void handleGenerateStl()}
                    disabled={printConfirmed || isGeneratingStl}
                >
                    {isGeneratingStl ? 'STL 생성 중...' : printConfirmed ? '출력 신청 완료 ✓' : '네일팁 출력하기'}
                </button>
                <button
                    type="button"
                    className="scan-result-cta"
                    onClick={handleGoToDesign}
                >
                    네일 디자인 생성하기
                </button>
            </div>

            {showFingerModal && result.fingers.length > 0 && (
                <FingerDetailModal fingers={fingerDetails} onClose={() => setShowFingerModal(false)} />
            )}

            {showPrintModal && createPortal(
                <div className="print-modal">
                    <button type="button" className="print-modal__backdrop" onClick={() => setShowPrintModal(false)} />
                    <div className="print-modal__panel" role="dialog" aria-modal="true">
                        <p className="print-modal__icon">🖨️</p>
                        <h2>출력 신청 완료</h2>
                        <p>
                            당신의 네일팁이{' '}
                            <strong>{getNailShape(selectedShape)?.labelKo ?? selectedShape}</strong>
                            {' '}(으)로 출력 신청되었습니다.
                        </p>
                        <button
                            type="button"
                            className="scan-result-cta"
                            onClick={() => setShowPrintModal(false)}
                        >
                            확인
                        </button>
                    </div>
                </div>,
                document.body,
            )}
        </AppShell>
    )
}