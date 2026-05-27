import { HomePage } from '@/pages/HomePage'
import { LoginPage } from '@/pages/LoginPage'
import { NailDesignPreferencePage } from '@/pages/NailDesignPreferencePage'
import { NailDesignResultPage } from '@/pages/NailDesignResultPage'
import { ProcessGuidePage } from '@/pages/ProcessGuidePage'
import { SignupEmailPage } from '@/pages/SignupEmailPage'
import { SignupGooglePage } from '@/pages/SignupGooglePage'
import { SignupLandingPage } from '@/pages/SignupLandingPage'
import { SignupNaverPage } from '@/pages/SignupNaverPage'
import { Navigate, Route, Routes } from 'react-router-dom'

function App() {
  return (
    <Routes>
      <Route path="/" element={<HomePage />} />
      <Route path="/login" element={<LoginPage />} />
      <Route path="/process" element={<ProcessGuidePage />} />
      <Route path="/design/preferences" element={<NailDesignPreferencePage />} />
      <Route path="/design/result" element={<NailDesignResultPage />} />
      <Route path="/signup" element={<SignupLandingPage />} />
      <Route path="/signup/email" element={<SignupEmailPage />} />
      <Route path="/signup/google" element={<SignupGooglePage />} />
      <Route path="/signup/naver" element={<SignupNaverPage />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}

export default App
