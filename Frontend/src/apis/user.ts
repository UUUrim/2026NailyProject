import { apiClient, ApiError } from '@/utils/apiClient'
import { setToken } from '@/utils/auth'

// ─── 응답 타입 (LoginResponseDto, SignupResponseDto, UserProfileResponseDto) ──
export interface LoginResponse {
    userId: number
    email: string
    nickname: string
    token: string
}

export interface SignupResponse {
    userId: number
    email: string
    nickname: string
}

export interface SocialSignupParams {   /** 소셜 로그인 추가 **/
    signupToken: string
    password: string
    name: string
    nickname: string
}

export interface UserProfileResponse {
    userId: number
    email: string
    name: string
    nickname: string
    provider: string
    createdAt: string
}

// ─── 이메일 인증 ──────────────────────────────────────────────────────────────

/** POST /users/email/send — 인증코드 발송 */
export async function sendVerificationCode(email: string): Promise<void> {
    await apiClient.post(
        `/users/email/send?email=${encodeURIComponent(email)}`,
        undefined,
        false, // 인증 불필요
    )
}

/** POST /users/email/verify — 인증코드 검증 */
export async function verifyEmailCode(email: string, code: string): Promise<void> {
    await apiClient.post(
        `/users/email/verify?email=${encodeURIComponent(email)}&code=${encodeURIComponent(code)}`,
        undefined,
        false,
    )
}

// ─── 회원가입 ─────────────────────────────────────────────────────────────────

/** POST /users/signup */
export async function signup(params: {
    email: string
    password: string
    name: string
    nickname: string
}): Promise<SignupResponse> {
    const res = await apiClient.post<SignupResponse>('/users/signup', params, false)
    return res.data
}

export function getSocialAuthUrl(provider: 'google' | 'naver'): string {    /** 소셜 로그인 추가 **/
    const base = import.meta.env.VITE_API_BASE_URL ?? ''
    return `${base}/oauth2/authorization/${provider}`   /** 경로 수정 **/
}

/** POST /users/social/signup — 소셜 가입 + 자동 로그인(토큰 저장) */
export async function socialSignup(params: SocialSignupParams): Promise<LoginResponse> {    /** 소셜 로그인 추가 **/
    const res = await apiClient.post<LoginResponse>('/users/social/signup', params, false)
    setToken(res.data.token)
    return res.data
}

// ─── 로그인 ───────────────────────────────────────────────────────────────────

/** POST /users/email/login — 로그인 후 토큰 자동 저장 */
export async function login(email: string, password: string): Promise<LoginResponse> {
    // onUnauthorized: 'throw' — 아직 로그인 전이라 지울 토큰도 없지만, 비밀번호가 틀렸을 때
    // 401을 "세션 만료"로 오인해 리다이렉트하지 않고 일반 에러로 던져서 화면에서 처리하게 한다.
    const res = await apiClient.post<LoginResponse>(
        '/users/email/login',
        { email, password },
        false,
        'throw',
    )
    setToken(res.data.token) // 토큰 저장
    return res.data
}

/**
 * 현재 비밀번호가 맞는지 확인한다. 전용 검증 엔드포인트가 따로 없어서, 같은 자격증명으로
 * 다시 로그인해보는 방식으로 확인한다(성공하면 토큰도 최신으로 갱신됨 — 무해한 부수효과).
 * 비밀번호가 틀리면 false, 그 외 네트워크 오류 등은 그대로 다시 던진다.
 */
export async function verifyCurrentPassword(email: string, password: string): Promise<boolean> {
    try {
        await login(email, password)
        return true
    } catch (e) {
        if (e instanceof ApiError && e.status === 401) return false
        throw e
    }
}

// ─── 프로필 ───────────────────────────────────────────────────────────────────

/** GET /users/me */
export async function getMyProfile(): Promise<UserProfileResponse> {
    const res = await apiClient.get<UserProfileResponse>('/users/me')
    return res.data
}

/** PATCH /users/me — 닉네임 수정 */
export async function updateNickname(nickname: string): Promise<UserProfileResponse> {
    const res = await apiClient.patch<UserProfileResponse>('/users/me', { nickname })
    return res.data
}

/** PATCH /users/me/password — 비밀번호 수정 */
export async function updatePassword(
    currentPassword: string,
    newPassword: string,
): Promise<void> {
    // onUnauthorized: 'throw' — 현재 비밀번호가 틀려 401이 와도 로그아웃시키지 않고
    // 일반 에러로 던져서 "비밀번호가 틀렸습니다" 같은 안내를 보여줄 수 있게 한다.
    await apiClient.patch('/users/me/password', { currentPassword, newPassword }, true, 'throw')
}