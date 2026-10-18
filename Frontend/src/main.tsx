import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { QueryClientProvider } from '@tanstack/react-query'
import { ScrollToTop } from '@/shared/layout/ScrollToTop'
import { queryClient } from '@/shared/utils/queryClient'
import './index.css'
import App from './App.tsx'
// App 다음에 불러와야 한다 — 이 안에서 디자인 채팅이 페이지 CSS(mypage.css 등)까지 끌어오는데, App보다 먼저 불러오면
// 그 CSS가 공통 레이아웃(root-layout.css)보다 앞에 붙어 같은 우선순위의 규칙이 뒤집힌다
// (예: 마이페이지 폭 .mypage-x-page 1280px가 .root-layout__page 1120px에 덮여 좁아졌다)
import { DesignChatHost } from '@/features/nail-design/components/DesignChatHost'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <ScrollToTop />
        <App />
        {/* 디자인 채팅의 채팅들은 페이지 밖에서 그린다 — 채팅 화면을 떠나도 답변·디자인을 기다리던 채팅이 계속 진행된다 */}
        <DesignChatHost />
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
)
