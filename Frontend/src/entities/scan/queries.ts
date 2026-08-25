// getMyScans()는 마이페이지/손 촬영(재촬영 게이트)/네일팁 출력/디자인 채팅에서 전부
// 같은 "내 전체 스캔 이력"을 필요로 한다. 화면마다 따로 fetch하면 페이지를 옮겨 다닐 때마다
// 같은 데이터를 매번 새로 받아오게 되므로, 하나의 쿼리 키로 react-query 캐시를 공유한다.
import { useQuery } from '@tanstack/react-query'
import { getMyScans } from './api'

export const MY_SCANS_QUERY_KEY = ['scans', 'my'] as const

export function useMyScansQuery(options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: MY_SCANS_QUERY_KEY,
    queryFn: getMyScans,
    enabled: options?.enabled,
  })
}
