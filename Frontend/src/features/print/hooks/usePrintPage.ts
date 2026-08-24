import { useEffect, useMemo, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { generateStl } from '@/entities/scan/api'
import { useMyScansQuery } from '@/entities/scan/queries'
import { createPrintOrder } from '@/entities/print/api'
import { getMyProfile } from '@/entities/user/api'
import { getNailShape } from '@/shared/constants/nailShapes'
import { useLeaveWarning } from '@/shared/hooks/useLeaveWarning'
import { useSnapshotRestore } from '@/shared/hooks/useSnapshotRestore'
import { ApiError } from '@/shared/utils/apiClient'
import { AUTH_CHANGE_EVENT } from '@/shared/utils/auth'
import {
    buildScanSessions,
    isFullyAnalyzedSession,
    type ScanSession,
} from '@/shared/utils/scanDetail'

type LocationState = {
    leftScanId?: number | null
    rightScanId?: number | null
} | null

export const SESSIONS_PAGE_SIZE = 5

// 출력 신청을 완료한 뒤 다른 페이지로 갔다가(뒤로가기 포함) 돌아와도 선택 상태가
// 초기화되지 않도록, HandScanResultPage와 동일하게 모듈 스코프 스냅샷에 저장해 둔다.
// 이게 없으면 컴포넌트가 다시 마운트될 때 아래 초기 선택 로직이 selectedShape를
// 추천 쉐입으로 되돌려버려서, 사용자가 고른 쉐입 위로 "추천" 배지가 옮겨간 것처럼 보이는 버그가 있었다.
type PrintPageSnapshot = {
    selectedKey: string | null
    selectedShape: string | null
    printConfirmed: boolean
    sessionPage: number
    printModalStep: 'confirm' | 'done' | null
    detailSessionKey: string | null
}

let printPageSnapshot: PrintPageSnapshot | null = null

// 로그인/로그아웃(계정 전환)이 일어나면 이전 계정의 선택 상태가 다음 계정에게 보이지
// 않도록 스냅샷을 비운다. 실제 서버에 저장된 이력/출력 신청은 계정별로 분리되어 있어 영향 없음.
window.addEventListener(AUTH_CHANGE_EVENT, () => {
    printPageSnapshot = null
})

export function usePrintPage() {
    const navigate = useNavigate()
    const location = useLocation()
    const preselect = (location.state as LocationState) ?? null

    // 브라우저 뒤로/앞으로가기(POP)로 돌아온 경우에만 이전 선택 상태를 복원한다.
    // 앱 안의 링크/버튼으로 들어온 경우엔 항상 처음부터 새로 시작한다.
    const snapshot = useSnapshotRestore(printPageSnapshot, () => {
        printPageSnapshot = null
    })
    const wasRestoredRef = useRef(!!snapshot)

    const scansQuery = useMyScansQuery()
    const sessions = useMemo(
        () => buildScanSessions(scansQuery.data ?? []).filter(isFullyAnalyzedSession),
        [scansQuery.data],
    )
    const [selectedKey, setSelectedKey] = useState<string | null>(snapshot?.selectedKey ?? null)
    const [selectedShape, setSelectedShape] = useState<string | null>(snapshot?.selectedShape ?? null)
    const [detailSession, setDetailSession] = useState<ScanSession | null>(null)
    const [userName, setUserName] = useState('')
    const [sessionPage, setSessionPage] = useState(snapshot?.sessionPage ?? 1)

    const [printModalStep, setPrintModalStep] = useState<'confirm' | 'done' | null>(snapshot?.printModalStep ?? null)
    const [isSubmitting, setIsSubmitting] = useState(false)
    const [submitError, setSubmitError] = useState<string | null>(null)
    const [printConfirmed, setPrintConfirmed] = useState(snapshot?.printConfirmed ?? false)

    // 선택 상태를 모듈 스코프 스냅샷에 반영해 둔다 — 뒤로가기로 돌아왔을 때 복원된다.
    useEffect(() => {
        printPageSnapshot = {
            selectedKey,
            selectedShape,
            printConfirmed,
            sessionPage,
            printModalStep,
            detailSessionKey: detailSession?.key ?? null,
        }
    }, [selectedKey, selectedShape, printConfirmed, sessionPage, printModalStep, detailSession])

    // 출력 신청을 완료한 뒤에만 경고한다 — 그 전(기록/쉐입을 고르는 중)에는 언제든 자유롭게
    // 나갈 수 있어야 한다. 뒤로가기는 여기서도 그대로 허용(스냅샷이 복원해줌). 새로고침/탭
    // 닫기/헤더 내비게이션 등으로 벗어나려 할 때만 경고하고, 그래도 나가면 스냅샷을 비워서
    // 다음엔 처음부터 다시 고르게 한다.
    useLeaveWarning(
        printConfirmed,
        '지금 나가면 화면 내용이 초기화돼요. 출력 신청 내역은 마이페이지에서 확인할 수 있어요. 그래도 나가시겠어요?',
        () => {
            printPageSnapshot = null
        },
    )

    useEffect(() => {
        let cancelled = false
        void getMyProfile()
            .then((profile) => {
                if (!cancelled) setUserName(profile.nickname || profile.name || '')
            })
            .catch(() => {
                // 이름 못 가져와도 진행
            })
        return () => {
            cancelled = true
        }
    }, [])

    // 스캔 이력은 마이페이지/손 촬영/디자인 채팅과 같은 react-query 캐시(useMyScansQuery)를
    // 공유한다 — 기록을 골라 선택 상태를 세팅하는 로직 자체는 그대로고, 데이터를 가져오는
    // 방식만 캐시 가능한 쿼리로 바뀐 것. 에러 시 세션 목록을 비워두는 것도 기존과 동일.
    useEffect(() => {
        if (!scansQuery.data) return

        // 스냅샷으로 복원된 경우엔 이미 선택 상태가 있으므로 추천값으로 덮어쓰지 않는다.
        if (wasRestoredRef.current) {
            if (snapshot?.detailSessionKey) {
                const match = sessions.find((s) => s.key === snapshot.detailSessionKey)
                if (match) setDetailSession(match)
            }
            return
        }

        // 이전 화면(재스캔 안내 카드 등)에서 특정 스캔을 지정해 넘어온 경우 그 기록을 우선 선택
        const preselected = preselect
            ? sessions.find(
                (s) =>
                    (preselect.leftScanId != null && s.leftScanId === preselect.leftScanId) ||
                    (preselect.rightScanId != null && s.rightScanId === preselect.rightScanId),
            )
            : null
        const initial = preselected ?? sessions[0] ?? null
        if (initial) {
            setSelectedKey(initial.key)
            setSelectedShape(initial.recommendedShape ?? initial.shape ?? 'round')
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [scansQuery.data])

    const selectedSession = useMemo(
        () => sessions.find((s) => s.key === selectedKey) ?? null,
        [sessions, selectedKey],
    )

    const sessionTotalPages = Math.max(1, Math.ceil(sessions.length / SESSIONS_PAGE_SIZE))
    const sessionCurrentPage = Math.min(sessionPage, sessionTotalPages)
    const pagedSessions = sessions.slice(
        (sessionCurrentPage - 1) * SESSIONS_PAGE_SIZE,
        sessionCurrentPage * SESSIONS_PAGE_SIZE,
    )

    const handleGoToDesign = () => {
        if (!selectedSession) return
        navigate('/design/chat', {
            state: {
                scanId: selectedSession.leftScanId ?? selectedSession.rightScanId ?? null,
                leftScanId: selectedSession.leftScanId,
                rightScanId: selectedSession.rightScanId,
                seasonCode: selectedSession.seasonCode ?? null,
            },
        })
    }

    const handleSelectSession = (session: ScanSession) => {
        if (printConfirmed) return
        setSelectedKey(session.key)
        // 기록을 바꾸면 그 기록의 추천 쉐입으로 다시 맞춰준다 (사용자가 이미 직접 고른 경우는 유지해도 되지만,
        // 기록마다 손 형태가 다를 수 있어 추천값으로 리셋하는 편이 안전함)
        setSelectedShape(session.recommendedShape ?? session.shape ?? 'round')
    }

    const handleOpenPrintConfirm = () => {
        if (!selectedSession || !selectedShape || isSubmitting || printConfirmed) return
        setSubmitError(null)
        setPrintModalStep('confirm')
    }

    const handleClosePrintModal = () => {
        if (isSubmitting) return
        setPrintModalStep(null)
    }

    const handleConfirmPrint = async () => {
        if (!selectedSession || !selectedShape) return
        setIsSubmitting(true)
        setSubmitError(null)
        try {
            const { leftScanId, rightScanId } = selectedSession
            await Promise.all([
                leftScanId ? generateStl(leftScanId, selectedShape) : Promise.resolve(),
                rightScanId ? generateStl(rightScanId, selectedShape) : Promise.resolve(),
            ])
            const shapeLabelKo = getNailShape(selectedShape)?.labelKo ?? selectedShape
            await createPrintOrder({ shapeId: selectedShape, shapeLabelKo, leftScanId, rightScanId })
            setPrintConfirmed(true)
            setPrintModalStep('done')
        } catch (e) {
            const msg = e instanceof ApiError ? e.message : '출력 신청에 실패했습니다.'
            setSubmitError(msg)
            setPrintModalStep(null)
        } finally {
            setIsSubmitting(false)
        }
    }

    return {
        navigate,
        isLoading: scansQuery.isPending,
        sessions,
        selectedKey,
        selectedShape,
        setSelectedShape,
        detailSession,
        setDetailSession,
        userName,
        sessionPage,
        setSessionPage,
        printModalStep,
        setPrintModalStep,
        isSubmitting,
        submitError,
        printConfirmed,
        selectedSession,
        sessionTotalPages,
        sessionCurrentPage,
        pagedSessions,
        handleGoToDesign,
        handleSelectSession,
        handleOpenPrintConfirm,
        handleClosePrintModal,
        handleConfirmPrint,
    }
}
