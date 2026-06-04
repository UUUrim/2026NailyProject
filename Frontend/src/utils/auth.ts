
// ─── 스토리지 키 & 이벤트 ────────────────────────────────────────────────────
export const AUTH_TOKEN_KEY = 'token'
export const AUTH_CHANGE_EVENT = 'naily-auth-change'

// ─── 내부 헬퍼: JWT payload 디코딩 ───────────────────────────────────────────
function decodeJwtPayload(token: string): Record<string, unknown> | null {
  try {
    const base64Url = token.split('.')[1]
    if (!base64Url) return null
    const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/')
    const jsonPayload = decodeURIComponent(
        atob(base64)
            .split('')
            .map((c) => '%' + c.charCodeAt(0).toString(16).padStart(2, '0'))
            .join(''),
    )
    return JSON.parse(jsonPayload) as Record<string, unknown>
  } catch {
    return null
  }
}

// ─── 토큰 만료 여부 확인 ──────────────────────────────────────────────────────
function isTokenExpired(token: string): boolean {
  const payload = decodeJwtPayload(token)
  if (!payload || typeof payload.exp !== 'number') return true
  // exp는 초 단위, Date.now()는 밀리초 단위
  return payload.exp * 1000 < Date.now()
}

// ─── Public API ───────────────────────────────────────────────────────────────

/** 저장된 JWT 토큰 반환. 없거나 만료됐으면 null */
export function getToken(): string | null {
  if (typeof window === 'undefined') return null
  const token = window.localStorage.getItem(AUTH_TOKEN_KEY)
  if (!token) return null
  if (isTokenExpired(token)) {
    clearToken() // 만료 토큰 자동 정리
    return null
  }
  return token
}

/** 로그인 여부 (토큰 존재 + 만료 여부 동시 체크) */
export function isLoggedIn(): boolean {
  return getToken() !== null
}

/** 로그인 성공 후 토큰 저장 */
export function setToken(token: string): void {
  if (typeof window === 'undefined') return
  window.localStorage.setItem(AUTH_TOKEN_KEY, token)
  window.dispatchEvent(new Event(AUTH_CHANGE_EVENT))
}

/** 로그아웃 시 토큰 제거 */
export function clearToken(): void {
  if (typeof window === 'undefined') return
  window.localStorage.removeItem(AUTH_TOKEN_KEY)
  window.dispatchEvent(new Event(AUTH_CHANGE_EVENT))
}