import { apiClient } from '@/utils/apiClient'

export interface PrintOrderResponse {
    id: number
    shapeId: string
    shapeLabelKo: string
    status: 'QUEUED' | 'PRINTING' | 'COMPLETED'
    orderedAt: string // "yyyy. M. d. HH:mm"
    leftScanId: number | null
    rightScanId: number | null
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