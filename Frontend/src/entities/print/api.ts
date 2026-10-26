import { ApiError, apiClient } from '@/shared/utils/apiClient'
import { generateStl } from '@/entities/scan/api'

export interface PrintOrderResponse {
    id: number
    shapeId: string
    shapeLabelKo: string
    tipExtensionMm?: number | null // 출력 화면에서 설정한 팁 연장 길이(mm). null이면 길이 기록 전 예전 주문
    // CANCELING: 취소 요청됨(프린터가 멈추기를 기다리는 중) / CANCELED: 취소됨
    status:
        | 'QUEUED'
        | 'MERGING'
        | 'MERGED'
        | 'WAITING_IN_QUEUE'
        | 'PRINTING'
        | 'COMPLETED'
        | 'FAILED'
        | 'CANCELING'
        | 'CANCELED'
    orderedAt: string // "yyyy. M. d. HH:mm:ss"
    leftScanId: number | null
    rightScanId: number | null
    mergedModelUrl?: string | null
    failReason?: string | null
    queueAhead?: number | null // WAITING_IN_QUEUE/MERGED일 때만: 내 앞에 출력 중/대기 중인 주문 수
}

/** POST /users/me/prints — 네일팁 출력 신청 기록 */
export async function createPrintOrder(params: {
    shapeId: string
    shapeLabelKo: string
    leftScanId?: number | null
    rightScanId?: number | null
    tipExtensionMm?: number | null
}): Promise<PrintOrderResponse> {
    const res = await apiClient.post<PrintOrderResponse>('/users/me/prints', params)
    return res.data
}

/** 재출력할 수 있는 주문인지 — 출력하는 왼손 검지의 손 분석 기록(왼손 스캔)이 있어야 한다 */
export function canReprintOrder(order: Pick<PrintOrderResponse, 'leftScanId'>): boolean {
    return Boolean(order.leftScanId)
}

/**
 * 같은 설정(쉐입, 연장 길이, 손 분석 기록)으로 새 출력 주문을 만든다. 새 주문 번호가 생기고, 이전 주문은 그대로 남는다.
 * 출력 페이지가 주문을 만드는 절차와 같다(왼손 검지 하나만 출력한다): 먼저 왼손 STL을 이 쉐입/길이로 다시 만들고(같은 스캔으로 다른 설정을 출력했다면
 * 로컬 STL이 그때 값으로 덮여 있을 수 있어서 그대로 재사용하지 않는다), 그다음 출력 주문을 만든다.
 * 이 순서를 지켜야 한다 - STL 생성을 요청하면 스캔 상태가 "생성 중"이 되고, 그래야 주문이 이전 STL이 아니라
 * 새로 만든 STL이 끝나기를 기다린다.
 * 연장 길이를 기록하기 전에 신청된 예전 주문(null)은 쉐입별 기본 길이로 출력됐으므로 그대로 기본 길이로 다시 만든다.
 */
export async function reprintPrintOrder(order: PrintOrderResponse): Promise<PrintOrderResponse> {
    const { leftScanId } = order
    if (!leftScanId) {
        throw new ApiError(400, '손 분석 기록이 없는 예전 주문은 재출력할 수 없어요.')
    }
    const extensionMm = order.tipExtensionMm ?? undefined
    await generateStl(leftScanId, order.shapeId, extensionMm)
    return createPrintOrder({
        shapeId: order.shapeId,
        shapeLabelKo: order.shapeLabelKo,
        leftScanId,
        rightScanId: null,
        tipExtensionMm: order.tipExtensionMm ?? null,
    })
}

/** GET /users/me/prints — 내 네일팁 출력 내역 전체 조회 */
export async function getMyPrintOrders(): Promise<PrintOrderResponse[]> {
    const res = await apiClient.get<PrintOrderResponse[]>('/users/me/prints')
    return res.data
}

/** DELETE /users/me/prints/{orderId} — 출력 내역 삭제 (끝난 주문 = 완료/실패/취소만 가능. 진행 중인 주문은 먼저 취소해야 한다) */
export async function deletePrintOrder(orderId: number): Promise<void> {
    await apiClient.delete(`/users/me/prints/${orderId}`)
}

export async function completePrintOrder(orderId: number): Promise<void> {
    await apiClient.patch(`/prints/${orderId}/complete`)
}

/**
 * POST /users/me/prints/{orderId}/cancel — 출력 취소.
 * 대기/병합 중이던 주문은 바로 CANCELED가 되고, 출력 중인 주문은 프린터를 멈추는 동안 CANCELING이 된다.
 */
export async function cancelPrintOrder(orderId: number): Promise<PrintOrderResponse> {
    const res = await apiClient.post<PrintOrderResponse>(`/users/me/prints/${orderId}/cancel`)
    return res.data
}

/** POST /users/me/prints/{orderId}/pause — 출력 일시정지 (출력 중인 주문만. 주문 상태는 그대로 PRINTING) */
export async function pausePrintOrder(orderId: number): Promise<PrintOrderResponse> {
    const res = await apiClient.post<PrintOrderResponse>(`/users/me/prints/${orderId}/pause`)
    return res.data
}

/** POST /users/me/prints/{orderId}/resume — 일시정지 재개 */
export async function resumePrintOrder(orderId: number): Promise<PrintOrderResponse> {
    const res = await apiClient.post<PrintOrderResponse>(`/users/me/prints/${orderId}/resume`)
    return res.data
}

export interface PrinterProgress {
    success: boolean
    state: string | null // 예: PRINTING, CALIBRATING_EXTRUSION, IDLE, UNKNOWN
    percentage: number | null
    remainingTimeMin: number | null
    nozzleTemp: number | null
    bedTemp: number | null
    queueSize?: number // 프린터 서버 대기열에 쌓인 (아직 시작 안 한) 작업 수 — 프린터 전체 기준
    gcodeState?: string | null // IDLE / PREPARE / RUNNING / PAUSE / FINISH / FAILED / UNKNOWN — PAUSE면 일시정지 중
    currentOrderId?: number | null // 지금 출력(또는 출력 준비) 중인 주문 ID. 프린터가 다른 주문을 처리 중이면 내 주문 ID가 아니다
    message?: string | null // 실패 시 원인
}

/** GET /users/me/prints/progress — 프린터 실시간 진행 상황 조회 (출력 중일 때 몇 초 간격으로 폴링) */
export async function getPrinterProgress(): Promise<PrinterProgress> {
    const res = await apiClient.get<PrinterProgress>('/users/me/prints/progress')
    return res.data
}