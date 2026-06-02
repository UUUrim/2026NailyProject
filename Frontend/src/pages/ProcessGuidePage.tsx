import { useNavigate } from 'react-router-dom'
import { AppShell } from '@/components/layout/AppShell'
import '@/styles/process-guide.css'

const STEPS = [
  {
    number: '01',
    title: '손 촬영 & 분석',
    description: '카메라로 손을 촬영하면 길이·너비·곡률과 퍼스널 컬러를 분석합니다.',
    accent: '#fdeff4',
  },
  {
    number: '02',
    title: '네일 디자인 생성',
    description: '선호 스타일과 분석 결과를 반영해 AI가 맞춤 디자인을 제안합니다.',
    accent: '#f3eeff',
  },
  {
    number: '03',
    title: '3D 미리보기',
    description: '내 손톱 모델에 디자인을 입혀 실제 착용 느낌을 확인합니다.',
    accent: '#eef8ff',
  },
  {
    number: '04',
    title: '3D 프린터 제작',
    description: '마음에 드는 디자인을 선택해 맞춤 네일팁을 출력합니다.',
    accent: '#f5f5f5',
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
          손 스캔부터 3D 프린팅까지, 네일리가 함께하는 4단계 제작 과정입니다.
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
          확인하고 손 촬영 시작하기
        </button>
      </div>
    </AppShell>
  )
}
