import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { AppShell } from '@/components/layout/AppShell'
import { PageHero } from '@/components/layout/PageHero'
import { startScan, uploadFingerImage, requestAnalyze, getMyScans } from '@/apis/scan'
import { CameraFeedSelect } from '@/components/handScan/CameraFeedSelect'
import { CameraSetupPreview } from '@/components/handScan/CameraSetupPreview'
import { ScanDetailModal } from '@/components/mypage/ScanDetailModal'
import { PillButton } from '@/components/common/PillButton'
import { WarningIcon } from '@/components/icons/WarningIcon'
import { useFingerAlignment } from '@/hooks/useFingerAlignment'
import { useAuth } from '@/hooks/useAuth'
import { useLeaveWarning } from '@/hooks/useLeaveWarning'
import { useSnapshotRestore } from '@/hooks/useSnapshotRestore'
import { ApiError } from '@/utils/apiClient'
import { AUTH_CHANGE_EVENT } from '@/utils/auth'
import {
  buildScanSessions,
  formatMetricCurve,
  isFullyAnalyzedSession,
  type ScanSession,
} from '@/utils/scanDetail'
import { analyzeSkinTone } from '@/utils/skinTone'
import { getNailShape } from '@/constants/nailShapes'
import '@/styles/hand-scan.css'

// 스캔 서버 주소 (로컬: http://localhost:8000, 데모: ngrok URL) — 데스크톱 브라우저 기준.
const SCAN_SERVER_URL = import.meta.env.VITE_SCAN_SERVER_URL ?? 'http://localhost:8000'

// 폰이 접속할 카메라 페이지 주소. localhost는 폰에서 못 열기 때문에
// SCAN_SERVER_URL과 별개로 관리 — ngrok 등 폰이 실제로 도달 가능한 주소를 넣어야 함.
const PHONE_CAM_URL = import.meta.env.VITE_PHONE_CAM_URL ?? SCAN_SERVER_URL


function formatScanDateLabel(raw: string): string {
  const d = new Date(raw)
  if (Number.isNaN(d.getTime())) return ''
  return `${d.getFullYear()}년 ${d.getMonth() + 1}월 ${d.getDate()}일`
}

function pickLatestCompletedSession(sessions: ScanSession[]): ScanSession | null {
  const completed = sessions.filter(isFullyAnalyzedSession)
  if (completed.length === 0) return null
  return completed.reduce((latest, cur) => {
    const lt = new Date(latest.scannedAt).getTime()
    const ct = new Date(cur.scannedAt).getTime()
    return ct >= lt ? cur : latest
  })
}

const FINGERS = ['THUMB', 'INDEX', 'MIDDLE', 'RING', 'PINKY'] as const
type Finger = (typeof FINGERS)[number]

const HANDS = ['LEFT', 'RIGHT'] as const
type HandSide = (typeof HANDS)[number]

const FINGER_LABELS: Record<Finger, string> = {
  THUMB: '엄지',
  INDEX: '검지',
  MIDDLE: '중지',
  RING: '약지',
  PINKY: '소지',
}

const HAND_LABELS: Record<HandSide, string> = {
  LEFT: '왼손',
  RIGHT: '오른손',
}

// 왼손 5손가락 → 오른손 5손가락, 총 10단계
type ScanStep = { hand: HandSide; finger: Finger }
const STEPS: ScanStep[] = HANDS.flatMap((hand) => FINGERS.map((finger) => ({ hand, finger })))

function pickDefaultDevices(devices: MediaDeviceInfo[]): [string, string] {
  if (devices.length === 0) return ['default', 'default']
  if (devices.length === 1) return [devices[0].deviceId, devices[0].deviceId]
  return [devices[0].deviceId, devices[1].deviceId]
}

// 촬영 진행 상태(몇 번째 손가락까지 찍었는지)를 모듈 스코프에 스냅샷으로 저장해서, 다른 페이지로
// 갔다가 돌아와도 처음부터 다시 찍지 않아도 되도록 한다. 카메라 스트림 자체는 하드웨어 리소스라
// 여기 포함하지 않고(다시 열 때 새로 요청), 서버에 이미 업로드된 진행 상황만 보존한다.
type HandScanSnapshot = {
  currentStepIndex: number
  scanIds: Record<HandSide, number | null>
  uploadedSteps: Set<string>
  isDone: boolean
}

let handScanSnapshot: HandScanSnapshot | null = null

// 로그인/로그아웃(계정 전환)이 일어나면 이전 계정의 촬영 진행 상황이 다음 계정에게
// 보이지 않도록 스냅샷을 비운다. 실제 서버에 저장된 이력은 계정별로 분리되어 있어 영향 없음.
window.addEventListener(AUTH_CHANGE_EVENT, () => {
  handScanSnapshot = null
})

export function HandScanPage() {
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const { isLoggedIn } = useAuth()
  const skipRescanGate = searchParams.get('rescan') === '1'

  // 뒤로가기(POP)로 돌아온 경우에만 촬영 진행 상황을 복원한다. 헤더 링크 등으로
  // 새로 들어온 경우(PUSH/REPLACE)엔 처음부터 새로 촬영하도록 스냅샷을 버린다.
  const restored = useSnapshotRestore(handScanSnapshot, () => { handScanSnapshot = null })

  const [isFullscreen, setIsFullscreen]     = useState(false)
  const [cameraError, setCameraError]       = useState<string | null>(null)
  const [isUploading, setIsUploading]       = useState(false)
  // 기본값: 왼쪽(탑뷰)=USB 웹캠 인덱스 0, 오른쪽(사이드/c-curve)=폰(-2).
  // 매번 드롭다운에서 고르지 않아도 되도록 실제로 쓰는 조합을 기본값으로 둠.
  const [topCameraIdx, setTopCameraIdx]     = useState(0)
  const [sideCameraIdx, setSideCameraIdx]   = useState(-2)

  const [currentStepIndex, setCurrentStepIndex] = useState(restored?.currentStepIndex ?? 0)
  const [scanIds, setScanIds] = useState<Record<HandSide, number | null>>(
      restored?.scanIds ?? { LEFT: null, RIGHT: null },
  )
  const [uploadedSteps, setUploadedSteps] = useState<Set<string>>(
      restored?.uploadedSteps ?? new Set(),
  )
  const [isDone, setIsDone] = useState(restored?.isDone ?? false)

  const [gateStatus, setGateStatus] = useState<'checking' | 'show' | 'pass'>(
      skipRescanGate || !isLoggedIn ? 'pass' : 'checking',
  )
  const [latestCompletedSession, setLatestCompletedSession] = useState<ScanSession | null>(null)
  const [detailSession, setDetailSession] = useState<ScanSession | null>(null)

  // SSE + scanIds 최신값 ref (클로저 버그 방지)
  const sseRef        = useRef<EventSource | null>(null)
  const stepIndexRef  = useRef(currentStepIndex)   // SSE 핸들러 내에서 직접 업데이트
  const scanIdsRef    = useRef(scanIds)
  useEffect(() => { scanIdsRef.current = scanIds }, [scanIds])

  const currentStep   = STEPS[Math.min(currentStepIndex, STEPS.length - 1)] ?? STEPS[0]
  const currentHand   = currentStep.hand
  const currentFinger = currentStep.finger

  // ── 게이트: 이전 스캔 기록 확인 ──────────────────────────────
  useEffect(() => {
    if (skipRescanGate || !isLoggedIn) { setGateStatus('pass'); return }
    let cancelled = false
    setGateStatus('checking')
    void getMyScans()
        .then((scans) => {
          if (cancelled) return
          const latest = pickLatestCompletedSession(buildScanSessions(scans))
          if (latest) { setLatestCompletedSession(latest); setGateStatus('show') }
          else setGateStatus('pass')
        })
        .catch(() => { if (!cancelled) setGateStatus('pass') })
    return () => { cancelled = true }
  }, [isLoggedIn, skipRescanGate])

  const handleConfirmRescan = () => {
    setGateStatus('pass')
    setSearchParams({ rescan: '1' }, { replace: true })
  }

  // ── 풀스크린 닫기 ─────────────────────────────────────────────
  const handleCloseFullscreen = useCallback(() => {
    sseRef.current?.close()
    sseRef.current = null
    setIsFullscreen(false)
  }, [])

  // ── SSE 연결: 스캔 서버 finger_done / capture_complete 수신 ──
  const connectSSE = useCallback(() => {
    if (sseRef.current) sseRef.current.close()
    const es = new EventSource(`${SCAN_SERVER_URL}/status/events`)

    es.onmessage = (e: MessageEvent) => {
      try {
        const msg = JSON.parse(e.data as string) as {
          type: string
          finger?: string
          doneCount?: number
        }

        if (msg.type === 'finger_done' && msg.finger) {
          const hand: HandSide = stepIndexRef.current < 5 ? 'LEFT' : 'RIGHT'
          setUploadedSteps((prev) => new Set(prev).add(`${hand}-${msg.finger as string}`))
          // ref 직접 업데이트 (useEffect 지연 없이 즉시 반영)
          stepIndexRef.current += 1
          setCurrentStepIndex(stepIndexRef.current)
        }

        if (msg.type === 'capture_complete') {
          const curIdx = stepIndexRef.current
          if (curIdx >= STEPS.length) {
            // 양손 모두 완료 → 결과 페이지로 이동
            setIsDone(true)
            handleCloseFullscreen()
          } else {
            // 왼손 완료 → 오른손 자동 시작 (SSE 재연결 없음 — 이벤트 유실 방지)
            const doRightScan = async () => {
              try {
                let nextScanId = scanIdsRef.current['RIGHT']
                if (nextScanId === null) {
                  const data = await startScan('RIGHT')
                  nextScanId = data.scanId
                  setScanIds((prev) => ({ ...prev, RIGHT: nextScanId }))
                  scanIdsRef.current = { ...scanIdsRef.current, RIGHT: nextScanId }
                }
                await requestAnalyze(nextScanId)
              } catch { /* 에러 무시 */ }
            }
            void doRightScan()
          }
        }
      } catch { /* JSON parse 실패 무시 */ }
    }

    es.onerror = () => { /* 브라우저가 자동 재연결 */ }
    sseRef.current = es
  }, [handleCloseFullscreen])

  // ── 스캔 시작: scanId 발급 → Spring Boot → 스캔 서버 → SSE 연결
  const handleOpenFullscreen = async () => {
    setCameraError(null)
    setIsUploading(true)
    try {
      // 카메라 설정 동기화
      await fetch(
          `${SCAN_SERVER_URL}/camera/config?top=${topCameraIdx}&side=${sideCameraIdx}`,
          { method: 'POST' },
      ).catch(() => { /* 서버 꺼져있으면 무시 */ })

      let currentScanId = scanIds[currentHand]
      if (currentScanId === null) {
        const data = await startScan(currentHand)
        currentScanId = data.scanId
        setScanIds((prev) => ({ ...prev, [currentHand]: currentScanId }))
        scanIdsRef.current = { ...scanIdsRef.current, [currentHand]: currentScanId }
      }
      await requestAnalyze(currentScanId)
      connectSSE()
      setIsFullscreen(true)
    } catch (e) {
      setCameraError(e instanceof ApiError ? e.message : '스캔 시작에 실패했습니다.')
    } finally {
      setIsUploading(false)
    }
  }

  // ── 수동 촬영: 스캔 서버에 force-capture 요청 ────────────────
  const handleCaptureFinger = async () => {
    try {
      await fetch(`${SCAN_SERVER_URL}/capture/force`, { method: 'POST' })
    } catch {
      setCameraError('촬영 요청 실패 — 스캔 서버 연결을 확인하세요.')
    }
  }

  // ── 스캔 서버 카메라 인덱스 변경 ─────────────────────────────
  const handleCameraChange = async (top: number, side: number) => {
    setTopCameraIdx(top)
    setSideCameraIdx(side)
    await fetch(`${SCAN_SERVER_URL}/camera/config?top=${top}&side=${side}`, {
      method: 'POST',
    }).catch(() => { /* 무시 */ })
  }

  // ── SSE 정리 ─────────────────────────────────────────────────
  useEffect(() => { return () => { sseRef.current?.close() } }, [])

  // ── isDone → 결과 페이지 이동 ─────────────────────────────────
  useEffect(() => {
    if (isDone) {
      // 스냅샷은 "스캔 도중 다른 페이지 갔다가 복귀"를 위한 것이지, 완료된
      // 스캔을 위한 게 아님 - 여기서 지우지 않으면 결과 페이지(특히 실패
      // 화면)의 "다시 촬영하기"가 /scan/hand를 새로 열어도 isDone:true가
      // 그대로 복원돼서 이 effect가 즉시 다시 /scan/result로 튕겨버림 -
      // 버튼을 눌러도 화면이 안 바뀌는 것처럼 보이는 원인.
      handScanSnapshot = null
      navigate('/scan/result', {
        state: {
          leftScanId:  scanIdsRef.current.LEFT,
          rightScanId: scanIdsRef.current.RIGHT,
        },
      })
    }
  }, [isDone, navigate])

  // ── 스냅샷 저장 ───────────────────────────────────────────────
  useEffect(() => {
    handScanSnapshot = { currentStepIndex, scanIds, uploadedSteps, isDone }
  }, [currentStepIndex, scanIds, uploadedSteps, isDone])

  // ── 이탈 경고: 촬영을 진행 중일 때 새로고침/탭 닫기/헤더 링크로 나가려 하면 경고 ──
  useLeaveWarning(
      !isDone && (currentStepIndex > 0 || scanIds.LEFT !== null || scanIds.RIGHT !== null),
      '지금 나가면 촬영 진행 상황이 초기화돼 처음부터 다시 찍어야 해요. 그래도 나가시겠어요?',
      () => { handScanSnapshot = null },
  )

  // ── ESC 키 ───────────────────────────────────────────────────
  useEffect(() => {
    if (!isFullscreen) return
    const onKeyDown = (e: KeyboardEvent) => { if (e.key === 'Escape') handleCloseFullscreen() }
    document.body.style.overflow = 'hidden'
    window.addEventListener('keydown', onKeyDown)
    return () => { document.body.style.overflow = ''; window.removeEventListener('keydown', onKeyDown) }
  }, [isFullscreen, handleCloseFullscreen])

  // ── 풀스크린 오버레이 ─────────────────────────────────────────
  const fullscreenOverlay = isFullscreen
      ? createPortal(
          <div className="hand-scan-fs" role="dialog" aria-modal="true" aria-label="손 촬영">
            <div className="hand-scan-fs__feeds">
              {/* 탑뷰: 스캔 서버 MJPEG 스트림 (ArUco 가이드선 포함) */}
              <div className="hand-scan-fs__feed">
                <img
                    src={`${SCAN_SERVER_URL}/stream/top`}
                    className="hand-scan-fs__video"
                    alt="탑뷰 스캔 피드"
                />
                <div className="hand-scan-fs__feed-select-wrap">
                  <label className="hand-scan-fs__feed-select-label">
                    <span className="hand-scan-fs__feed-select-name">카메라 1</span>
                    <div className="hand-scan-fs__feed-select-inner">
                      <select
                          className="hand-scan-fs__feed-select"
                          value={topCameraIdx}
                          onChange={(e) => void handleCameraChange(Number(e.target.value), sideCameraIdx)}
                      >
                        <option value={0}>인덱스 0</option>
                        <option value={1}>인덱스 1</option>
                        <option value={2}>인덱스 2</option>
                      </select>
                    </div>
                  </label>
                </div>
              </div>

              <div className="hand-scan-fs__divider" aria-hidden="true" />

              {/* 사이드뷰: sideCameraIdx가 웹캠(>=0) 또는 폰(-2)일 때 스트림 표시 */}
              <div className="hand-scan-fs__feed">
                {sideCameraIdx >= 0 || sideCameraIdx === -2 ? (
                    <img
                        src={`${SCAN_SERVER_URL}/stream/side`}
                        className="hand-scan-fs__video"
                        alt="사이드뷰 스캔 피드"
                    />
                ) : null}
                {sideCameraIdx === -2 ? (
                    <p className="hand-scan-fs__phone-hint">
                      폰 브라우저에서 {PHONE_CAM_URL}/phone/side 를 열어 카메라를 연결하세요
                    </p>
                ) : null}
                <div className="hand-scan-fs__feed-select-wrap">
                  <label className="hand-scan-fs__feed-select-label">
                    <span className="hand-scan-fs__feed-select-name">카메라 2</span>
                    <div className="hand-scan-fs__feed-select-inner">
                      <select
                          className="hand-scan-fs__feed-select"
                          value={sideCameraIdx}
                          onChange={(e) => void handleCameraChange(topCameraIdx, Number(e.target.value))}
                      >
                        <option value={-1}>사용 안 함</option>
                        <option value={-2}>폰(원격)</option>
                        <option value={0}>인덱스 0</option>
                        <option value={1}>인덱스 1</option>
                        <option value={2}>인덱스 2</option>
                      </select>
                    </div>
                  </label>
                </div>
              </div>
            </div>

            <div className="hand-scan-fs__vignette" aria-hidden="true" />

            <button
                type="button"
                className="hand-scan-fs__close"
                onClick={handleCloseFullscreen}
                aria-label="촬영 종료"
            >
              <svg viewBox="0 0 24 24" width="22" height="22" fill="none" aria-hidden="true">
                <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              </svg>
            </button>

            <p className="hand-scan-fs__prompt">
              <svg className="hand-scan-fs__prompt-icon" viewBox="0 0 24 24" width="15" height="15" fill="none" aria-hidden="true">
                <path d="M12 4.5l9 15.5H3l9-15.5z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" strokeLinecap="round" />
                <line x1="12" y1="10.5" x2="12" y2="14.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
                <circle cx="12" cy="17.2" r="1" fill="currentColor" />
              </svg>
              {HAND_LABELS[currentHand]} {FINGER_LABELS[currentFinger]}를 탑뷰 박스에 넣고 ArUco 마커와 함께 찍어주세요
              <svg className="hand-scan-fs__prompt-icon" viewBox="0 0 24 24" width="15" height="15" fill="none" aria-hidden="true">
                <path d="M12 4.5l9 15.5H3l9-15.5z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" strokeLinecap="round" />
                <line x1="12" y1="10.5" x2="12" y2="14.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
                <circle cx="12" cy="17.2" r="1" fill="currentColor" />
              </svg>
            </p>

            <div className="hand-scan-fs__finger-badge">
            <span className="hand-scan-fs__finger-badge-name">
              {FINGER_LABELS[currentFinger]}
              <span className="hand-scan-fs__finger-badge-hand">
                ({currentHand === 'LEFT' ? 'L' : 'R'})
              </span>
            </span>
              <span className="hand-scan-fs__finger-badge-divider" />
              <span className="hand-scan-fs__finger-badge-progress">
              {currentStepIndex + 1}/{STEPS.length}
            </span>
            </div>

            <div className="hand-scan-fs__capture-wrap">
              <button
                  type="button"
                  className="hand-scan__action-btn hand-scan-fs__capture"
                  onClick={() => void handleCaptureFinger()}
              >
                지금 촬영
              </button>
            </div>
          </div>,
          document.body,
      )
      : null

  // ── 게이트: 로딩 ─────────────────────────────────────────────
  if (gateStatus === 'checking') {
    return (
        <AppShell mainClassName="hand-scan-page hand-scan-page--gate">
          <p className="hand-scan-rescan-gate__loading">이전 분석 기록을 확인하는 중...</p>
        </AppShell>
    )
  }

  // ── 게이트: 이전 기록 있음 ─────────────────────────────────────
  if (gateStatus === 'show' && latestCompletedSession) {
    const session = latestCompletedSession
    const dateLabel = formatScanDateLabel(session.scannedAt)
    const skinHex = session.skinToneHex
    const toneLabel = skinHex ? analyzeSkinTone(skinHex).tone.label.replace(/\s+/g, '') : '미분석'
    const shapeLabel = session.recommendedShape
        ? getNailShape(session.recommendedShape)?.labelKo ?? session.recommendedShape
        : null
    const metricsLine = [
      `길이 ${session.avgLengthMm != null ? `${Number(session.avgLengthMm).toFixed(1)}mm` : '-'}`,
      `너비 ${session.avgWidthMm != null ? `${Number(session.avgWidthMm).toFixed(1).replace(/\.0$/, '')}mm` : '-'}`,
      `곡률 ${formatMetricCurve(session.avgCurve)}`,
    ].join(' · ')

    return (
        <>
          <AppShell mainClassName="hand-scan-page hand-scan-page--gate">
            <section className="hand-scan-rescan-gate" aria-labelledby="rescan-gate-title">
              <div className="hand-scan-rescan-gate__icon" aria-hidden="true">
                <WarningIcon width={28} height={28} />
              </div>

              <h2 id="rescan-gate-title" className="hand-scan-rescan-gate__title">
                이미 손 분석 결과 기록이 있습니다.
              </h2>

              <div className="hand-scan-rescan-gate__record">
                <div className="hand-scan-rescan-gate__record-head">
                  <span className="hand-scan-rescan-gate__record-label">최근 분석 기록</span>
                  <button
                      type="button"
                      className="hand-scan-rescan-gate__record-all-link"
                      onClick={() => navigate('/mypage', { state: { tab: 'scans' } })}
                  >
                    전체 기록 보기
                  </button>
                </div>
                <button
                    type="button"
                    className="hand-scan-rescan-gate__record-open"
                    onClick={() => setDetailSession(session)}
                >
                  <span
                      className="hand-scan-rescan-gate__record-swatch"
                      style={{ background: skinHex ?? '#de869f' }}
                      aria-hidden="true"
                  />
                  <span className="hand-scan-rescan-gate__record-body">
                    <strong className="hand-scan-rescan-gate__record-date">{dateLabel}</strong>
                    <span className="hand-scan-rescan-gate__record-season">{toneLabel}</span>
                    <span className="hand-scan-rescan-gate__record-metrics">{metricsLine}</span>
                    <span className="hand-scan-rescan-gate__record-shape">
                      추천 쉐입: {shapeLabel ?? '미정'}
                    </span>
                  </span>
                </button>
              </div>

              <p className="hand-scan-rescan-gate__desc">
                새로 스캔하면 분석 결과가 추가로 저장됩니다.
                <br />
                손이 달라졌거나 더 정확한 측정이 필요할 때만 다시 진행해 주세요.
              </p>

              <div className="hand-scan-rescan-gate__actions">
                <PillButton
                    variant="ghost"
                    className="hand-scan-rescan-gate__btn"
                    onClick={handleConfirmRescan}
                >
                  다시 스캔하기
                </PillButton>
                <PillButton
                    variant="primary"
                    className="hand-scan-rescan-gate__btn"
                    onClick={() =>
                        navigate('/print', {
                          state: {
                            leftScanId: session.leftScanId,
                            rightScanId: session.rightScanId,
                          },
                        })
                    }
                >
                  네일팁 출력하러 가기
                </PillButton>
              </div>
            </section>
          </AppShell>

          <ScanDetailModal session={detailSession} onClose={() => setDetailSession(null)} />
        </>
    )
  }

  // ── 메인 스캔 페이지 ──────────────────────────────────────────
  return (
      <>
        <AppShell mainClassName="hand-scan-page">
          <PageHero
              eyebrow="Hand Scan"
              title="손 촬영 및 스캔"
              description={
                <>
                  두 카메라가 동시에 촬영하여 손톱 형태와 곡률을 분석합니다.<br />
                  왼손 다섯 손가락을 먼저 촬영한 뒤, 오른손 다섯 손가락을 이어서 촬영합니다.
                </>
              }
              align="center"
          />

          <div className="hand-scan__progress-groups">
            {HANDS.map((hand) => (
                <div key={hand} className="hand-scan__progress-group">
                  <div className="hand-scan__progress">
                    {FINGERS.map((finger) => {
                      const stepIdx = STEPS.findIndex((s) => s.hand === hand && s.finger === finger)
                      return (
                          <span
                              key={`${hand}-${finger}`}
                              className={[
                                'hand-scan__progress-step',
                                uploadedSteps.has(`${hand}-${finger}`) ? 'hand-scan__progress-step--done' : '',
                                stepIdx === currentStepIndex && !isDone ? 'hand-scan__progress-step--current' : '',
                              ].filter(Boolean).join(' ')}
                          >
                      {FINGER_LABELS[finger]}({hand === 'LEFT' ? 'L' : 'R'})
                    </span>
                      )
                    })}
                  </div>
                </div>
            ))}
          </div>

          <div className="hand-scan__prep">
            <CameraSetupPreview />
          </div>

          {cameraError && <p className="hand-scan__error">{cameraError}</p>}

          {!isDone && (
              <button
                  type="button"
                  className="hand-scan__action-btn"
                  onClick={() => void handleOpenFullscreen()}
                  disabled={isUploading}
              >
                {isUploading ? '스캔 시작 중...' : '촬영 시작하기'}
              </button>
          )}
        </AppShell>

        {fullscreenOverlay}
      </>
  )
}