import { useState } from 'react'
import { useNavigationType } from 'react-router-dom'

/**
 * 모듈 스코프 스냅샷을, 브라우저의 "뒤로가기/앞으로가기" 버튼(POP)으로 돌아온 경우에만
 * 복원해서 쓰도록 게이트한다. 앱 안의 링크/버튼으로 들어온 경우(PUSH/REPLACE)엔 항상
 * 새로 시작한 것으로 보고 이전 스냅샷은 버린다(clearSnapshot 호출).
 *
 * 컴포넌트 최상단에서, 다른 useState들이 이 값을 초기값으로 쓰기 전에 호출해야 한다.
 */
export function useSnapshotRestore<T>(snapshot: T | null, clearSnapshot: () => void): T | null {
  const navigationType = useNavigationType()
  const [restored] = useState<T | null>(() => {
    if (navigationType === 'POP' && snapshot) return snapshot
    clearSnapshot()
    return null
  })
  return restored
}
