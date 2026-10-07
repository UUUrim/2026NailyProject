import { apiClient } from '@/shared/utils/apiClient'

export interface PrintOrderResponse {
    id: number
    shapeId: string
    shapeLabelKo: string
    tipExtensionMm?: number | null // 출력 화면에서 설정한 팁 연장 길이(mm). null이면 길이 기록 전 예전 주문
    status: 'QUEUED' | 'MERGING' | 'MERGED' | 'WAITING_IN_QUEUE' | 'PRINTING' | 'COMPLETED' | 'FAILED'
    orderedAt: string // "yyyy. M. d. HH:mm:ss"
    leftScanId: number | null
    rightScanId: number | null
    mergedModelUrl?: string | null
    failReason?: string | null
    queueAhead?: number | null // WAITING_IN_QUEUE일 때만: 내 앞에 출력 중/대기 중인 주문 수
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

/** GET /users/me/prints — 내 네일팁 출력 내역 전체 조회 */
export async function getMyPrintOrders(): Promise<PrintOrderResponse[]> {
    const res = await apiClient.get<PrintOrderResponse[]>('/users/me/prints')
    return res.data
}

export async function completePrintOrder(orderId: number): Promise<void> {
    await apiClient.patch(`/prints/${orderId}/complete`)
}

export interface PrinterProgress {
    success: boolean
    state: string | null // 예: PRINTING, CALIBRATING_EXTRUSION, IDLE, UNKNOWN
    percentage: number | null
    remainingTimeMin: number | null
    nozzleTemp: number | null
    bedTemp: number | null
    queueSize?: number // 프린터 서버 대기열에 쌓인 (아직 시작 안 한) 작업 수 — 프린터 전체 기준
    message?: string | null // 실패 시 원인
}

/** GET /users/me/prints/progress — 프린터 실시간 진행 상황 조회 (출력 중일 때 몇 초 간격으로 폴링) */
export async function getPrinterProgress(): Promise<PrinterProgress> {
    const res = await apiClient.get<PrinterProgress>('/users/me/prints/progress')
    return res.data
}