import { useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { AppShell } from '@/components/layout/AppShell'
import { PageBackLink } from '@/components/layout/PageBackLink'
import { NailPreview3D } from '@/components/nail3d/NailPreview3D'
import { getNailShape, type NailShapeId } from '@/constants/nailShapes'
import { INITIAL_PREFERENCES, type NailDesignPreferences, TEXTURE_INFO, CHARM_INFO } from '@/constants/designPreferences'
import { likeDesign, unlikeDesign, type DesignExtractedDetails } from '@/apis/design'
import { generateStl } from '@/apis/scan'
import { addNailTipPrintOrder } from '@/utils/mypageStorage'
import { ApiError } from '@/utils/apiClient'
import '@/styles/nail-design.css'

const CHARM_SLOT_COUNT = 8

export function NailDesignResultPage() {
  const location = useLocation()
  const navigate = useNavigate()

  const designId = (location.state?.designId as number | undefined) ?? null
  const imageUrls = (location.state?.imageUrls as string[] | undefined) ?? []
  const image = imageUrls[0] ?? ''
  const preferences = (location.state?.preferences as NailDesignPreferences | undefined) ?? INITIAL_PREFERENCES
  const leftScanId = (location.state?.leftScanId as number | null | undefined) ?? null
  const rightScanId = (location.state?.rightScanId as number | null | undefined) ?? null

  // 디자인 생성 모델이 함께 내려주는 세부 요소 (컬러팔레트 / 질감 / 네일 파츠) — 프론트는 표시만 함
  const details = (location.state?.details as DesignExtractedDetails | undefined) ?? null
  const palette = details?.colorPalette ?? []
  const textureLabels = details?.textures ?? []
  const charmLabels = details?.nailParts ?? []

  const nailShapeId = ((location.state?.shapeId as NailShapeId | undefined) ?? preferences.shape[0] ?? 'oval') as NailShapeId
  const nailShapeLabel = getNailShape(nailShapeId)?.labelKo ?? nailShapeId

  const [liked, setLiked] = useState(false)
  const [isLiking, setIsLiking] = useState(false)
  const [show3D, setShow3D] = useState(false)
  const [isMakingStl, setIsMakingStl] = useState(false)
  const [stlMessage, setStlMessage] = useState<string | null>(null)

  const handleToggleLike = async () => {
    if (!designId || !image || isLiking) return
    setIsLiking(true)
    try {
      if (liked) {
        await unlikeDesign(designId, image)
        setLiked(false)
      } else {
        await likeDesign(designId, image)
        setLiked(true)
      }
    } catch (e) {
      alert(e instanceof ApiError ? e.message : '요청에 실패했습니다.')
    } finally {
      setIsLiking(false)
    }
  }

  const handleRegenerate = () => {
    navigate('/design/chat')
  }

  const handleMakeStl = async () => {
    if (isMakingStl) return
    if (!leftScanId && !rightScanId) {
      setStlMessage('손 스캔 정보가 있어야 3D 네일팁을 제작할 수 있어요. 먼저 손 촬영을 진행해 주세요.')
      return
    }
    setIsMakingStl(true)
    setStlMessage(null)
    try {
      await Promise.all([
        leftScanId ? generateStl(leftScanId, nailShapeId) : Promise.resolve(),
        rightScanId ? generateStl(rightScanId, nailShapeId) : Promise.resolve(),
      ])
      addNailTipPrintOrder({ shapeId: nailShapeId, shapeLabelKo: nailShapeLabel, leftScanId, rightScanId })
      setStlMessage('3D 네일팁 제작 요청이 접수됐어요! 마이페이지에서 진행 상황을 확인할 수 있어요.')
    } catch (e) {
      setStlMessage(e instanceof ApiError ? e.message : '3D 네일팁 제작 요청에 실패했어요. 다시 시도해 주세요.')
    } finally {
      setIsMakingStl(false)
    }
  }

  if (!image) {
    return (
        <AppShell mainClassName="design-result-page">
          <PageBackLink to="/design/chat" label="디자인 생성" />
          <div className="design-result-empty">
            <p>표시할 디자인이 없어요. 먼저 디자인을 생성해 주세요.</p>
            <button type="button" className="design-result-cta" onClick={() => navigate('/design/chat')}>
              디자인 생성하러 가기
            </button>
          </div>
        </AppShell>
    )
  }

  return (
      <AppShell mainClassName="design-result-page">
        <PageBackLink to="/design/chat" label="디자인 생성" />

        <div className="design-result-v2">
          <div className="design-result-v2__title-row">
            <h1>디자인을 확인해주세요</h1>
            <button
                type="button"
                className="design-result-v2__refresh"
                onClick={handleRegenerate}
                aria-label="다른 디자인으로 다시 생성하기"
                title="다시 생성하기"
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <path
                    d="M4 12a8 8 0 0 1 13.66-5.66L20 8.5M4 12a8 8 0 0 0 13.66 5.66L20 15.5M20 8.5V4M20 8.5h-4.5M20 15.5V20M20 15.5h-4.5"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                />
              </svg>
            </button>
          </div>

          <div className="design-result-v2__body">
            <div className="design-result-v2__image-card">
              <button
                  type="button"
                  className={`design-result-v2__heart${liked ? ' is-liked' : ''}`}
                  onClick={() => void handleToggleLike()}
                  disabled={isLiking || !designId}
                  aria-label={liked ? '찜 해제' : '찜하기'}
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill={liked ? 'currentColor' : 'none'} aria-hidden="true">
                  <path
                      d="M12 20s-7-4.35-9.5-8.8C.8 8 2 4.5 5.4 4a4.9 4.9 0 0 1 6.6 2 4.9 4.9 0 0 1 6.6-2c3.4.5 4.6 4 3.9 7.2C19 15.65 12 20 12 20z"
                      stroke="currentColor"
                      strokeWidth="1.6"
                      strokeLinejoin="round"
                  />
                </svg>
              </button>

              <img src={image} alt="생성된 네일 디자인" className="design-result-v2__image" />

              <button type="button" className="design-result-v2__3d-badge" onClick={() => setShow3D(true)}>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                  <path d="M12 3l8 4.5v9L12 21l-8-4.5v-9L12 3z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
                  <path d="M12 12v9M12 12L4 7.5M12 12l8-4.5" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
                </svg>
                3D
              </button>
            </div>

            <div className="design-result-v2__panels">
              <section className="design-result-v2__panel">
                <h2>[ color palette ]</h2>
                {palette.length > 0 ? (
                    <div className="design-result-v2__swatch-row">
                      {palette.map((hex) => (
                          <span key={hex} className="design-result-v2__swatch" style={{ background: hex }} title={hex} />
                      ))}
                    </div>
                ) : (
                    <p className="design-result-v2__panel-hint">컬러 팔레트 정보가 없어요.</p>
                )}
              </section>

              <section className="design-result-v2__panel">
                <h2>[ texture ]</h2>
                {textureLabels.length > 0 ? (
                    <div className="design-result-v2__swatch-row">
                      {textureLabels.map((label) => {
                        // 모델이 내려준 라벨이 우리 쪽 사전 정의 키(designType)와 일치하면 시각 스와치도 함께 표시
                        const info = TEXTURE_INFO[label]
                        return (
                            <span key={label} className="design-result-v2__texture-chip">
                              {info && (
                                  <span
                                      className="design-result-v2__swatch design-result-v2__swatch--texture"
                                      style={info.swatchStyle}
                                  />
                              )}
                              {info?.labelKo ?? label}
                            </span>
                        )
                      })}
                    </div>
                ) : (
                    <p className="design-result-v2__panel-hint">질감 정보가 없어요.</p>
                )}
              </section>

              <section className="design-result-v2__panel">
                <h2>[ nail charms ]</h2>
                <div className="design-result-v2__charm-grid">
                  {Array.from({ length: CHARM_SLOT_COUNT }).map((_, i) => {
                    const label = charmLabels[i]
                    const info = label ? CHARM_INFO[label] : undefined
                    return (
                        <div key={i} className={`design-result-v2__charm-slot${label ? ' is-filled' : ''}`}>
                          {label ? (
                              <>
                                <span className="design-result-v2__charm-icon">{info?.icon ?? '✧'}</span>
                                <span className="design-result-v2__charm-label">{info?.labelKo ?? label}</span>
                              </>
                          ) : (
                              <span className="design-result-v2__charm-empty">✕</span>
                          )}
                        </div>
                    )
                  })}
                </div>
              </section>
            </div>
          </div>

          {stlMessage && <p className="design-result-v2__stl-message">{stlMessage}</p>}

          <div className="design-result-v2__actions">
            <button
                type="button"
                className="design-result-v2__stl-btn"
                onClick={() => void handleMakeStl()}
                disabled={isMakingStl}
            >
              {isMakingStl ? '요청 중…' : '3D 네일팁 제작하기'}
            </button>
            <button type="button" className="design-result-v2__regenerate-btn" onClick={handleRegenerate}>
              디자인 재생성하러 가기
            </button>
          </div>
        </div>

        {show3D && (
            <div className="design-3d-modal" role="dialog" aria-modal="true">
              <button
                  type="button"
                  className="design-3d-modal__backdrop"
                  onClick={() => setShow3D(false)}
                  aria-label="닫기"
              />
              <div className="design-3d-modal__panel">
                <header className="design-3d-modal__header">
                  <h2>3D로 네일팁 미리보기</h2>
                  <button type="button" onClick={() => setShow3D(false)}>✕</button>
                </header>
                <p className="design-3d-modal__desc">
                  선택한 네일팁 쉐입({nailShapeLabel})에 디자인을 입힌 양손 모습입니다.
                </p>
                <NailPreview3D textureUrl={image} shapeId={nailShapeId} />
                <div className="design-3d-modal__footer">
                  <button type="button" className="primary" onClick={() => setShow3D(false)}>
                    닫기
                  </button>
                </div>
              </div>
            </div>
        )}
      </AppShell>
  )
}