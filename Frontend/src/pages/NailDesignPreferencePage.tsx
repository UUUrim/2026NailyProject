import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { AppShell } from '@/components/layout/AppShell'
import { PageBackLink } from '@/components/layout/PageBackLink'
import {
  buildDesignPrompt,
  INITIAL_PREFERENCES,
  type NailDesignPreferences,
  PERSONAL_COLOR_SWATCHES,
  PREFERENCE_LIMITS,
  PREFERENCE_OPTIONS,
  PREFERENCE_SECTION_LABELS,
  type PreferenceKey,
  SEASON_ROWS,
  SHAPE_PREVIEW_IMAGES,
} from '@/constants/designPreferences'
import { getHandScanResult } from '@/utils/handScanStorage'
import { getRecommendedSeasonCode } from '@/utils/personalColorStorage'
import '@/styles/nail-design.css'

function togglePreference(
  prev: NailDesignPreferences,
  key: PreferenceKey,
  value: string,
): NailDesignPreferences {
  const selected = prev[key]
  const hasValue = selected.includes(value)

  if (hasValue) {
    return { ...prev, [key]: selected.filter((item) => item !== value) }
  }

  const limit = PREFERENCE_LIMITS[key]
  let nextSelected = [...selected]

  if (key === 'motif') {
    if (value === '없음') {
      nextSelected = ['없음']
    } else {
      nextSelected = nextSelected.filter((item) => item !== '없음')
      nextSelected = [...nextSelected, value].slice(-limit)
    }
  } else if (limit === 1) {
    nextSelected = [value]
  } else {
    nextSelected = [...nextSelected, value].slice(-limit)
  }

  return { ...prev, [key]: nextSelected }
}

function PreferenceSection({
  preferenceKey,
  preferences,
  onToggle,
}: {
  preferenceKey: PreferenceKey
  preferences: NailDesignPreferences
  onToggle: (key: PreferenceKey, value: string) => void
}) {
  const limit = PREFERENCE_LIMITS[preferenceKey]
  const title = `${PREFERENCE_SECTION_LABELS[preferenceKey]} (최대 ${limit}개)`

  if (preferenceKey === 'shape') {
    return (
      <section className="pref-group">
        <h2>{PREFERENCE_SECTION_LABELS.shape} (1개)</h2>
        <div className="pref-shape-grid">
          {PREFERENCE_OPTIONS.shape.map((option) => {
            const active = preferences.shape.includes(option.value)
            return (
              <label key={option.value} className={`pref-shape-card ${active ? 'is-active' : ''}`}>
                <input
                  type="checkbox"
                  checked={active}
                  onChange={() => onToggle('shape', option.value)}
                />
                <img
                  src={SHAPE_PREVIEW_IMAGES[option.value]}
                  alt={`${option.label} 네일 쉐입`}
                  className="pref-shape-card__image"
                />
                <span className="pref-shape-card__label">{option.label}</span>
                <span className="pref-shape-card__en">{option.value.toUpperCase()}</span>
              </label>
            )
          })}
        </div>
      </section>
    )
  }

  if (preferenceKey === 'color') {
    return null
  }

  return (
    <section className="pref-group">
      <h2>{title}</h2>
      <div className="pref-options">
        {PREFERENCE_OPTIONS[preferenceKey].map((option) => (
          <label key={option.value} className="pref-option">
            <input
              type="checkbox"
              checked={preferences[preferenceKey].includes(option.value)}
              onChange={() => onToggle(preferenceKey, option.value)}
            />
            {option.label}
          </label>
        ))}
      </div>
    </section>
  )
}

export function NailDesignPreferencePage() {
  const navigate = useNavigate()
  const scanShape = getHandScanResult()?.recommendedShape
  const [preferences, setPreferences] = useState<NailDesignPreferences>(() => ({
    ...INITIAL_PREFERENCES,
    shape: scanShape ? [scanShape] : [],
  }))
  const [colorMethod, setColorMethod] = useState<'palette' | 'picker'>('palette')
  const [selectedSeasonCode, setSelectedSeasonCode] = useState<string>(() =>
    getRecommendedSeasonCode() ?? 'spring_light',
  )
  const [pickerColor, setPickerColor] = useState<string>('#DE869F')

  const prompt = useMemo(() => buildDesignPrompt(preferences), [preferences])
  const seasonSwatches = PERSONAL_COLOR_SWATCHES[selectedSeasonCode] ?? []
  const isValidHex = /^#[0-9a-fA-F]{6}$/.test(pickerColor)

  const handleToggle = (key: PreferenceKey, value: string) => {
    setPreferences((prev) => togglePreference(prev, key, value))
  }

  const toggleColor = (hex: string) => {
    setPreferences((prev) => togglePreference(prev, 'color', hex.toUpperCase()))
  }

  const handleSubmit = () => {
    navigate('/design/result', { state: { preferences, prompt } })
  }

  return (
    <AppShell mainClassName="nail-design-page__content">
      <PageBackLink to="/scan/result" label="분석 결과" />
      <div className="nail-design-page">
        <h1 className="nail-design-page__title">네일 디자인 선호도 선택</h1>
        <p className="nail-design-page__subtitle">원하는 스타일을 선택하면 맞춤 디자인 프롬프트로 변환됩니다.</p>

        <PreferenceSection
          preferenceKey="mood"
          preferences={preferences}
          onToggle={handleToggle}
        />
        <PreferenceSection
          preferenceKey="designType"
          preferences={preferences}
          onToggle={handleToggle}
        />
        <PreferenceSection
          preferenceKey="season"
          preferences={preferences}
          onToggle={handleToggle}
        />
        <PreferenceSection
          preferenceKey="motif"
          preferences={preferences}
          onToggle={handleToggle}
        />
        <PreferenceSection
          preferenceKey="shape"
          preferences={preferences}
          onToggle={handleToggle}
        />

        <section className="pref-group">
          <h2>{PREFERENCE_SECTION_LABELS.color} (최대 2개)</h2>

          <div className="color-method-tabs">
            <button
              type="button"
              className={`color-method-tab ${colorMethod === 'palette' ? 'is-active' : ''}`}
              onClick={() => setColorMethod('palette')}
            >
              퍼스널컬러 팔레트
            </button>
            <button
              type="button"
              className={`color-method-tab ${colorMethod === 'picker' ? 'is-active' : ''}`}
              onClick={() => setColorMethod('picker')}
            >
              컬러 피커
            </button>
          </div>

          {colorMethod === 'palette' ? (
            <div className="color-method-panel">
              <p className="color-method-note">
                손 스캔 분석 시즌을 기준으로 팔레트에서 색을 선택할 수 있습니다.
              </p>
              <label className="season-select-row">
                시즌 분류 선택
                <select
                  value={selectedSeasonCode}
                  onChange={(e) => setSelectedSeasonCode(e.target.value)}
                  className="season-select"
                >
                  {SEASON_ROWS.map((row) => (
                    <option key={row.code} value={row.code}>
                      {row.nameKo}
                    </option>
                  ))}
                </select>
              </label>

              <div className="swatch-grid">
                {seasonSwatches.map((hex) => {
                  const active = preferences.color.includes(hex.toUpperCase())
                  return (
                    <button
                      key={hex}
                      type="button"
                      className={`swatch-button ${active ? 'is-active' : ''}`}
                      style={{ background: hex }}
                      onClick={() => toggleColor(hex)}
                      aria-label={`색상 ${hex}`}
                      title={hex}
                    />
                  )
                })}
              </div>
            </div>
          ) : (
            <div className="color-method-panel">
              <div className="picker-row">
                <input
                  type="color"
                  value={isValidHex ? pickerColor : '#DE869F'}
                  onChange={(e) => setPickerColor(e.target.value.toUpperCase())}
                  className="native-color-picker"
                  aria-label="색상 선택"
                />
                <input
                  type="text"
                  value={pickerColor.toUpperCase()}
                  onChange={(e) => setPickerColor(e.target.value)}
                  className="picker-hex-input"
                  placeholder="#DE869F"
                />
                <button
                  type="button"
                  className="picker-add-button"
                  onClick={() => toggleColor(pickerColor)}
                  disabled={!isValidHex}
                >
                  색상 추가
                </button>
              </div>
            </div>
          )}

          <div className="selected-colors">
            {preferences.color.length > 0 ? (
              preferences.color.map((hex) => (
                <button
                  key={hex}
                  type="button"
                  className="selected-color-chip"
                  onClick={() => toggleColor(hex)}
                  title="클릭하면 해제"
                >
                  <span className="pref-color-chip" style={{ background: hex }} />
                  {hex}
                </button>
              ))
            ) : (
              <span className="selected-color-empty">선택된 색상 없음</span>
            )}
          </div>
        </section>

        <section className="pref-group">
          <h2>추가 의견 (선택)</h2>
          <textarea
            className="pref-free-text"
            placeholder="원하시는 디자인이나 참고하고 싶은 스타일이 있으면 자유롭게 적어 주세요."
            value={preferences.freeText}
            onChange={(e) =>
              setPreferences((prev) => ({ ...prev, freeText: e.target.value }))
            }
            rows={4}
          />
        </section>

        <section className="pref-prompt-preview">
          <h2>생성 프롬프트 미리보기</h2>
          <pre>{prompt}</pre>
        </section>

        <button type="button" className="nail-design-page__submit" onClick={handleSubmit}>
          네일 디자인 생성하기
        </button>
      </div>
    </AppShell>
  )
}
