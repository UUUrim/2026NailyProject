// 찜/디자인/스캔/출력 탭에서 공통으로 열리는 상세 모달들.
// 상태와 핸들러는 MyPageLayout(및 useMyPageData)이 들고 있고, 이 컴포넌트는 그걸 받아 그리기만 한다.
// 항상 MyPageLayout 트리 안(Outlet 바깥)에 마운트되어 어떤 탭이 활성화되어 있어도 뜰 수 있어야 한다.
import { useEffect, type ReactNode } from 'react'
import { getNailShape } from '@/shared/constants/nailShapes'
import { SHAPE_PREVIEW_IMAGES } from '@/shared/constants/designPreferences'
import { FavoriteFolderModal } from '@/shared/components/FavoriteFolderModal'
import { ScanDetailModal } from '@/shared/components/ScanDetailModal'
import { ScanXModalShell } from '@/shared/components/ScanXModalShell'
import { DesignImageDetailModal, type DesignImageDetailInput } from '@/features/mypage/components/DesignImageDetailModal'
import { PrinterProgressWidget } from '@/features/mypage/components/PrinterProgressWidget'
import { PrintOrderActions } from '@/features/mypage/components/PrintOrderActions'
import { PrintReprintAction } from '@/features/mypage/components/PrintReprintAction'
import type { SavedDesignResponse, SavedFolderResponse } from '@/entities/design/api'
import type { ScanSession } from '@/shared/utils/scanDetail'
import {
    type LikeModalTarget,
    type NailTipPrintOrder,
    type ScanDetail,
    CANCEL_ONLY_PRINT_STATUSES,
    FINISHED_PRINT_STATUSES,
    PRINT_STATUS_LABEL,
    PRINT_STATUS_HINT,
    getDisplayPrintStatus,
    describePrintFailure,
    Icon,
    dateKeyOf,
    formatDateTimeFull,
    formatNavDate,
    formatTimeHms,
    formatTipExtension,
} from './shared'

// 손 분석 기록·출력 내역 삭제 확인 창 — 찜 폴더 삭제 확인 창(mypage-x__confirm)과 같은 모양
function RecordDeleteConfirm({
                                 ariaLabel,
                                 title,
                                 description,
                                 confirmLabel,
                                 error,
                                 isBusy,
                                 onCancel,
                                 onConfirm,
                             }: {
    ariaLabel: string
    title: ReactNode
    description: ReactNode
    confirmLabel: string
    error: string | null
    isBusy: boolean
    onCancel: () => void
    onConfirm: () => void
}) {
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape') onCancel()
        }
        document.addEventListener('keydown', handleKeyDown)
        return () => document.removeEventListener('keydown', handleKeyDown)
    }, [onCancel])

    return (
        <div className="mypage-x__modal" role="dialog" aria-modal="true" aria-label={ariaLabel}>
            <button type="button" className="mypage-x__modal-backdrop" aria-label="닫기" onClick={onCancel} />
            <div className="mypage-x__modal-panel mypage-x__confirm-panel">
                <button
                    type="button"
                    className="mypage-x__modal-close mypage-x__modal-close--plain"
                    onClick={onCancel}
                    aria-label="닫기"
                    disabled={isBusy}
                >
                    ✕
                </button>

                <div className="mypage-x__confirm-icon mypage-x__confirm-icon--danger" aria-hidden="true">
                    {Icon.trash}
                </div>

                <h2 className="mypage-x__confirm-title">{title}</h2>
                <p className="mypage-x__confirm-desc">{description}</p>

                {error && <p className="mypage-x__message is-error">{error}</p>}

                <div className="mypage-x__modal-actions">
                    <button type="button" onClick={onCancel} disabled={isBusy}>
                        취소
                    </button>
                    <button type="button" className="mypage-x__modal-action--danger" onClick={onConfirm} disabled={isBusy}>
                        <span>{isBusy ? '삭제 중...' : confirmLabel}</span>
                    </button>
                </div>
            </div>
        </div>
    )
}

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
    // 취소/일시정지/재개 요청이 성공했을 때 서버가 돌려준 주문을 목록에 반영한다
    onPrintOrderUpdated: (order: NailTipPrintOrder) => void
    // 같은 설정으로 새 출력 주문 만들기 (끝난 주문의 상세에서)
    onReprint: (order: NailTipPrintOrder) => void | Promise<void>
    isReprinting: boolean
    reprintError: string | null

    // ── 손 분석 기록 / 출력 내역 삭제 확인 모달 ──
    scanToDelete: ScanSession | null
    printToDelete: NailTipPrintOrder | null
    isDeletingRecord: boolean
    recordDeleteError: string | null
    closeDeleteRecordModal: () => void
    confirmDeleteScan: () => Promise<void>
    confirmDeletePrint: () => Promise<void>
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
                                 onPrintOrderUpdated,
                                 onReprint,
                                 isReprinting,
                                 reprintError,
                                 scanToDelete,
                                 printToDelete,
                                 isDeletingRecord,
                                 recordDeleteError,
                                 closeDeleteRecordModal,
                                 confirmDeleteScan,
                                 confirmDeletePrint,
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
                const displayStatus = getDisplayPrintStatus(printDetailOrder)
                const statusKey = displayStatus.toLowerCase()
                const hasLinkedScan = Boolean(printDetailOrder.leftScanId || printDetailOrder.rightScanId)
                // 지금은 왼손 검지 하나만 출력한다. 오른손 스캔이 같이 기록된 건 예전에 양손 10개로 신청한 주문이다.
                const printTargetText = printDetailOrder.rightScanId ? '네일 팁 10개(양손)' : '왼손 검지 네일 팁 1개'

                // 막대는 스캔 서버의 5단계 평균 판정 위치(10/30/50/70/90%)만큼 채운다.
                const lengthPct = printDetailScan?.lengthPct ?? 0
                const widthPct = printDetailScan?.widthPct ?? 0
                const curvePct = printDetailScan?.curvePct ?? 0

                const subtitle = formatDateTimeFull(printDetailOrder.orderedAt)
                    || formatNavDate(dateKeyOf(printDetailOrder.orderedAt))

                return (
                    <ScanXModalShell
                        ariaLabel="네일 팁 출력 상세"
                        eyebrow="Nail Tips Print"
                        title="네일 팁 출력"
                        subtitle={subtitle}
                        onClose={closePrintDetail}
                    >
                        <section className={`mypage-x__printx-status mypage-x__printx-status--${statusKey}`}>
                            <div className="mypage-x__printx-status-head">
                                <div className="mypage-x__printx-status-copy">
                                    <p className="mypage-x__scanx-kicker">진행 상태</p>
                                    <strong>{PRINT_STATUS_LABEL[displayStatus]}</strong>
                                    <span className={printDetailOrder.status === 'FAILED' ? 'mypage-x__printx-status-fail' : undefined}>
                        {printDetailOrder.status === 'FAILED' && printDetailOrder.failReason
                            ? describePrintFailure(printDetailOrder.failReason)
                            : (printDetailOrder.status === 'WAITING_IN_QUEUE' || printDetailOrder.status === 'MERGED') && printDetailOrder.queueAhead != null
                                ? (printDetailOrder.queueAhead > 0
                                    ? `내 앞에 ${printDetailOrder.queueAhead}개의 출력이 있어요. 끝나는 대로 이어서 시작돼요.`
                                    : '곧 출력이 시작돼요.')
                                : PRINT_STATUS_HINT[displayStatus]}
                      </span>
                                    {printDetailOrder.status === 'FAILED' && printDetailOrder.failReason && (
                                        <details className="mypage-x__printx-fail-detail">
                                            <summary>자세히 보기</summary>
                                            <code>{printDetailOrder.failReason}</code>
                                        </details>
                                    )}
                                </div>
                                <span className={`mypage-x__badge mypage-x__badge--${statusKey}`}>
                      {PRINT_STATUS_LABEL[displayStatus]}
                    </span>
                            </div>

                            {/* 진행 상황과 취소/일시정지/재개 버튼은 "진행 상태" 카드 안에 둔다 */}
                            {(printDetailOrder.status === 'PRINTING' || printDetailOrder.status === 'CANCELING') && (
                                <PrinterProgressWidget
                                    orderId={printDetailOrder.id}
                                    orderStatus={printDetailOrder.status}
                                    onComplete={closePrintDetail}
                                    onOrderUpdated={onPrintOrderUpdated}
                                />
                            )}
                            {/* 아직 프린터가 출력하기 전(대기·병합 중)인 주문은 취소만 할 수 있다 */}
                            {CANCEL_ONLY_PRINT_STATUSES.has(printDetailOrder.status) && (
                                <PrintOrderActions
                                    orderId={printDetailOrder.id}
                                    orderStatus={printDetailOrder.status}
                                    onUpdated={onPrintOrderUpdated}
                                />
                            )}
                            {/* 끝난 주문(완료/실패/취소)은 같은 설정으로 다시 출력할 수 있다 */}
                            {FINISHED_PRINT_STATUSES.has(printDetailOrder.status) && (
                                <PrintReprintAction
                                    order={printDetailOrder}
                                    busy={isReprinting}
                                    error={reprintError}
                                    onReprint={(order) => void onReprint(order)}
                                />
                            )}
                        </section>
                        <section className="mypage-x__scanx-shape">
                            <div className="mypage-x__scanx-shape-copy">
                                <p className="mypage-x__scanx-kicker">신청한 네일 팁 쉐입</p>
                                {/* 한글 이름 옆에 영어 이름을 작게 붙인다 (손 분석 결과 화면의 추천 쉐입 카드처럼) */}
                                <strong className="mypage-x__scanx-shape-name">
                                    {shapeLabel}
                                    {shapeEn && <em>{shapeEn}</em>}
                                </strong>
                                <p className="mypage-x__scanx-shape-length">
                                    {printDetailOrder.tipExtensionMm != null && '연장 길이 '}
                                    <b>{formatTipExtension(printDetailOrder.tipExtensionMm)}</b>
                                </p>
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
                            {printDetailOrder.tipExtensionMm != null
                                ? `${shapeLabel} 쉐입, 연장 길이 ${formatTipExtension(printDetailOrder.tipExtensionMm)}로 ${printTargetText} 출력을 신청했어요.`
                                : `${shapeLabel} 쉐입(기본 길이)으로 ${printTargetText} 출력을 신청했어요.`}
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
                                                    <strong>{printDetailScan.avgCurve.toFixed(1)}mm</strong>
                                                </div>
                                                <span className="mypage-x__scanx-metric-icon" aria-hidden="true">{Icon.curveIcon}</span>
                                            </div>
                                            <div className="mypage-x__scanx-meter" aria-hidden="true">
                                                <i style={{ width: `${curvePct}%` }} />
                                            </div>
                                            <span className="mypage-x__scanx-metric-hint">C-curve 깊이</span>
                                        </article>
                                    </div>
                                </>
                            )}
                        </section>
                    </ScanXModalShell>
                )
            })()}

            {/* ── 손 분석 기록 삭제 확인 모달 ───────────────────────────────── */}
            {scanToDelete && (
                <RecordDeleteConfirm
                    ariaLabel="손 분석 기록 삭제 확인"
                    title={
                        <>
                            <strong>
                                {formatNavDate(dateKeyOf(scanToDelete.scannedAt))} {formatTimeHms(scanToDelete.scannedAt)}
                            </strong>
                            <br />
                            손 분석 기록을 삭제할까요?
                        </>
                    }
                    description={
                        <>
                            삭제한 기록은 마이페이지와 디자인 채팅·네일 팁 출력의
                            <br />
                            손 분석 기록 목록에서 사라지고 되돌릴 수 없어요.
                        </>
                    }
                    confirmLabel="기록 삭제"
                    error={recordDeleteError}
                    isBusy={isDeletingRecord}
                    onCancel={closeDeleteRecordModal}
                    onConfirm={() => void confirmDeleteScan()}
                />
            )}

            {/* ── 네일 팁 출력 내역 삭제 확인 모달 ─────────────────────────── */}
            {printToDelete && (
                <RecordDeleteConfirm
                    ariaLabel="출력 내역 삭제 확인"
                    title={
                        <>
                            <strong>
                                {getNailShape(printToDelete.shapeId)?.labelKo ?? printToDelete.shapeLabelKo} 네일 팁
                            </strong>{' '}
                            출력 내역을 삭제할까요?
                        </>
                    }
                    description={
                        <>
                            {formatDateTimeFull(printToDelete.orderedAt)}에 신청한 내역이에요.
                            <br />
                            삭제한 내역은 되돌릴 수 없어요.
                        </>
                    }
                    confirmLabel="내역 삭제"
                    error={recordDeleteError}
                    isBusy={isDeletingRecord}
                    onCancel={closeDeleteRecordModal}
                    onConfirm={() => void confirmDeletePrint()}
                />
            )}
        </>
    )
}
