import { useEffect, useRef, useState } from 'react'
import { useNavigate, useLocation, useNavigationType } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { getNailShape } from '@/shared/constants/nailShapes'
import { confirmScanResult, getScanResult, type ScanResultResponse } from '@/entities/scan/api'
import { MY_SCAN_SESSIONS_QUERY_KEY } from '@/entities/scan/queries'
import { getMyProfile } from '@/entities/user/api'
import { ApiError } from '@/shared/utils/apiClient'
import { analyzeSkinTone, generateSkinTonePalette, skinToneAnalysisFromMetrics } from '@/shared/utils/skinTone'
import { sortRecommendedColors } from '@/shared/utils/colorSort'
import { FINGER_SIZE_MM, nailSummaryMetrics, type NailSummaryMetric } from '@/shared/utils/nailMetrics'
import { useLeaveWarning } from '@/shared/hooks/useLeaveWarning'
import { AUTH_CHANGE_EVENT } from '@/shared/utils/auth'
import type { FingerDetail } from '@/shared/utils/handScanAnalysis'

const LEAVE_DURING_ANALYSIS_WARNING =
    '지금 나가면 분석이 중단되어 다시 촬영해야 해요. 그래도 나가시겠어요?'
const LEAVE_AFTER_ANALYSIS_WARNING =
    '지금 나가면 진행 상황이 초기화돼요. 분석 결과는 마이페이지에서 다시 확인할 수 있어요. 그래도 나가시겠어요?'

// 이 페이지 상태를 모듈 스코프에 스냅샷으로 저장해서, 디자인 채팅 등 다른 페이지로 이동했다가
// (뒤로가기 포함) 돌아와도 분석 결과가 초기화되지 않도록 한다.
// 다른 스캔 결과를 보러 온 경우(scanId가 다름)까지 잘못 복원하지 않도록 scanId가 일치할 때만 사용한다.
type HandScanResultSnapshot = {
    leftScanId: number | null
    rightScanId: number | null
    leftResult: ScanResultResponse | null
    rightResult: ScanResultResponse | null
    userName: string
    showFingerModal: boolean
}

let handScanResultSnapshot: HandScanResultSnapshot | null = null

// 손가락별 measurements JSON(scan/server.py → ScanImg.measurements)의 필드 형태.
// cCurveMm이 실제 파이프라인 필드명이고, cCurve/curve는 옛 목업 데이터 호환용 fallback이다.
type FingerMeasurements = {
    lengthMm?: number
    length?: number
    widthMm?: number
    width?: number
    cCurveMm?: number
    cCurve?: number
    curve?: number
}

// 분석 중 뒤로가기를 가로채려고 히스토리에 한 칸 더 쌓는 "가드" 항목 표시
const ANALYSIS_GUARD_KEY = 'nailyScanAnalysisGuard'

// 가드 항목은 React Router가 쓰는 현재 history.state(usr = { leftScanId, rightScanId })를 그대로
// 복사해서 쌓는다. 예전엔 state 없이(null) 쌓아서, 분석이 끝난 뒤 네일팁 출력 화면에서 뒤로가기로
// 이 항목에 돌아오면 scanId가 비어 "손 스캔 결과가 없습니다"가 떴다.
function pushAnalysisGuardEntry() {
    window.history.pushState({ ...window.history.state, [ANALYSIS_GUARD_KEY]: true }, '', window.location.href)
}

// 로그인/로그아웃(계정 전환)이 일어나면 이전 계정의 분석 결과 화면이 다음 계정에게
// 보이지 않도록 스냅샷을 비운다. 실제 서버에 저장된 이력은 계정별로 분리되어 있어 영향 없음.
window.addEventListener(AUTH_CHANGE_EVENT, () => {
    handScanResultSnapshot = null
})

export function useHandScanResultPage() {
    const navigate = useNavigate()
    const location = useLocation()
    const { leftScanId, rightScanId } = (location.state as
        | { leftScanId?: number | null; rightScanId?: number | null }
        | null) ?? {}
    const fromMypage = !!(location.state as { fromMypage?: boolean } | null)?.fromMypage

    // 브라우저 뒤로/앞으로가기(POP)로, 그리고 지금 보려는 scanId와 스냅샷에 저장된
    // scanId가 일치할 때만 "돌아온 것"으로 보고 복원한다. 앱 안의 링크/버튼으로
    // 들어온 경우엔 같은 scanId라도 항상 새로 불러온다.
    const navigationType = useNavigationType()
    const wasRestoredRef = useRef(
        navigationType === 'POP' &&
            !!handScanResultSnapshot &&
            handScanResultSnapshot.leftScanId === (leftScanId ?? null) &&
            handScanResultSnapshot.rightScanId === (rightScanId ?? null),
    )
    const snapshot = wasRestoredRef.current ? handScanResultSnapshot : null

    const [leftResult, setLeftResult] = useState<ScanResultResponse | null>(snapshot?.leftResult ?? null)
    const [rightResult, setRightResult] = useState<ScanResultResponse | null>(snapshot?.rightResult ?? null)
    const [isLoading, setIsLoading] = useState(!wasRestoredRef.current)
    const [error, setError] = useState<string | null>(null)
    const [showFingerModal, setShowFingerModal] = useState(snapshot?.showFingerModal ?? false)
    const [userName, setUserName] = useState(snapshot?.userName ?? '')
    // 분석 결과를 아직 기다리는 중인지(폴링이 끝나지 않았는지) — 이 사이에 페이지를 벗어나면
    // 결과가 화면에 뜨지 않아 손 분석 기록으로 확정되지 않고, 손 촬영을 다시 해야 한다.
    const [isAnalyzing, setIsAnalyzing] = useState(false)

    const TERMINAL_STATUSES = ['MEASURED', 'COMPLETED', 'FAILED']

    // 왼손/오른손이 같은 값을 주면 그대로 사용(=둘 다 반영된 합의값).
    // 드물게 서로 다르면, 분석 파이프라인이 더 진행된(COMPLETED) 쪽을 우선하고,
    // 그마저 같으면 왼손을 우선한다.
    function pickHandField<K extends 'shape' | 'recommendedShape'>(
        field: K,
        left: ScanResultResponse | null,
        right: ScanResultResponse | null,
    ): ScanResultResponse[K] | null {
        const l = left?.[field] ?? null
        const r = right?.[field] ?? null
        if (l == null) return r
        if (r == null) return l
        if (l === r) return l
        const rightIsMoreComplete = right?.status === 'COMPLETED' && left?.status !== 'COMPLETED'
        return rightIsMoreComplete ? r : l
    }

    useEffect(() => {
        if (wasRestoredRef.current) return // 이미 복원된 이름이 있으므로 다시 불러오지 않는다
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

    useEffect(() => {
        if (!leftScanId && !rightScanId) return
        // 이미 복원된 결과가 있으므로 다시 폴링하지 않는다 — 안 그러면 선택해 둔 쉐입이 재조회 결과로 덮어써진다.
        if (wasRestoredRef.current) return

        let cancelled = false // 언마운트되면 true로 바뀌어서, 예약된 다음 poll()이 실행돼도 즉시 멈춘다
        let timer: ReturnType<typeof setTimeout> | null = null
        setIsAnalyzing(true)

        const fetchBoth = async (): Promise<[string | null, string | null]> => {
            const [leftRes, rightRes] = await Promise.all([
                leftScanId ? getScanResult(leftScanId).catch((e) => {
                    setError(e instanceof ApiError ? e.message : '오류가 발생했습니다.')
                    return null
                }) : Promise.resolve(null),
                rightScanId ? getScanResult(rightScanId).catch((e) => {
                    setError(e instanceof ApiError ? e.message : '오류가 발생했습니다.')
                    return null
                }) : Promise.resolve(null),
            ])

            if (cancelled) return [null, null] // 응답 오는 사이에 이미 페이지를 떠났으면 상태 업데이트도 하지 않는다

            if (leftRes) setLeftResult(leftRes)
            if (rightRes) setRightResult(rightRes)

            return [leftRes?.status ?? null, rightRes?.status ?? null]
        }

        const poll = async () => {
            const [leftStatus, rightStatus] = await fetchBoth()
            if (cancelled) return
            const leftDone = !leftScanId || (leftStatus && TERMINAL_STATUSES.includes(leftStatus))
            const rightDone = !rightScanId || (rightStatus && TERMINAL_STATUSES.includes(rightStatus))
            if (leftDone && rightDone) {
                // 양손 다 최종 상태(측정 완료 또는 실패)가 됐을 때만 로딩을 끝낸다.
                setIsLoading(false)
                setIsAnalyzing(false)
            } else {
                timer = setTimeout(() => void poll(), 3000)
            }
        }

        void poll()

        return () => {
            cancelled = true
            if (timer) clearTimeout(timer)
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [leftScanId, rightScanId, fromMypage])

    // 분석이 끝난 뒤에는 뒤로가기를 그대로 허용한다 — 스냅샷이 항상 복원해주므로 내용이
    // 사라지지 않는다. 새로고침/탭 닫기/헤더 내비게이션 등 "뒤로가기가 아닌" 방식으로 벗어나려
    // 할 때만 경고하고, 그래도 나가면 스냅샷을 비워서 다음엔 처음부터 새로 진행하도록 한다.
    useLeaveWarning(
        !!(leftScanId || rightScanId),
        isAnalyzing ? LEAVE_DURING_ANALYSIS_WARNING : LEAVE_AFTER_ANALYSIS_WARNING,
        () => {
            handScanResultSnapshot = null
        },
    )

    // 분석이 "진행 중"일 때는 뒤로가기도 예외적으로 막는다 — 아직 결과가 나오지 않은 상태라
    // 스냅샷을 복원해도 이어서 보여줄 완성된 결과가 없기 때문에, 다른 페이지들과 달리 여기서는
    // 뒤로가기도 경고 후 진행되게 하고, 그래도 나가면 분석을 중단시키고(=폴링을 멈추고 스냅샷을
    // 비워서) 다음엔 손 촬영부터 새로 하도록 한다.
    useEffect(() => {
        if (!isAnalyzing) return

        pushAnalysisGuardEntry()

        const handlePopState = () => {
            const confirmed = window.confirm(LEAVE_DURING_ANALYSIS_WARNING)
            if (confirmed) {
                handScanResultSnapshot = null
                window.removeEventListener('popstate', handlePopState)
                window.history.back()
            } else {
                pushAnalysisGuardEntry()
            }
        }

        window.addEventListener('popstate', handlePopState)
        return () => window.removeEventListener('popstate', handlePopState)
    }, [isAnalyzing])

    // 분석이 끝나면 가드 항목을 걷어낸다 — 남겨두면 결과 화면에서 뒤로가기를 한 번 더 눌러야
    // 빠져나가진다. 바로 아래 항목은 같은 주소·같은 state의 이 결과 화면이라 화면은 그대로다.
    // (마운트 직후처럼 분석을 한 적 없는 상태에선 건드리지 않는다)
    const wasAnalyzingRef = useRef(false)
    useEffect(() => {
        if (isAnalyzing) {
            wasAnalyzingRef.current = true
            return
        }
        if (!wasAnalyzingRef.current) return
        wasAnalyzingRef.current = false
        if (window.history.state?.[ANALYSIS_GUARD_KEY]) window.history.back()
    }, [isAnalyzing])

    // 분석 결과 상태를 모듈 스코프 스냅샷에 반영해 둔다.
    // 다른 페이지로 이동했다가(디자인 채팅 등) 돌아와도 위 useState 초기값이 여기서 복원된다.
    useEffect(() => {
        handScanResultSnapshot = {
            leftScanId: leftScanId ?? null,
            rightScanId: rightScanId ?? null,
            leftResult,
            rightResult,
            userName,
            showFingerModal,
        }
    }, [leftScanId, rightScanId, leftResult, rightResult, userName, showFingerModal])

    // 왼손 결과를 베이스로 하고, shape/recommendedShape는 양손 결과를 함께 반영해서 병합
    const baseResult = leftResult ?? rightResult
    const result = baseResult
        ? {
            ...baseResult,
            shape: pickHandField('shape', leftResult, rightResult) ?? baseResult.shape,
            recommendedShape: pickHandField('recommendedShape', leftResult, rightResult) ?? baseResult.recommendedShape,
        }
        : null

    // 요청한 손이 전부 FAILED로 끝났으면 — 측정이 하나도 안 된 상태이므로
    // Mock 값으로 채운 화면을 "정상 완료"처럼 보여주면 안 된다.
    const leftFailed = !leftScanId || leftResult?.status === 'FAILED'
    const rightFailed = !rightScanId || rightResult?.status === 'FAILED'
    const scanFailed = !isLoading && leftFailed && rightFailed && !!(leftScanId || rightScanId)

    // 분석 결과가 화면에 뜬 뒤에야 손 분석 기록으로 확정한다 — 촬영/분석 도중 나간 스캔은 기록에 남지 않는다.
    // 양손 최종 결과 파일이 없으면 서버가 확정을 거절한다. 이미 확정된 스캔을 다시 확정해도 그대로라
    // 마이페이지에서 다시 보러 왔을 때 또 불려도 괜찮다.
    const queryClient = useQueryClient()
    const confirmRef = useRef<Promise<void> | null>(null)
    const confirmScanId = leftScanId ?? rightScanId
    const isResultShown = !isLoading && !scanFailed && result != null
    useEffect(() => {
        if (!isResultShown || !confirmScanId || confirmRef.current) return
        confirmRef.current = confirmScanResult(confirmScanId)
            .then(() => queryClient.invalidateQueries({ queryKey: MY_SCAN_SESSIONS_QUERY_KEY }))
            .catch((e) => console.error('[HandScanResult] 손 분석 기록 확정 실패', e))
    }, [isResultShown, confirmScanId, queryClient])

    // 이 페이지에서는 더 이상 쉐입을 고르거나 출력 신청을 하지 않고, 네일팁 출력 페이지로
    // 넘어가서 진행한다. 이 분석 결과를 바로 이어서 고를 수 있도록 scanId를 함께 전달한다.
    // 출력 페이지는 손 분석 기록 목록에서 이 스캔을 찾아 고르므로, 기록 확정이 끝난 뒤에 넘어간다.
    const handleGoToPrint = async () => {
        await confirmRef.current
        navigate('/print', {
            state: { leftScanId, rightScanId },
        })
    }

    const recommended = result?.recommendedShape ? getNailShape(result.recommendedShape) : null
    // scan/skin_color.py가 10손가락 LAB 평균으로 계산해 API에 내려주는 실제 진단값을 우선 쓰고,
    // (구버전 스캔 등) 값이 없을 때만 대표 피부색 hex 하나로 만든 대체 추정치를 쓴다.
    const skinToneAnalysis =
        skinToneAnalysisFromMetrics(result?.tone ?? null, result?.warmness ?? null, result?.brightness ?? null, result?.saturation ?? null) ??
        (result?.skinToneHex ? analyzeSkinTone(result.skinToneHex) : null)
    // .skin-tone-palette-grid(6열)에 정렬 순서 그대로 흘려 넣는다 — 비슷한 색끼리 잇는 TSP 경로, 연한 색 → 진한 색
    const skinTonePalette = sortRecommendedColors(
        result?.recommendedColors && result.recommendedColors.length > 0
            ? result.recommendedColors
            : result?.skinToneHex
                ? generateSkinTonePalette(result.skinToneHex, 30)
                : [],
    )

    // 왼손 5손가락 + 오른손 5손가락 = 실제 10손가락
    const apiFingers = [...(leftResult?.fingers ?? []), ...(rightResult?.fingers ?? [])]

    const displayFingers = apiFingers

    const FINGER_OVERLAYS = [
        { x: 42, y: 47 },
        { x: 35, y: 23 },
        { x: 27, y: 16 },
        { x: 19, y: 22 },
        { x: 14, y: 33 },
        { x: 58, y: 47 },
        { x: 65, y: 23 },
        { x: 73, y: 16 },
        { x: 81, y: 22 },
        { x: 86, y: 33 },
    ]

    const FINGER_NAMES = [
        '엄지 (왼손)',
        '검지 (왼손)',
        '중지 (왼손)',
        '약지 (왼손)',
        '소지 (왼손)',
        '엄지 (오른손)',
        '검지 (오른손)',
        '중지 (오른손)',
        '약지 (오른손)',
        '소지 (오른손)',
    ]

    const fingerDetails: FingerDetail[] = displayFingers.map((finger, index) => {
        let measurements: FingerMeasurements = {}

        try {
            const parsed = JSON.parse(finger.measurements ?? '{}')
            measurements = parsed || {}
        } catch {
            measurements = {}
        }

        // index는 0~9(왼손 0~4 + 오른손 5~9)이므로, 손가락 종류(엄지~소지)는 %5로 구한다.
        const fingerSize = FINGER_SIZE_MM[index % 5]

        return {
            id: `finger-${index}`,
            name: FINGER_NAMES[index] ?? finger.finger,

            // 백엔드(scan/server.py) 실측값을 그대로 사용. 값이 없는 경우에만 해당 손가락의
            // 실측 평균값(FINGER_SIZE_MM)으로 대체 — 예전엔 손가락 종류와 무관하게 index가
            // 커질수록(엄지→소지) 값도 커지는 식이라, 실제로는 소지가 가장 작은데 대체값은
            // 오히려 가장 크게 나오는 등 방향이 거꾸로였다.
            lengthMm: Number(
                measurements.lengthMm ??
                measurements.length ??
                fingerSize.lengthMm
            ),

            widthMm: Number(
                measurements.widthMm ??
                measurements.width ??
                fingerSize.widthMm
            ),

            // 실제 파이프라인이 내려주는 곡률 필드명은 cCurveMm(C-curve sagitta 깊이, mm)
            // — cCurve/curve는 옛 목업 호환용. 값이 없으면 해당 손가락의 평균 곡률(mm)을 쓴다.
            cCurve: Number(
                measurements.cCurveMm ??
                measurements.cCurve ??
                measurements.curve ??
                fingerSize.cCurveMm
            ),

            overlay: FINGER_OVERLAYS[index] ?? { x: 50, y: 50 },
        }
    })

    // 손톱 기본 지표: 열 손가락 평균 길이·너비·곡률과 평균 판정 — 스캔 서버 통합 measurements.json 상단 summary 값을
    // 그대로 쓴다 (화면에서 손가락 값을 다시 평균 내거나 판정하지 않는다. 읽지 못하면 여성 평균 수치와 average).
    // 값은 소수 첫째 자리까지만 보여 준다.
    const summaryMetrics = nailSummaryMetrics(leftResult, rightResult)
    const toAverageMetric = (m: NailSummaryMetric) => ({
        value: Number(m.valueMm.toFixed(1)),
        unit: 'mm',
        barPercent: m.barPercent,
        comparisonLabel: m.label,
    })

    const AVERAGE_METRICS = {
        length: toAverageMetric(summaryMetrics.length),
        width: toAverageMetric(summaryMetrics.width),
        cCurve: toAverageMetric(summaryMetrics.cCurve),
    }

    return {
        navigate,
        leftScanId,
        rightScanId,
        isLoading,
        error,
        showFingerModal,
        setShowFingerModal,
        userName,
        isAnalyzing,
        scanFailed,
        recommended,
        skinToneAnalysis,
        skinTonePalette,
        apiFingers,
        fingerDetails,
        AVERAGE_METRICS,
        result,
        handleGoToPrint,
    }
}
