export const AUTH_STORAGE_KEY = 'naily_is_logged_in'

export function isLoggedIn(): boolean {
  if (typeof window === 'undefined') {
    return false
  }
  return window.localStorage.getItem(AUTH_STORAGE_KEY) === 'true'
}

export function setLoggedIn(value: boolean): void {
  if (typeof window === 'undefined') {
    return
  }
  window.localStorage.setItem(AUTH_STORAGE_KEY, value ? 'true' : 'false')
}
