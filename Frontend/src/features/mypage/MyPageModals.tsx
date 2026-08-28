// 찜/디자인/스캔/출력 탭에서 공통으로 열리는 상세 모달들.
// 상태와 핸들러는 MyPageLayout(및 useMyPageData)이 들고 있고, 이 컴포넌트는 그걸 받아 그리기만 한다.
// 항상 MyPageLayout 트리 안(Outlet 바깥)에 마운트되어 어떤 탭이 활성화되어 있어도 뜰 수 있어야 한다.
import { getNailShape } from '@/shared/constants/nailShapes'
import { SHAPE_PREVIEW_IMAGES } from '@/shared/constants/designPreferences'
import { FavoriteFolderModal } from '@/shared/components/FavoriteFolderModal'
import { ScanDetailModal } from '@/shared/components/ScanDetailModal'
import { ScanXModalShell } from '@/shared/components/ScanXModalShell'
import { DesignImageDetailModal, type DesignImageDetailInput } from '@/features/mypage/components/DesignImageDetailModal'
import { PrinterProgressWidget } from '@/features/mypage/components/PrinterProgressWidget'
import type { SavedDesignResponse, SavedFolderResponse } from '@/entities/design/api'
import type { ScanSession } from '@/shared/utils/scanDetail'
import {
  type LikeModalTarget,
  type NailTipPrintOrder,
  type ScanDetail,
  PRINT_STATUS_LABEL,
  PRINT_STATUS_HINT,
  Icon,
  dateKeyOf,
  formatDateTimeFull,
  formatNavDate,
} from './shared'

type Props = {
  // ── 이미지 상세 모달 ──
  detailImage: DesignImageDetailInput | null
  closeDetailImage: () => void
  handleDetailLikeChange: (designId: number, imageUrl: string, saved: SavedDesignResponse | null) => void
  handleDetailShareChange: (designId: number, shared: boolean) => void
  handleDetailDeleted: (designId: number) => void

  // ── 찜 폴더 선택 모달 ──
  likeModalTarget: LikeModalTarget | null
  setLikeModalTarget: (target: LikeModalTarget | null) => void
  confirmLikeWithFolder: (choice: { folderId?: number; newFolderName?: string }) => Promise<void>

  // ── 찜 폴더 삭제 확인 모달 ──
  folderToDelete: SavedFolderResponse | null
  closeDeleteFolderModal: () => void
  isBusy: boolean
  folderDeleteError: string | null
  confirmDeleteFolder: () => Promise<void>

  // ── 손 분석 결과 상세 모달 ──
  scanDetailSession: ScanSession | null
  closeScanDetail: () => void

  // ── 네일팁 출력 상세 모달 ──
  printDetailOrder: NailTipPrintOrder | null
  printDetailScan: ScanDetail | null
  isLoadingPrintDetail: boolean
  closePrintDetail: () => void
}

export function MyPageModals({
  detailImage,
  closeDetailImage,
  handleDetailLikeChange,
  handleDetailShareChange,
  handleDetailDeleted,
  likeModalTarget,
  setLikeModalTarget,
  confirmLikeWithFolder,
  folderToDelete,
  closeDeleteFolderModal,
  isBusy,
  folderDeleteError,
  confirmDeleteFolder,
  scanDetailSession,
  closeScanDetail,
  printDetailOrder,
  printDetailScan,
  isLoadingPrintDetail,
  closePrintDetail,
}: Props) {
  return (
      <>
        {/* ── 이미지 상세 모달 ───────────────────────────────────────── */}
        <DesignImageDetailModal
            image={detailImage}
            onClose={closeDetailImage}
            onLikeChange={handleDetailLikeChange}
            onShareChange={handleDetailShareChange}
            onDeleted={handleDetailDeleted}
        />

        <FavoriteFolderModal
            open={!!likeModalTarget}
            onClose={() => setLikeModalTarget(null)}
            onConfirm={confirmLikeWithFolder}
            mode={likeModalTarget?.mode ?? 'like'}
            initialFolderId={likeModalTarget?.currentFolderId ?? null}
        />

        {/* ── 찜 폴더 삭제 확인 모달 ───────────────────────────────────── */}
        {folderToDelete && (
            <div className="mypage-x__modal" role="dialog" aria-modal="true" aria-label="폴더 삭제 확인">
              <button
                  type="button"
                  className="mypage-x__modal-backdrop"
                  aria-label="닫기"
                  onClick={closeDeleteFolderModal}
              />
              <div className="mypage-x__modal-panel mypage-x__confirm-panel">
                <button
                    type="button"
                    className="mypage-x__modal-close mypage-x__modal-close--plain"
                    onClick={closeDeleteFolderModal}
                    aria-label="닫기"
                    disabled={isBusy}
                >
                  ✕
                </button>

                <div className="mypage-x__confirm-icon mypage-x__confirm-icon--danger" aria-hidden="true">
                  {Icon.trash}
                </div>

                <h2 className="mypage-x__confirm-title">
                  <strong>{folderToDelete.name}</strong> 폴더를 삭제할까요?
                </h2>

                {folderToDelete.itemCount > 0 && (
                    <p className="mypage-x__confirm-desc">
                      폴더만 사라지고, 안에 있던 찜 이미지 <strong>{folderToDelete.itemCount}개</strong>는{' '}
                      <strong>기본</strong> 폴더로 자동 이동돼요.
                    </p>
                )}

                {folderToDelete.itemCount > 0 && (
                    <div className="mypage-x__confirm-flow" aria-hidden="true">
                      <div className="mypage-x__confirm-flow-folder">
                        <div className="mypage-x__confirm-flow-thumbs">
                          {(folderToDelete.recentImageUrls ?? []).slice(0, 3).map((url, i) => (
                              <img key={i} src={url} alt="" />
                          ))}
                          {(folderToDelete.recentImageUrls ?? []).length === 0 && (
                              <span className="mypage-x__confirm-flow-empty">{Icon.folder}</span>
                          )}
                        </div>
                        <span className="mypage-x__confirm-flow-label">{folderToDelete.name}</span>
                      </div>

                      <span className="mypage-x__confirm-flow-arrow">{Icon.chevronRight}</span>

                      <div className="mypage-x__confirm-flow-folder mypage-x__confirm-flow-folder--default">
                        <div className="mypage-x__confirm-flow-thumbs mypage-x__confirm-flow-thumbs--default">
                          <span className="mypage-x__confirm-flow-heart">{Icon.heart}</span>
                        </div>
                        <span className="mypage-x__confirm-flow-label">기본</span>
                      </div>
                    </div>
                )}

                {folderDeleteError && <p className="mypage-x__message">{folderDeleteError}</p>}

                <div className="mypage-x__modal-actions">
                  <button type="button" onClick={closeDeleteFolderModal} disabled={isBusy}>
                    취소
                  </button>
                  <button
                      type="button"
                      className="mypage-x__modal-action--danger"
                      onClick={() => void confirmDeleteFolder()}
                      disabled={isBusy}
                  >
                    <span>{isBusy ? '삭제 중...' : '폴더 삭제'}</span>
                  </button>
                </div>
              </div>
            </div>
        )}

        {/* ── 손 분석 결과 상세 모달 ───────────────────────────────────── */}
        <ScanDetailModal session={scanDetailSession} onClose={closeScanDetail} />

        {/* ── 네일팁 출력 상세 모달 ───────────────────────────────────── */}
        {printDetailOrder && (() => {
          const shapeLabel = getNailShape(printDetailOrder.shapeId)?.labelKo
              ?? printDetailOrder.shapeLabelKo
              ?? printDetailOrder.shapeId
          const shapeEn = getNailShape(printDetailOrder.shapeId)?.labelEn ?? null
          const statusKey = printDetailOrder.status.toLowerCase()
          const hasLinkedScan = Boolean(printDetailOrder.leftScanId || printDetailOrder.rightScanId)
          const lengthPct = printDetailScan
              ? Math.min(100, Math.max(8, (printDetailScan.avgLength / 18) * 100))
              : 0
          const widthPct = printDetailScan
              ? Math.min(100, Math.max(8, (printDetailScan.avgWidth / 14) * 100))
              : 0
          const curvePct = printDetailScan
              ? Math.min(100, Math.max(8, printDetailScan.avgCurve * 100))
              : 0

          const subtitle = formatDateTimeFull(printDetailOrder.orderedAt)
              || formatNavDate(dateKeyOf(printDetailOrder.orderedAt))

          return (
              <ScanXModalShell
                  ariaLabel="네일팁 출력 상세"
                  eyebrow="Nail Tips Print"
                  title="네일팁 출력"
                  subtitle={subtitle}
                  onClose={closePrintDetail}
              >
                  <section className={`mypage-x__printx-status mypage-x__printx-status--${statusKey}`}>
                    <div className="mypage-x__printx-status-copy">
                      <p className="mypage-x__scanx-kicker">진행 상태</p>
                      <strong>{PRINT_STATUS_LABEL[printDetailOrder.status]}</strong>
                      <span className={printDetailOrder.status === 'FAILED' ? 'mypage-x__printx-status-fail' : undefined}>
                        {printDetailOrder.status === 'FAILED' && printDetailOrder.failReason
                            ? printDetailOrder.failReason
                            : PRINT_STATUS_HINT[printDetailOrder.status]}
                      </span>
                    </div>
                    <span className={`mypage-x__badge mypage-x__badge--${statusKey}`}>
                      {PRINT_STATUS_LABEL[printDetailOrder.status]}
                    </span>
                  </section>

                {printDetailOrder.status === 'PRINTING' && (
                    <PrinterProgressWidget
                        orderId={printDetailOrder.id}
                        onComplete={closePrintDetail}
                    />
                )}
                  <section className="mypage-x__scanx-shape">
                    <div className="mypage-x__scanx-shape-copy">
                      <p className="mypage-x__scanx-kicker">신청한 네일팁 쉐입</p>
                      <strong>{shapeLabel}</strong>
                      {shapeEn && <span>{shapeEn}</span>}
                    </div>
                    <div className="mypage-x__scanx-shape-preview" aria-hidden="true">
                      {SHAPE_PREVIEW_IMAGES[printDetailOrder.shapeId] ? (
                          <img src={SHAPE_PREVIEW_IMAGES[printDetailOrder.shapeId]} alt="" />
                      ) : (
                          Icon.print
                      )}
                    </div>
                  </section>

                  <p className="mypage-x__scanx-comment">
                    <span className="mypage-x__scanx-comment-label">
                      출력 요약
                      <i aria-hidden="true">{Icon.summaryIcon}</i>
                    </span>
                    {shapeLabel} 쉐입으로 네일팁 10개(양손) 출력을 신청했어요.
                  </p>

                  <section className="mypage-x__scanx-metrics" aria-label="출력에 사용된 손톱 지표">
                    <p className="mypage-x__scanx-section-label">출력에 사용된 손톱 수치</p>
                    {!hasLinkedScan ? (
                        <p className="mypage-x__printx-empty-note">
                          연결된 손 분석 기록이 없어요. 예전에 신청한 건일 수 있어요.
                        </p>
                    ) : isLoadingPrintDetail || !printDetailScan ? (
                        <p className="mypage-x__empty">연결된 손 분석 결과를 불러오는 중...</p>
                    ) : (
                        <>
                          <p className="mypage-x__printx-scan-note">
                            {formatNavDate(dateKeyOf(printDetailScan.scannedAt))} 손 분석 결과 사용
                          </p>
                          <div className="mypage-x__scanx-metric-grid">
                            <article className="mypage-x__scanx-metric">
                              <div className="mypage-x__scanx-metric-top">
                                <div className="mypage-x__scanx-metric-copy">
                                  <p>길이</p>
                                  <strong>{printDetailScan.avgLength.toFixed(1)}<em>mm</em></strong>
                                </div>
                                <span className="mypage-x__scanx-metric-icon" aria-hidden="true">{Icon.lengthIcon}</span>
                              </div>
                              <div className="mypage-x__scanx-meter" aria-hidden="true">
                                <i style={{ width: `${lengthPct}%` }} />
                              </div>
                              <span className="mypage-x__scanx-metric-hint">끝에서 큐티클까지</span>
                            </article>
                            <article className="mypage-x__scanx-metric">
                              <div className="mypage-x__scanx-metric-top">
                                <div className="mypage-x__scanx-metric-copy">
                                  <p>너비</p>
                                  <strong>{printDetailScan.avgWidth.toFixed(1)}<em>mm</em></strong>
                                </div>
                                <span className="mypage-x__scanx-metric-icon" aria-hidden="true">{Icon.widthIcon}</span>
                              </div>
                              <div className="mypage-x__scanx-meter" aria-hidden="true">
                                <i style={{ width: `${widthPct}%` }} />
                              </div>
                              <span className="mypage-x__scanx-metric-hint">최대 너비 평균</span>
                            </article>
                            <article className="mypage-x__scanx-metric">
                              <div className="mypage-x__scanx-metric-top">
                                <div className="mypage-x__scanx-metric-copy">
                                  <p>곡률</p>
                                  <strong>{printDetailScan.avgCurve.toFixed(2)}</strong>
                                </div>
                                <span className="mypage-x__scanx-metric-icon" aria-hidden="true">{Icon.curveIcon}</span>
                              </div>
                              <div className="mypage-x__scanx-meter" aria-hidden="true">
                                <i style={{ width: `${curvePct}%` }} />
                              </div>
                              <span className="mypage-x__scanx-metric-hint">C-curve (0~1)</span>
                            </article>
                          </div>
                        </>
                    )}
                  </section>
              </ScanXModalShell>
          )
        })()}
      </>
  )
}
