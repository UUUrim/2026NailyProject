import { useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import {
  buildDesignPrompt,
  INITIAL_PREFERENCES,
  type NailDesignPreferences,
  PERSONAL_COLOR_SWATCHES,
  PREFERENCE_LIMITS,
  PREFERENCE_OPTIONS,
  type PreferenceKey,
  SEASON_ROWS,
} from '@/constants/designPreferences'
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

export function NailDesignPreferencePage() {
  const navigate = useNavigate()
  const [preferences, setPreferences] = useState<NailDesignPreferences>(INITIAL_PREFERENCES)
  const [colorMethod, setColorMethod] = useState<'palette' | 'picker'>(() =>
    getRecommendedSeasonCode() ? 'palette' : 'palette',
  )
  const [selectedSeasonCode, setSelectedSeasonCode] = useState<string>(() =>
    getRecommendedSeasonCode() ?? 'spring_light',
  )
  const [pickerColor, setPickerColor] = useState<string>('#DE869F')

  const prompt = useMemo(() => buildDesignPrompt(preferences), [preferences])
  const seasonSwatches = PERSONAL_COLOR_SWATCHES[selectedSeasonCode] ?? []
  const isValidHex = /^#[0-9a-fA-F]{6}$/.test(pickerColor)

  const toggleColor = (hex: string) => {
    setPreferences((prev) => togglePreference(prev, 'color', hex.toUpperCase()))
  }

  const handleSubmit = () => {
    navigate('/design/result', { state: { preferences, prompt } })
  }

  return (
    <div className="nail-design-page">
      <header className="nail-design-page__header">
        <Link to="/" className="nail-design-page__logo">
          Naily
        </Link>
        <Link to="/process" className="nail-design-page__back">
          이전 단계로
        </Link>
      </header>

      <main className="nail-design-page__content">
        <h1 className="nail-design-page__title">네일 디자인 선호도 선택</h1>
        <p className="nail-design-page__subtitle">체크박스로 선택하면 키워드 프롬프트로 변환됩니다.</p>

        <section className="pref-group">
          <h2>mood (최대 2개)</h2>
          <div className="pref-options">
            {PREFERENCE_OPTIONS.mood.map((option) => (
              <label key={option} className="pref-option">
                <input
                  type="checkbox"
                  checked={preferences.mood.includes(option)}
                  onChange={() =>
                    setPreferences((prev) => togglePreference(prev, 'mood', option))
                  }
                />
                {option}
              </label>
            ))}
          </div>
        </section>

        <section className="pref-group">
          <h2>designType (최대 2개)</h2>
          <div className="pref-options">
            {PREFERENCE_OPTIONS.designType.map((option) => (
              <label key={option} className="pref-option">
                <input
                  type="checkbox"
                  checked={preferences.designType.includes(option)}
                  onChange={() =>
                    setPreferences((prev) => togglePreference(prev, 'designType', option))
                  }
                />
                {option}
              </label>
            ))}
          </div>
        </section>

        <section className="pref-grid">
          <div className="pref-group">
            <h2>season (1개)</h2>
            <div className="pref-options">
              {PREFERENCE_OPTIONS.season.map((option) => (
                <label key={option} className="pref-option">
                  <input
                    type="checkbox"
                    checked={preferences.season.includes(option)}
                    onChange={() =>
                      setPreferences((prev) => togglePreference(prev, 'season', option))
                    }
                  />
                  {option}
                </label>
              ))}
            </div>
          </div>

          <div className="pref-group">
            <h2>length (1개)</h2>
            <div className="pref-options">
              {PREFERENCE_OPTIONS.length.map((option) => (
                <label key={option} className="pref-option">
                  <input
                    type="checkbox"
                    checked={preferences.length.includes(option)}
                    onChange={() =>
                      setPreferences((prev) => togglePreference(prev, 'length', option))
                    }
                  />
                  {option}
                </label>
              ))}
            </div>
          </div>
        </section>

        <section className="pref-group">
          <h2>motif (최대 2개)</h2>
          <div className="pref-options">
            {PREFERENCE_OPTIONS.motif.map((option) => (
              <label key={option} className="pref-option">
                <input
                  type="checkbox"
                  checked={preferences.motif.includes(option)}
                  onChange={() =>
                    setPreferences((prev) => togglePreference(prev, 'motif', option))
                  }
                />
                {option}
              </label>
            ))}
          </div>
        </section>

        <section className="pref-grid">
          <div className="pref-group">
            <h2>shape (1개)</h2>
            <div className="pref-options">
              {PREFERENCE_OPTIONS.shape.map((option) => (
                <label key={option} className="pref-option">
                  <input
                    type="checkbox"
                    checked={preferences.shape.includes(option)}
                    onChange={() =>
                      setPreferences((prev) => togglePreference(prev, 'shape', option))
                    }
                  />
                  {option}
                </label>
              ))}
            </div>
          </div>

          <div className="pref-group">
            <h2>color (최대 2개)</h2>

            <div className="color-method-tabs">
              <button
                type="button"
                className={`color-method-tab ${colorMethod === 'palette' ? 'is-active' : ''}`}
                onClick={() => setColorMethod('palette')}
              >
                탭 1: 퍼스널컬러 팔레트
              </button>
              <button
                type="button"
                className={`color-method-tab ${colorMethod === 'picker' ? 'is-active' : ''}`}
                onClick={() => setColorMethod('picker')}
              >
                탭 2: 전체 컬러피커
              </button>
            </div>

            {colorMethod === 'palette' ? (
              <div className="color-method-panel">
                <p className="color-method-note">
                  1) 손 이미지 분석으로 시즌 추천 → 2) 시즌 스와치 선택 → 3) 선택 HEX를 프롬프트에 삽입
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
                        {row.code} ({row.nameKo})
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

                <table className="season-table">
                  <thead>
                    <tr>
                      <th>시즌 코드</th>
                      <th>한국어명</th>
                      <th>톤 계열</th>
                      <th>명도</th>
                      <th>채도</th>
                    </tr>
                  </thead>
                  <tbody>
                    {SEASON_ROWS.map((row) => (
                      <tr
                        key={row.code}
                        className={row.code === selectedSeasonCode ? 'is-selected' : ''}
                      >
                        <td>{row.code}</td>
                        <td>{row.nameKo}</td>
                        <td>{row.tone}</td>
                        <td>{row.brightness}</td>
                        <td>{row.saturation}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="color-method-panel">
                <p className="color-method-note">
                  1) 컬러피커에서 색 선택/드래그 → 2) HEX 실시간 확인 → 3) 색상 추가(최대 2개)
                </p>
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
                    HEX 추가
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
                <span className="selected-color-empty">선택된 HEX 없음</span>
              )}
            </div>
          </div>
        </section>

        <section className="pref-prompt-preview">
          <h2>생성 프롬프트 미리보기</h2>
          <pre>{prompt}</pre>
        </section>

        <button type="button" className="nail-design-page__submit" onClick={handleSubmit}>
          네일 디자인 생성하기
        </button>
      </main>
    </div>
  )
}
