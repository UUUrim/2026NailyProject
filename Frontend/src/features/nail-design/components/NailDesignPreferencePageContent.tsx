import { AppShell } from '@/shared/layout/AppShell'
import {
  PREFERENCE_OPTIONS,
  PREFERENCE_SECTION_LABELS,
  type NailDesignPreferences,
  PREFERENCE_LIMITS,
  type PreferenceKey,
  SHAPE_PREVIEW_IMAGES,
} from '@/shared/constants/designPreferences'
import { useNailDesignPreferencePage } from '@/features/nail-design/hooks/useNailDesignPreferencePage'
import '@/styles/nail-design.css'

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

  if (preferenceKey === 'color') return null

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

export function NailDesignPreferencePageContent() {
  const {
    preferences,
    setPreferences,
    colorMethod,
    setColorMethod,
    pickerColor,
    setPickerColor,
    isSubmitting,
    errorMessage,
    skinSwatches,
    isValidHex,
    handleToggle,
    toggleColor,
    handleSubmit,
  } = useNailDesignPreferencePage()

  return (
      <AppShell mainClassName="nail-design-page__content">
        <div className="nail-design-page">
          <h1 className="nail-design-page__title">네일 디자인 선호도 선택</h1>
          <p className="nail-design-page__subtitle">
            원하는 스타일을 선택하면 맞춤 디자인 프롬프트로 변환됩니다.
          </p>

          <PreferenceSection preferenceKey="mood" preferences={preferences} onToggle={handleToggle} />
          <PreferenceSection preferenceKey="designType" preferences={preferences} onToggle={handleToggle} />
          <PreferenceSection preferenceKey="season" preferences={preferences} onToggle={handleToggle} />
          <PreferenceSection preferenceKey="motif" preferences={preferences} onToggle={handleToggle} />
          <PreferenceSection preferenceKey="shape" preferences={preferences} onToggle={handleToggle} />

          <section className="pref-group">
            <h2>{PREFERENCE_SECTION_LABELS.color} (최대 2개)</h2>
            <div className="color-method-tabs">
              <button
                  type="button"
                  className={`color-method-tab ${colorMethod === 'palette' ? 'is-active' : ''}`}
                  onClick={() => setColorMethod('palette')}
              >
                추천 컬러 팔레트
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
                    내 손 스캔 피부 톤을 기준으로 어울리는 팔레트에서 색을 선택할 수 있습니다.
                  </p>
                  <div className="swatch-grid">
                    {skinSwatches.map((hex) => {
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
                onChange={(e) => setPreferences((prev) => ({ ...prev, freeText: e.target.value }))}
                rows={4}
            />
          </section>

          {errorMessage && (
              <p className="nail-design-page__error" role="alert">
                {errorMessage}
              </p>
          )}

          <button
              type="button"
              className="nail-design-page__submit"
              onClick={() => void handleSubmit()}
              disabled={isSubmitting}
          >
            {isSubmitting ? '처리 중...' : '네일 디자인 생성하기'}
          </button>
        </div>
      </AppShell>
  )
}
