// 채팅 페이지가 "지금 진행 중인 세션이 있는지"를 등록해두고,
// Header 같은 다른 컴포넌트의 네비게이션 클릭이 이걸 확인해서
// 필요하면 확인창을 띄우는 용도의 아주 가벼운 전역 가드.
//
// React Context를 안 쓰는 이유: Header는 리렌더 될 필요 없이
// "클릭하는 순간의 최신 상태"만 읽으면 되기 때문에, 그냥
// 모듈 스코프 변수로 충분하다.

type Guard = () => boolean // true를 반환하면 이동 진행, false면 이동 취소

let currentGuard: Guard | null = null

/** 채팅 페이지에서 마운트/상태 변경 시 호출. 언마운트 시 반드시 null로 해제할 것. */
export function registerChatSessionGuard(guard: Guard | null) {
    currentGuard = guard
}

// 디자인 채팅에서 디자인을 만드는 중에 다른 채팅으로 옮겨, 화면에서만 숨긴 채 계속 만드는 채팅들의 가드.
// 채팅 화면 안에서 채팅을 바꿀 때는 그대로 계속 만들어지므로 묻지 않고, 페이지를 떠나는 이동에만 묻는다.
const backgroundGuards = new Map<string, Guard>()

/** 화면에 안 보이는 채팅이 디자인을 만드는 동안 등록하고, 다 만들었거나 언마운트되면 null로 해제한다. */
export function registerBackgroundChatGuard(id: string, guard: Guard | null) {
    if (guard) backgroundGuards.set(id, guard)
    else backgroundGuards.delete(id)
}

/** 페이지를 떠나는 네비게이션 직전에 호출 (헤더·사이드바 이동 등). 가드가 없으면 그냥 통과. */
export function confirmLeaveChatIfNeeded(): boolean {
    if (currentGuard) return currentGuard()
    // 화면의 채팅은 바쁘지 않아도, 숨긴 채 디자인을 만드는 채팅이 있으면 떠나기 전에 한 번 묻는다
    const backgroundGuard = backgroundGuards.values().next().value
    return backgroundGuard ? backgroundGuard() : true
}

/** 디자인 채팅 화면 안에서 다른 채팅으로 옮기기 직전에 호출 — 화면에 떠 있는 채팅의 가드만 본다. */
export function confirmLeaveCurrentChatIfNeeded(): boolean {
    if (!currentGuard) return true
    return currentGuard()
}

// 우리 커스텀 확인창(confirmLeaveChatIfNeeded)으로 이미 동의를 받은 뒤,
// window.location.href 같은 실제 브라우저 이동을 강제로 일으켜야 할 때가 있다
// (예: 같은 경로로 "새로고침"해서 세션을 초기화하는 경우). 이런 경우 브라우저의
// beforeunload 확인창이 중복으로 한 번 더 뜨는 걸 막기 위한 플래그.
let bypassNextBeforeUnload = false

/** 방금 사용자에게 이미 확인을 받았으니, 곧 일어날 실제 페이지 이탈에서 beforeunload 확인창을 건너뛰라고 표시. */
export function markIntentionalNavigation() {
    bypassNextBeforeUnload = true
}

/** beforeunload 핸들러 쪽에서 확인. 한 번 확인하면 자동으로 리셋된다(1회성). */
export function shouldBypassBeforeUnload(): boolean {
    if (!bypassNextBeforeUnload) return false
    // 같은 이탈에 beforeunload 리스너가 여럿일 수 있어서(화면의 채팅 + 숨긴 채 디자인을 만드는 채팅)
    // 이번 이벤트를 다 돌고 난 뒤에 리셋한다 — 바로 리셋하면 두 번째 리스너가 브라우저 확인창을 또 띄운다
    window.setTimeout(() => {
        bypassNextBeforeUnload = false
    }, 0)
    return true
}