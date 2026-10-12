import { useEffect, useRef, useState, type ReactElement, type ReactNode } from 'react'
import { StoryFeature } from '@/features/home/components/story/StoryFeature'
import { ShowcaseImage } from '@/features/home/components/story/ShowcaseImage'
import { DESIGN_DEMO, STORY_STEPS } from '@/features/home/constants/home'
import { useStepLoop } from '@/features/home/hooks/useStepLoop'

const LOGO = '/images/logo.png'

// i+1단계가 시작되는 시각(ms), 마지막 값은 한 바퀴 길이
// 0 방식 선택 창(커서가 다가감) → 1 '채팅으로 자유롭게' 클릭 → 2 입력 칸 활성 → 3 타이핑 → 4 전송 → 5 '…' → 6 생성 중 → 7 완성
const CHAT_TIMELINE = [1500, 2300, 2800, 5700, 6400, 7300, 8600, 13000]

const TYPE_MS_PER_CHAR = 80

// 실제 채팅 화면(NailDesignChatPageContent)의 4가지 생성 방식 선택 창과 같은 아이콘·제목
const MENU_ITEMS: { value: string; title: string; desc: string; icon: ReactElement }[] = [
  {
    value: 'preference',
    title: '선택지로 빠르게',
    desc: '준비된 선택지를 골라 순서대로 답하면 완성돼요.',
    icon: (
      <svg viewBox="0 0 24 24" fill="none">
        <path d="M8 6h11M8 12h11M8 18h11" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
        <path d="m4 5.3 1 1L6.5 4.5M4 11.3l1 1 1.5-1.8M4 17.3l1 1 1.5-1.8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    ),
  },
  {
    value: 'freeform',
    title: '채팅으로 자유롭게',
    desc: '원하는 느낌을 채팅으로 보내면 AI가 그대로 디자인해 줘요.',
    icon: (
      <svg viewBox="0 0 24 24" fill="none">
        <path
          d="M5.4 6 H11.6 A2.4 2.4 0 0 1 14 8.4 V12.6 A2.4 2.4 0 0 1 11.6 15 L8.5 15 4 18.5 6.5 15 H5.4 A2.4 2.4 0 0 1 3 12.6 V8.4 A2.4 2.4 0 0 1 5.4 6 Z"
          fill="#fdf5f8"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <path
          d="M11.4 3 H18.6 A2.4 2.4 0 0 1 21 5.4 V9.6 A2.4 2.4 0 0 1 18.6 12 H16.5 L19 15.5 13.5 12 H11.4 A2.4 2.4 0 0 1 9 9.6 V5.4 A2.4 2.4 0 0 1 11.4 3 Z"
          fill="#fdf5f8"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <circle cx="12.5" cy="7.5" r="0.9" fill="currentColor" />
        <circle cx="15" cy="7.5" r="0.9" fill="currentColor" />
        <circle cx="17.5" cy="7.5" r="0.9" fill="currentColor" />
      </svg>
    ),
  },
  {
    value: 'photo',
    title: '사진으로 참고',
    desc: '레퍼런스 사진을 올리면 그 느낌으로 만들어 줘요.',
    icon: (
      <svg viewBox="0 0 24 24" fill="none">
        <rect x="4" y="4" width="16" height="16" rx="3" stroke="currentColor" strokeWidth="1.6" />
        <path d="m8 14 2.5-3 2 2L16 9l2 2.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        <circle cx="9" cy="9" r="1.1" fill="currentColor" />
      </svg>
    ),
  },
  {
    value: 'scan-auto',
    title: '내 스캔 정보로 자동',
    desc: '손 분석 결과로 어울리는 디자인을 알아서 추천해요.',
    icon: (
      <svg viewBox="0 0 24 24" fill="none">
        <path
          d="M8 12.5V6a1.5 1.5 0 0 1 3 0v5M11 11V4.5a1.5 1.5 0 0 1 3 0V11M14 11.5V6a1.5 1.5 0 0 1 3 0v7c0 4-2.5 7-6.5 7C6.7 20 5 17 5 14.2v-2a1.4 1.4 0 0 1 2.8 0"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    ),
  },
]

/** 입력 칸에 한 글자씩 쳐지는 문장 — active인 동안만 늘어나고, 끝나면 비운다 */
function useTypewriter(text: string, active: boolean) {
  const [count, setCount] = useState(0)

  useEffect(() => {
    if (!active) return
    const timer = window.setInterval(() => setCount((prev) => Math.min(prev + 1, text.length)), TYPE_MS_PER_CHAR)
    return () => {
      window.clearInterval(timer)
      setCount(0)
    }
  }, [active, text])

  return text.slice(0, count)
}

/** 대화가 칸보다 길어지면 실제 채팅처럼 위로 밀어 올려 가장 최근 메시지가 보이게 한다 */
function useAutoScroll(step: number) {
  const bodyRef = useRef<HTMLDivElement>(null)
  const phaseRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const body = bodyRef.current
    const phase = phaseRef.current
    if (!body || !phase) return

    const update = () => {
      const style = getComputedStyle(body)
      const available = body.clientHeight - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom)
      const overflow = Math.max(0, phase.offsetHeight - available)
      phase.style.transform = overflow > 0 ? `translateY(${-overflow}px)` : ''
    }

    update()
    const observer = new ResizeObserver(update)
    observer.observe(body)
    observer.observe(phase)
    return () => observer.disconnect()
  }, [step])

  return { bodyRef, phaseRef }
}

/** 선택 창이 떠 있는 동안 커서를 '채팅으로 자유롭게' 카드 위에 놓는다 (카드 위치는 화면 크기에 따라 달라서 잰다) */
function useCursorTarget(active: boolean) {
  const windowRef = useRef<HTMLDivElement>(null)
  const targetRef = useRef<HTMLSpanElement>(null)
  const cursorRef = useRef<HTMLSpanElement>(null)

  useEffect(() => {
    const win = windowRef.current
    const target = targetRef.current
    const cursor = cursorRef.current
    if (!active || !win || !target || !cursor) return

    const place = () => {
      const w = win.getBoundingClientRect()
      const t = target.getBoundingClientRect()
      cursor.style.left = `${t.left - w.left + t.width * 0.62}px`
      cursor.style.top = `${t.top - w.top + t.height * 0.55}px`
    }

    place()
    const observer = new ResizeObserver(place)
    observer.observe(win)
    return () => observer.disconnect()
  }, [active])

  return { windowRef, targetRef, cursorRef }
}

/** 실제 채팅처럼 네일리 로고 프로필이 붙은 AI 쪽 줄 */
function AssistantRow({ children }: { children: ReactNode }) {
  return (
    <div className="chat-demo__row">
      <img src={LOGO} alt="" className="chat-demo__avatar" />
      {children}
    </div>
  )
}

const CheckIcon = (
  <svg viewBox="0 0 16 16" aria-hidden="true">
    <path d="m3.5 8.5 3 3 6-7" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
)

function DesignDemo({ playing }: { playing: boolean }) {
  const step = useStepLoop(CHAT_TIMELINE, playing)
  const typed = useTypewriter(DESIGN_DEMO.request, step === 3)
  const inChat = step >= 2
  const { bodyRef, phaseRef } = useAutoScroll(step)
  const { windowRef, targetRef, cursorRef } = useCursorTarget(!inChat)

  return (
    <div className="chat-demo">
      <div ref={windowRef} className="chat-demo__window">
        <div className="chat-demo__head">
          <img src={LOGO} alt="" className="chat-demo__avatar chat-demo__avatar--head" />
          <span className="chat-demo__name">
            <strong>NAILY AI</strong>
            <span>네일 디자인 도우미</span>
          </span>
        </div>

        <div ref={bodyRef} className="chat-demo__body">
          {!inChat ? (
            // 실제 채팅처럼 안내는 위에, 생성 방식 선택 창은 아래에 — 이때는 입력 칸이 없다
            <div ref={phaseRef} className="chat-demo__phase chat-demo__phase--menu" key="menu">
              <AssistantRow>
                <p className="chat-demo__bubble chat-demo__bubble--ai">원하시는 디자인 생성 방식을 선택해 주세요.</p>
              </AssistantRow>
              <div className="chat-demo__menu">
                {MENU_ITEMS.map((item) => {
                  const isTarget = item.value === 'freeform'
                  return (
                    <span
                      key={item.value}
                      ref={isTarget ? targetRef : undefined}
                      className={`chat-demo__menu-item${isTarget && step === 1 ? ' is-selected' : ''}`}
                    >
                      <span className="chat-demo__menu-icon">{item.icon}</span>
                      <span className="chat-demo__menu-title">{item.title}</span>
                      <span className="chat-demo__menu-desc">{item.desc}</span>
                      {isTarget && <span className="chat-demo__menu-check">{CheckIcon}</span>}
                    </span>
                  )
                })}
              </div>
            </div>
          ) : (
            <div ref={phaseRef} className="chat-demo__phase" key="chat">
              <AssistantRow>
                <p className="chat-demo__bubble chat-demo__bubble--ai">원하는 디자인을 자유롭게 입력해 주세요.</p>
              </AssistantRow>

              {step >= 4 && <p className="chat-demo__bubble chat-demo__bubble--user">{DESIGN_DEMO.request}</p>}

              {step === 5 && (
                <AssistantRow>
                  <span className="chat-demo__typing">
                    <i />
                    <i />
                    <i />
                  </span>
                </AssistantRow>
              )}

              {step >= 6 && (
                <AssistantRow>
                  <div className={`chat-demo__result${step >= 7 ? ' is-done' : ''}`}>
                    <div className="chat-demo__image">
                      <span className="chat-demo__generating">
                        <span className="chat-demo__spinner" />
                        디자인 생성 중
                      </span>
                      <ShowcaseImage src={DESIGN_DEMO.image} placeholder="" />
                    </div>
                    <p className="chat-demo__bubble chat-demo__bubble--ai">{DESIGN_DEMO.reply}</p>
                  </div>
                </AssistantRow>
              )}
            </div>
          )}
        </div>

        {inChat && (
          <div className={`chat-demo__input${step === 2 || step === 3 ? ' is-focused' : ''}`}>
            {step === 3 && typed ? (
              <span className="chat-demo__typed">
                <span className="chat-demo__typed-text">
                  {typed}
                  <i className="chat-demo__caret" />
                </span>
              </span>
            ) : (
              <span className="chat-demo__placeholder">
                {step === 2 && <i className="chat-demo__caret" />}
                원하는 디자인을 입력해 주세요
              </span>
            )}
            <span className={`chat-demo__send${step === 4 ? ' is-pressed' : ''}`}>
              <svg viewBox="0 0 24 24">
                <path d="M12 19V5M6 11l6-6 6 6" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </span>
          </div>
        )}

        {/* '채팅으로 자유롭게'로 다가가 클릭하는 커서 */}
        {!inChat && (
          <span ref={cursorRef} className={`chat-demo__cursor${step === 1 ? ' is-clicking' : ''}`}>
            <i className="chat-demo__ripple" />
            <svg viewBox="0 0 24 24">
              <path
                d="M5 3 L5 19.5 L9.4 15.3 L12.4 21.6 L15.3 20.3 L12.3 14 L18.6 13.8 Z"
                fill="#1d1a1c"
                stroke="#ffffff"
                strokeWidth="1.5"
                strokeLinejoin="round"
              />
            </svg>
          </span>
        )}
      </div>
    </div>
  )
}

export function DesignSection() {
  return (
    <StoryFeature
      step={STORY_STEPS[2]}
      title={
        <>
          채팅으로 설명하면
          <br />
          AI가 디자인을 그려요
        </>
      }
      description="4가지 생성 방식 중 하나를 골라, 원하는 디자인을 전해 주세요. 분석된 피부 톤과 손톱 쉐입을 반영해, 마음에 드는 디자인을 만들어 줘요."
      points={['4가지 디자인 생성 방식', '분석된 피부 톤 · 손톱 쉐입을 반영', '반복된 수정으로 마음에 드는 디자인을 생성']}
      renderMedia={(playing) => <DesignDemo playing={playing} />}
    />
  )
}
