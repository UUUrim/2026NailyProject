import { useLocation } from 'react-router-dom'
import { NailDesignChatPageContent } from '@/features/nail-design/components/NailDesignChatPageContent'

export function NailDesignChatPage() {
    // 채팅 화면으로 들어올 때마다 새로 마운트한다 — 채팅 화면에서 헤더의 design을 다시 눌러도 새 채팅으로 시작한다
    // (만들고 있던 디자인은 숨겨 둔 채 계속 진행된다)
    const location = useLocation()
    return <NailDesignChatPageContent key={location.key} />
}
