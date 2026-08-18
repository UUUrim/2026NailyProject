import { apiClient } from '@/utils/apiClient'

export interface PrintOrderResponse {
    id: number
    shapeId: string
    shapeLabelKo: string
    status: 'QUEUED' | 'MERGING' | 'MERGED' | 'PRINTING' | 'COMPLETED' | 'FAILED'
    orderedAt: string // "yyyy. M. d. HH:mm:ss"
    leftScanId: number | null
    rightScanId: number | null
    mergedModelUrl?: string | null
    failReason?: string | null
}

/** POST /users/me/prints — 네일팁 출력 신청 기록 */
export async function createPrintOrder(params: {
    shapeId: string
    shapeLabelKo: string
    leftScanId?: number | null
    rightScanId?: number | null
}): Promise<PrintOrderResponse> {
    const res = await apiClient.post<PrintOrderResponse>('/users/me/prints', params)
    return res.data
}

/** GET /users/me/prints — 내 네일팁 출력 내역 전체 조회 */
export async function getMyPrintOrders(): Promise<PrintOrderResponse[]> {
    const res = await apiClient.get<PrintOrderResponse[]>('/users/me/prints')
    return res.data
}

export interface PrinterProgress {
    success: boolean
    state: string | null // 예: PRINTING, CALIBRATING_EXTRUSION, IDLE, UNKNOWN
    percentage: number | null
    remainingTimeMin: number | null
    nozzleTemp: number | null
    bedTemp: number | null
    message?: string | null // 실패 시 원인
}

/** GET /users/me/prints/progress — 프린터 실시간 진행 상황 조회 (출력 중일 때 몇 초 간격으로 폴링) */
export async function getPrinterProgress(): Promise<PrinterProgress> {
    const res = await apiClient.get<PrinterProgress>('/users/me/prints/progress')
    return res.data
}