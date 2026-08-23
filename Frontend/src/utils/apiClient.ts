// import { getToken, clearToken } from '@/utils/auth'
//
// const BASE_URL = 'http://100.48.79.172:8080'
//
// // ─── 백엔드 ApiResponse<T> 구조 ───────────────────────────────────────────────
// export interface ApiResponse<T> {
//     ok: boolean
//     status: number
//     message: string
//     data: T
// }
//
// // ─── 공통 에러 클래스 ─────────────────────────────────────────────────────────
// export class ApiError extends Error {
//     status: number
//
//     constructor(status: number, message: string) {
//         super(message)
//         this.name = 'ApiError'
//         this.status = status
//     }
// }
//
// // ─── 핵심 fetch 래퍼 ──────────────────────────────────────────────────────────
// async function request<T>(
//     path: string,
//     options: RequestInit = {},
//     requireAuth = true,
// ): Promise<ApiResponse<T>> {
//     const headers: Record<string, string> = {
//         'Content-Type': 'application/json',
//         ...(options.headers as Record<string, string>),
//     }
//
//     if (requireAuth) {
//         const token = getToken()
//         if (token) {
//             headers['Authorization'] = `Bearer ${token}`
//         }
//     }
//
//     const res = await fetch(`${BASE_URL}${path}`, {
//         ...options,
//         headers,
//     })
//
//     // 401 → 토큰 만료, 자동 로그아웃
//     if (res.status === 401) {
//         clearToken()
//         window.location.href = '/login'
//         throw new ApiError(401, '로그인이 필요합니다.')
//     }
//
//     const body = (await res.json()) as ApiResponse<T>
//
//     if (!body.ok) {
//         throw new ApiError(body.status, body.message)
//     }
//
//     return body
// }
//
// // ─── HTTP 메서드 헬퍼 ─────────────────────────────────────────────────────────
// export const apiClient = {
//     get<T>(path: string, requireAuth = true) {
//         return request<T>(path, { method: 'GET' }, requireAuth)
//     },
//
//     post<T>(path: string, body?: unknown, requireAuth = true) {
//         return request<T>(
//             path,
//             { method: 'POST', body: body !== undefined ? JSON.stringify(body) : undefined },
//             requireAuth,
//         )
//     },
//
//     patch<T>(path: string, body?: unknown, requireAuth = true) {
//         return request<T>(
//             path,
//             { method: 'PATCH', body: body !== undefined ? JSON.stringify(body) : undefined },
//             requireAuth,
//         )
//     },
//
//     delete<T>(path: string, body?: unknown, requireAuth = true) {
//         return request<T>(
//             path,
//             { method: 'DELETE', body: body !== undefined ? JSON.stringify(body) : undefined },
//             requireAuth,
//         )
//     },
//
//     // multipart/form-data (파일 업로드용 — Content-Type 헤더 직접 지정 안 함)
//     upload<T>(path: string, formData: FormData, requireAuth = true) {
//         const headers: Record<string, string> = {}
//         if (requireAuth) {
//             const token = getToken()
//             if (token) headers['Authorization'] = `Bearer ${token}`
//         }
//         return request<T>(path, { method: 'POST', body: formData, headers }, requireAuth)
//     },
// }

import { getToken, clearToken } from '@/utils/auth'

export const BASE_URL = ''
// export const BASE_URL = 'http://100.48.79.172:8080'
// export const BASE_URL='http://nailyweb.duckdns.org:8080'

// ─── 백엔드 ApiResponse<T> 구조 ───────────────────────────────────────────────
export interface ApiResponse<T> {
    ok: boolean
    status: number
    message: string
    data: T
}

// ─── 공통 에러 클래스 ─────────────────────────────────────────────────────────
export class ApiError extends Error {
    status: number

    constructor(status: number, message: string) {
        super(message)
        this.name = 'ApiError'
        this.status = status
    }
}

// 401 응답을 항상 "세션 만료"로 취급해 강제 로그아웃시키면, 로그인/현재 비밀번호 확인처럼
// "네가 방금 입력한 값이 틀렸다"는 의미로 401을 쓰는 엔드포인트에서도 똑같이 토큰을 지우고
// /login으로 강제 리다이렉트해버려서, 정작 "비밀번호가 틀렸습니다" 같은 안내를 보여줄 기회조차
// 없이 화면이 튕겨버리는 문제가 있었다. 그런 호출은 onUnauthorized: 'throw'로 넘기면, 401도
// 다른 에러와 동일하게 body를 파싱해서 일반 ApiError로 던지기만 하고 로그아웃/리다이렉트는 하지 않는다.
type UnauthorizedBehavior = 'logout' | 'throw'

// ─── 핵심 fetch 래퍼 ──────────────────────────────────────────────────────────
async function request<T>(
    path: string,
    options: RequestInit = {},
    requireAuth = true,
    onUnauthorized: UnauthorizedBehavior = 'logout',
): Promise<ApiResponse<T>> {
    const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        ...(options.headers as Record<string, string>),
    }

    if (requireAuth) {
        const token = getToken()
        if (token) {
            headers['Authorization'] = `Bearer ${token}`
        }
    }

    const res = await fetch(`${BASE_URL}${path}`, {
        ...options,
        headers,
    })

    // 401 → 토큰 만료, 자동 로그아웃 (단, onUnauthorized: 'throw'인 호출은 제외)
    if (res.status === 401 && onUnauthorized === 'logout') {
        clearToken()
        window.location.href = '/login'
        throw new ApiError(401, '로그인이 필요합니다.')
    }

    const body = (await res.json()) as ApiResponse<T>

    if (!body.ok) {
        throw new ApiError(body.status, body.message)
    }

    return body
}

// ─── HTTP 메서드 헬퍼 ─────────────────────────────────────────────────────────
export const apiClient = {
    get<T>(path: string, requireAuth = true, onUnauthorized: UnauthorizedBehavior = 'logout') {
        return request<T>(path, { method: 'GET' }, requireAuth, onUnauthorized)
    },

    post<T>(path: string, body?: unknown, requireAuth = true, onUnauthorized: UnauthorizedBehavior = 'logout') {
        return request<T>(
            path,
            { method: 'POST', body: body !== undefined ? JSON.stringify(body) : undefined },
            requireAuth,
            onUnauthorized,
        )
    },

    patch<T>(path: string, body?: unknown, requireAuth = true, onUnauthorized: UnauthorizedBehavior = 'logout') {
        return request<T>(
            path,
            { method: 'PATCH', body: body !== undefined ? JSON.stringify(body) : undefined },
            requireAuth,
            onUnauthorized,
        )
    },

    delete<T>(path: string, body?: unknown, requireAuth = true, onUnauthorized: UnauthorizedBehavior = 'logout') {
        return request<T>(
            path,
            { method: 'DELETE', body: body !== undefined ? JSON.stringify(body) : undefined },
            requireAuth,
            onUnauthorized,
        )
    },

    // multipart/form-data (파일 업로드용 — Content-Type 헤더 직접 지정 안 함)
    upload<T>(path: string, formData: FormData, requireAuth = true, onUnauthorized: UnauthorizedBehavior = 'logout') {
        const headers: Record<string, string> = {}
        if (requireAuth) {
            const token = getToken()
            if (token) headers['Authorization'] = `Bearer ${token}`
        }
        return request<T>(path, { method: 'POST', body: formData, headers }, requireAuth, onUnauthorized)
    },
}