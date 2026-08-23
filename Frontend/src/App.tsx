import { RootLayout } from '@/components/layout/RootLayout.tsx'
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
                <Route path="/mypage" element={<MyPage />} />
                <Route path="/process" element={<ProcessGuidePage />} />
                <Route path="/scan/hand" element={<HandScanPage />} />
                <Route path="/scan/result" element={<HandScanResultPage />} />
                <Route path="/print" element={<PrintPage />} />
                <Route path="/preview/print" element={<PrintPagePreview />} />
                <Route path="/preview/scan-result" element={<HandScanResultPagePreview />} />
                <Route path="/design/preferences" element={<NailDesignPreferencePage />} />
                <Route path="/design/chat" element={<NailDesignChatPage />} />
                <Route path="/design/result" element={<NailDesignResultPage />} />
                <Route path="*" element={<Navigate to="/" replace />} />
            </Route>
        </Routes>
    )
}

export default App