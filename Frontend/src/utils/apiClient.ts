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

// ─── 핵심 fetch 래퍼 ──────────────────────────────────────────────────────────
async function request<T>(
    path: string,
    options: RequestInit = {},
    requireAuth = true,
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

    // 401 → 토큰 만료, 자동 로그아웃
    if (res.status === 401) {
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
    get<T>(path: string, requireAuth = true) {
        return request<T>(path, { method: 'GET' }, requireAuth)
    },

    post<T>(path: string, body?: unknown, requireAuth = true) {
        return request<T>(
            path,
            { method: 'POST', body: body !== undefined ? JSON.stringify(body) : undefined },
            requireAuth,
        )
    },

    patch<T>(path: string, body?: unknown, requireAuth = true) {
        return request<T>(
            path,
            { method: 'PATCH', body: body !== undefined ? JSON.stringify(body) : undefined },
            requireAuth,
        )
    },

    delete<T>(path: string, body?: unknown, requireAuth = true) {
        return request<T>(
            path,
            { method: 'DELETE', body: body !== undefined ? JSON.stringify(body) : undefined },
            requireAuth,
        )
    },

    // multipart/form-data (파일 업로드용 — Content-Type 헤더 직접 지정 안 함)
    upload<T>(path: string, formData: FormData, requireAuth = true) {
        const headers: Record<string, string> = {}
        if (requireAuth) {
            const token = getToken()
            if (token) headers['Authorization'] = `Bearer ${token}`
        }
        return request<T>(path, { method: 'POST', body: formData, headers }, requireAuth)
    },
}