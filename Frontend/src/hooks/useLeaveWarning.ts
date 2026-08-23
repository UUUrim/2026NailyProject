import { useEffect, useRef } from 'react'
import { registerChatSessionGuard } from '@/utils/chatSessionGuard'

/**
 * 뒤로가기(popstate)는 그대로 허용해서 각 페이지의 모듈 스코프 스냅샷 복원이 자연스럽게
 * 동작하게 두고, 그 외 방식(새로고침·탭 닫기·헤더 내비게이션 등)으로 페이지를 벗어나려 할
 * 때만 경고 문구를 띄운다. 사용자가 그래도 나가기로 하면 onConfirmLeave로 화면 내용을
 * 초기화한다(실제 서버에 저장된 데이터는 건드리지 않음 — 마이페이지 이력에는 그대로 남는다).
 *
 * - beforeunload: 새로고침/탭 닫기 → 브라우저 기본 확인창(커스텀 문구는 정책상 표시 안 됨)
 * - registerChatSessionGuard: 헤더/AuthNav의 앱 내부 네비게이션 → 커스텀 확인창(message)
 */
export function useLeaveWarning(active: boolean, message: string, onConfirmLeave: () => void) {
  const onConfirmLeaveRef = useRef(onConfirmLeave)
  onConfirmLeaveRef.current = onConfirmLeave

  useEffect(() => {
    if (!active) return

    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault()
      e.returnValue = ''
    }
    window.addEventListener('beforeunload', handleBeforeUnload)

    registerChatSessionGuard(() => {
      const confirmed = window.confirm(message)
      if (confirmed) onConfirmLeaveRef.current()
      return confirmed
    })

    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload)
      registerChatSessionGuard(null)
    }
  }, [active, message])
}
