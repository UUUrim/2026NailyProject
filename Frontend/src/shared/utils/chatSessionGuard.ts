// 페이지가 "지금 떠나면 사라지는 작업이 있는지"를 등록해두고(useLeaveWarning),
// Header 같은 다른 컴포넌트의 네비게이션 클릭이 이걸 확인해서
// 필요하면 확인창을 띄우는 용도의 아주 가벼운 전역 가드.
// (디자인 채팅은 쓰지 않는다 — 답변·디자인을 기다리는 채팅은 다른 페이지로 옮겨도 숨겨 둔 채 계속 진행된다)
//
// React Context를 안 쓰는 이유: Header는 리렌더 될 필요 없이
// "클릭하는 순간의 최신 상태"만 읽으면 되기 때문에, 그냥
// 모듈 스코프 변수로 충분하다.

type Guard = () => boolean // true를 반환하면 이동 진행, false면 이동 취소

let currentGuard: Guard | null = null

/** 페이지에서 마운트/상태 변경 시 호출. 언마운트 시 반드시 null로 해제할 것. */
export function registerChatSessionGuard(guard: Guard | null) {
    currentGuard = guard
}

/** 페이지를 떠나는 네비게이션 직전에 호출 (헤더 이동 등). 가드가 없으면 그냥 통과. */
export function confirmLeaveChatIfNeeded(): boolean {
    if (!currentGuard) return true
    return currentGuard()
}
