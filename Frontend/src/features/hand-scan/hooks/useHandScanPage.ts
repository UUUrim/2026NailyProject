import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { startScan, requestAnalyze } from '@/entities/scan/api'
import { useMyScansQuery } from '@/entities/scan/queries'
import { useAuth } from '@/shared/hooks/useAuth'
import { useLeaveWarning } from '@/shared/hooks/useLeaveWarning'
import { useSnapshotRestore } from '@/shared/hooks/useSnapshotRestore'
import { ApiError } from '@/shared/utils/apiClient'
import { AUTH_CHANGE_EVENT } from '@/shared/utils/auth'
import {
  buildScanSessions,
  isFullyAnalyzedSession,
  type ScanSession,
} from '@/shared/utils/scanDetail'

// 스캔 서버 주소 (로컬: http://localhost:8000, 데모: ngrok URL) — 데스크톱 브라우저 기준.
const SCAN_SERVER_URL = import.meta.env.VITE_SCAN_SERVER_URL ?? 'http://localhost:8000'

function pickLatestCompletedSession(sessions: ScanSession[]): ScanSession | null {
  const completed = sessions.filter(isFullyAnalyzedSession)
  if (completed.length === 0) return null
  return completed.reduce((latest, cur) => {
    const lt = new Date(latest.scannedAt).getTime()
    const ct = new Date(cur.scannedAt).getTime()
    return ct >= lt ? cur : latest
  })
}

export const FINGERS = ['THUMB', 'INDEX', 'MIDDLE', 'RING', 'PINKY'] as const
export type Finger = (typeof FINGERS)[number]

export const HANDS = ['LEFT', 'RIGHT'] as const
export type HandSide = (typeof HANDS)[number]

export const FINGER_LABELS: Record<Finger, string> = {
  THUMB: '엄지',
  INDEX: '검지',
  MIDDLE: '중지',
  RING: '약지',
  PINKY: '소지',
}

export const HAND_LABELS: Record<HandSide, string> = {
  LEFT: '왼손',
  RIGHT: '오른손',
}

// 왼손 5손가락 → 오른손 5손가락, 총 10단계
type ScanStep = { hand: HandSide; finger: Finger }
export const STEPS: ScanStep[] = HANDS.flatMap((hand) => FINGERS.map((finger) => ({ hand, finger })))


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

export function useHandScanPage() {
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
  // 스캔 이력은 마이페이지/출력/디자인 채팅과 같은 react-query 캐시(useMyScansQuery)를
  // 공유한다 — 게이트를 보여줄지 판단하는 로직 자체(최신 완료 세션이 있으면 'show', 없으면
  // 'pass')는 그대로고, 데이터를 가져오는 방식만 캐시 가능한 쿼리로 바뀐 것.
  const needsRescanGateCheck = !skipRescanGate && isLoggedIn
  const rescanGateScansQuery = useMyScansQuery({ enabled: needsRescanGateCheck })

  useEffect(() => {
    if (!needsRescanGateCheck) { setGateStatus('pass'); return }
    if (rescanGateScansQuery.isPending) { setGateStatus('checking'); return }
    if (rescanGateScansQuery.isError) { setGateStatus('pass'); return }
    const latest = pickLatestCompletedSession(buildScanSessions(rescanGateScansQuery.data))
    if (latest) { setLatestCompletedSession(latest); setGateStatus('show') }
    else setGateStatus('pass')
  }, [needsRescanGateCheck, rescanGateScansQuery.isPending, rescanGateScansQuery.isError, rescanGateScansQuery.data])

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
              } catch (e) {
                console.error('[HandScan] 오른손 스캔 시작 실패', e)
                setCameraError(e instanceof ApiError ? e.message : '오른손 스캔 시작에 실패했습니다. 새로고침 후 다시 시도해 주세요.')
              }
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

  return {
    navigate,
    SCAN_SERVER_URL,
    isFullscreen,
    cameraError,
    isUploading,
    topCameraIdx,
    sideCameraIdx,
    currentStepIndex,
    uploadedSteps,
    isDone,
    gateStatus,
    latestCompletedSession,
    detailSession,
    setDetailSession,
    currentHand,
    currentFinger,
    handleConfirmRescan,
    handleCloseFullscreen,
    handleOpenFullscreen,
    handleCaptureFinger,
    handleCameraChange,
  }
}
