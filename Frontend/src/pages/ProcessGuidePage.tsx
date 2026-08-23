import { useNavigate } from 'react-router-dom'
import { AppShell } from '@/components/layout/AppShell'
import '@/styles/process-guide.css'

const STEPS = [
  {
    number: '01',
    title: '손 촬영 & 분석',
    description: '카메라로 손을 촬영하면 길이·너비·곡률과 피부 톤을 분석해요.',
    accent: '#fdeff4',
  },
  {
    number: '02',
    title: '3D 프린터 제작',
    description: '분석된 손톱 형태에 맞춘 나만의 네일팁을 출력해요.',
    accent: '#f3eeff',
  },
  {
    number: '03',
    title: '네일 디자인 생성',
    description: '선호 스타일과 분석 결과를 반영해 AI가 맞춤 디자인을 생성해요.',
    accent: '#eef8ff',
  },
  {
    number: '04',
    title: '3D 미리보기',
    description: '내 손 위에 디자인을 입혀 실제 착용 느낌을 확인해요.',
    accent: '#ebf9f1',
  },
]

export function ProcessGuidePage() {
  const navigate = useNavigate()

  return (
    <AppShell mainClassName="process-v2">
      <section className="process-v2__hero">
        <p className="process-v2__eyebrow">Your Custom Nail Journey</p>
        <h1>
          나만의 네일팁,
          <br />
          이렇게 만들어져요
        </h1>
        <p className="process-v2__lead">
          손 스캔부터 3D 미리보기까지, 네일리와 함께하는 4단계 제작 과정이에요.
        </p>
      </section>

      <ol className="process-v2__timeline">
        {STEPS.map((step, index) => (
          <li key={step.number} className="process-v2__step">
            <div className="process-v2__step-marker" style={{ background: step.accent }}>
              <span>{step.number}</span>
            </div>
            {index < STEPS.length - 1 && <div className="process-v2__connector" aria-hidden="true" />}
            <div className="process-v2__step-body">
              <h2>{step.title}</h2>
              <p>{step.description}</p>
            </div>
          </li>
        ))}
      </ol>

      <div className="process-v2__cta-wrap">
        <button type="button" className="process-v2__cta" onClick={() => navigate('/scan/hand')}>
          만들러 가기
        </button>
      </div>
    </AppShell>
  )
}
