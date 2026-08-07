import { BASE_URL } from '@/utils/apiClient'

/**
 * S3에 있는 디자인 이미지를 브라우저가 직접 fetch하면 CORS로 막히므로,
 * 백엔드의 다운로드 프록시(/designs/download-proxy)를 거쳐서 받아온 뒤
 * 로컬 파일로 저장한다. (로그인 필요 — 호출 전에 확인할 것)
 */
export async function downloadImage(url: string, filename: string) {
    try {
        const token = localStorage.getItem('token')
        const res = await fetch(`${BASE_URL}/designs/download-proxy?url=${encodeURIComponent(url)}`, {
            headers: { Authorization: `Bearer ${token}` },
        })
        if (!res.ok) throw new Error('다운로드 실패')
        const blob = await res.blob()
        const objectUrl = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = objectUrl
        a.download = filename
        document.body.appendChild(a)
        a.click()
        a.remove()
        URL.revokeObjectURL(objectUrl)
    } catch {
        alert('이미지 다운로드에 실패했어요. 잠시 후 다시 시도해 주세요.')
    }
}