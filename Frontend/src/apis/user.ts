import { apiClient } from '@/utils/apiClient'
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

// ─── 로그인 ───────────────────────────────────────────────────────────────────

/** POST /users/email/login — 로그인 후 토큰 자동 저장 */
export async function login(email: string, password: string): Promise<LoginResponse> {
    const res = await apiClient.post<LoginResponse>(
        '/users/email/login',
        { email, password },
        false,
    )
    setToken(res.data.token) // 토큰 저장
    return res.data
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
    await apiClient.patch('/users/me/password', { currentPassword, newPassword })
}