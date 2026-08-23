/** 디자인 이미지 모달 액션 버튼용 아이콘 (아이콘 → 라벨 순서) */
export const ModalActionIcons = {
  ar: (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M4 8V6a2 2 0 0 1 2-2h2M16 4h2a2 2 0 0 1 2 2v2M20 16v2a2 2 0 0 1-2 2h-2M8 20H6a2 2 0 0 1-2-2v-2"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
      />
      <path
        d="M9 15.5V9.2L12 8l3 1.2v6.3M9 12.2h6"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  ),
  download: (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M12 4v10m0 0 3.5-3.5M12 14 8.5 10.5M6 18h12"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  ),
  share: (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="18" cy="5" r="2.4" stroke="currentColor" strokeWidth="1.7" />
      <circle cx="6" cy="12" r="2.4" stroke="currentColor" strokeWidth="1.7" />
      <circle cx="18" cy="19" r="2.4" stroke="currentColor" strokeWidth="1.7" />
      <path d="m8.2 10.8 7.5-4.1M8.2 13.2l7.5 4.1" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
    </svg>
  ),
  trash: (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M4.5 7h15" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
      <path
        d="M10 7V5.5A1.5 1.5 0 0 1 11.5 4h1A1.5 1.5 0 0 1 14 5.5V7"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M6.5 7v11.5a2 2 0 0 0 2 2h7a2 2 0 0 0 2-2V7"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path d="M10 11v5.5M14 11v5.5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
    </svg>
  ),
  like: (filled = false) => (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M7 11v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-8a1 1 0 0 1 1-1h2a2 2 0 0 1 1.6.8L14 4.5A2.5 2.5 0 0 1 18 6.3V10h2.2a1.8 1.8 0 0 1 1.76 2.2l-1.3 6A2 2 0 0 1 18.7 20H9.5"
        fill={filled ? 'currentColor' : 'none'}
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
    </svg>
  ),
  details: (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect x="4" y="4" width="16" height="16" rx="3" stroke="currentColor" strokeWidth="1.7" />
      <path d="M8 9h8M8 12.5h8M8 16h5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
    </svg>
  ),
  /* 겹친 말풍선 손그림 스타일 — 배경 없이 선만 흰색. 뒤쪽(아래) 말풍선은 앞쪽에 가려지는
     구간을 실제로 그리지 않는 열린 선으로 그려서, 배경이 투명해도 선이 서로 뚫고 지나가
     보이지 않게 한다(참고 손그림처럼 앞쪽 말풍선 하나만 깨끗하게 위에 겹쳐 보이도록). */
  chat: (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M11.6 15 L8.5 15 4 18.5 6.5 15 H5.4 A2.4 2.4 0 0 1 3 12.6 V8.4 A2.4 2.4 0 0 1 5.4 6 H9.3"
        fill="none"
        stroke="#fff"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M11.4 3 H18.6 A2.4 2.4 0 0 1 21 5.4 V9.6 A2.4 2.4 0 0 1 18.6 12 H16.5 L19 15.5 13.5 12 H11.4 A2.4 2.4 0 0 1 9 9.6 V5.4 A2.4 2.4 0 0 1 11.4 3 Z"
        fill="none"
        stroke="#fff"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="12.5" cy="7.5" r="0.9" fill="#fff" />
      <circle cx="15" cy="7.5" r="0.9" fill="#fff" />
      <circle cx="17.5" cy="7.5" r="0.9" fill="#fff" />
    </svg>
  ),
  image: (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect x="4" y="4" width="16" height="16" rx="3" stroke="currentColor" strokeWidth="1.7" />
      <path d="m8 14 2.5-3 2 2L16 9l2 2.5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="9" cy="9" r="1.1" fill="currentColor" />
    </svg>
  ),
}
