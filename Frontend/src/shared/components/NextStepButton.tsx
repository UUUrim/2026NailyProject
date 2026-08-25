import '@/styles/next-step-button.css'

type NextStepButtonProps = {
  label: string
  onClick?: () => void
  disabled?: boolean
  className?: string
}

// "네일팁 출력하러 가기", "손 촬영하러 가기"처럼, 다음 단계로 넘어가는 걸 유도하는
// 텍스트 + 화살표 스타일의 공용 버튼. 배경 없이 핑크 텍스트만 있다가 호버하면
// 화살표가 오른쪽으로 살짝 밀려나는 연출이 여러 화면에서 반복돼서 하나로 뺐다.
export function NextStepButton({ label, onClick, disabled, className }: NextStepButtonProps) {
  return (
    <button
      type="button"
      className={`next-step-button${className ? ` ${className}` : ''}`}
      onClick={onClick}
      disabled={disabled}
    >
      {label}
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path
          d="M5 12h12M13 6l6 6-6 6"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </button>
  )
}
