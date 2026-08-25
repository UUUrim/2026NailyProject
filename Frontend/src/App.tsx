import { lazy, Suspense, type ReactNode } from 'react'
import { RootLayout } from '@/shared/layout/RootLayout.tsx'
import { ProtectedRoute } from '@/features/auth/components/ProtectedRoute'
import { HomePage } from '@/pages/HomePage'
import { HandScanPage } from '@/pages/HandScanPage'
import { HandScanResultPage } from '@/pages/HandScanResultPage'
import { LoginPage } from '@/pages/LoginPage'
import { MyPage } from '@/pages/MyPage'
import { NailDesignPreferencePage } from '@/pages/NailDesignPreferencePage'
import { NailDesignChatPage } from '@/pages/NailDesignChatPage'
import { NailDesignResultPage } from '@/pages/NailDesignResultPage'
import { PrintPage } from '@/pages/PrintPage'
import { PrintPagePreview } from '@/pages/PrintPagePreview'
import { HandScanResultPagePreview } from '@/pages/HandScanResultPagePreview'
import { ProcessGuidePage } from '@/pages/ProcessGuidePage'
import { SignupEmailPage } from '@/pages/SignupEmailPage'
import { SignupGooglePage } from '@/pages/SignupGooglePage'
import { SignupLandingPage } from '@/pages/SignupLandingPage'
import { SignupNaverPage } from '@/pages/SignupNaverPage'
import { Navigate, Route, Routes } from 'react-router-dom'
import {OAuthSuccessPage} from "@/pages/OAuthSuccessPage.tsx"   //소셜 로그인 추가

// 마이페이지 탭은 클릭해서 열 때만 필요한 코드라 React.lazy로 쪼개서, 방문 시점에만 불러온다.
const DashboardTab = lazy(() => import('@/features/mypage/tabs/DashboardTab').then((m) => ({ default: m.DashboardTab })))
const ProfileTab = lazy(() => import('@/features/mypage/tabs/ProfileTab').then((m) => ({ default: m.ProfileTab })))
const TimelineTab = lazy(() => import('@/features/mypage/tabs/TimelineTab').then((m) => ({ default: m.TimelineTab })))
const ScansTab = lazy(() => import('@/features/mypage/tabs/ScansTab').then((m) => ({ default: m.ScansTab })))
const PrintsTab = lazy(() => import('@/features/mypage/tabs/PrintsTab').then((m) => ({ default: m.PrintsTab })))
const DesignsTab = lazy(() => import('@/features/mypage/tabs/DesignsTab').then((m) => ({ default: m.DesignsTab })))
const FavoritesTab = lazy(() => import('@/features/mypage/tabs/FavoritesTab').then((m) => ({ default: m.FavoritesTab })))

function tab(el: ReactNode) {
    return <Suspense fallback={<p className="mypage-x__loading">불러오는 중...</p>}>{el}</Suspense>
}

function App() {
    return (
        <Routes>
            <Route path="/" element={<HomePage />} />

            <Route path="/signup" element={<SignupLandingPage />} />
            <Route path="/signup/email" element={<SignupEmailPage />} />
            <Route path="/signup/google" element={<SignupGooglePage />} />
            <Route path="/signup/naver" element={<SignupNaverPage />} />
            <Route path="/oauth/success" element={<OAuthSuccessPage />} />  {/* 소셜 로그인 추가 */}
            <Route path="/oauth/callback" element={<OAuthSuccessPage />} />  {/* 백엔드 리다이렉트 경로 대응 */}

            <Route element={<RootLayout />}>
                <Route path="/login" element={<LoginPage />} />
                <Route path="/mypage" element={<MyPage />}>
                    <Route index element={<Navigate to="/mypage/dashboard" replace />} />
                    <Route path="dashboard" element={tab(<DashboardTab />)} />
                    <Route path="profile" element={tab(<ProfileTab />)} />
                    <Route path="timeline" element={tab(<TimelineTab />)} />
                    <Route path="scans" element={tab(<ScansTab />)} />
                    <Route path="prints" element={tab(<PrintsTab />)} />
                    <Route path="designs" element={tab(<DesignsTab />)} />
                    <Route path="favorites" element={tab(<FavoritesTab />)} />
                </Route>
                <Route path="/process" element={<ProcessGuidePage />} />
                <Route path="/preview/print" element={<PrintPagePreview />} />
                <Route path="/preview/scan-result" element={<HandScanResultPagePreview />} />

                {/* 로그인이 필요한 라우트 — 스캔/출력/디자인 생성 흐름 */}
                <Route element={<ProtectedRoute />}>
                    <Route path="/scan/hand" element={<HandScanPage />} />
                    <Route path="/scan/result" element={<HandScanResultPage />} />
                    <Route path="/print" element={<PrintPage />} />
                    <Route path="/design/preferences" element={<NailDesignPreferencePage />} />
                    <Route path="/design/chat" element={<NailDesignChatPage />} />
                    <Route path="/design/result" element={<NailDesignResultPage />} />
                </Route>

                <Route path="*" element={<Navigate to="/" replace />} />
            </Route>
        </Routes>
    )
}

export default App