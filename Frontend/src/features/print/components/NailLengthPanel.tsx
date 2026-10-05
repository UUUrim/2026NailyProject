import {
    getDefaultTipExtensionMm,
    TIP_EXTENSION_MAX_MM,
    TIP_EXTENSION_MIN_MM,
} from '@/shared/constants/nailShapes'
import { NailLengthPreview } from '@/features/print/components/NailLengthPreview'

// "+5mm"라는 숫자만으로는 실제로 어느 정도 길이인지 감이 잘 안 와서, 구간마다 이름과
// 한 줄 설명을 붙여 준다. 쉐입별 기본값(5mm/7mm)은 모두 '미디엄' 구간에 들어간다.
const LENGTH_TIERS = [
    { maxMm: 3, label: '숏', description: '일상생활에 부담 없는 짧고 깔끔한 길이예요.' },
    { maxMm: 7, label: '미디엄', description: '데일리로 무난하게 어울리는 자연스러운 길이예요.' },
    { maxMm: 11, label: '롱', description: '손가락이 길고 가늘어 보이는 존재감 있는 길이예요.' },
    { maxMm: Infinity, label: '엑스트라 롱', description: '화려하지만 타이핑 등 일상생활이 조금 불편할 수 있어요.' },
] as const

const RULER_LABEL_MM = [TIP_EXTENSION_MIN_MM, 5, 10, TIP_EXTENSION_MAX_MM]
const RULER_TICKS_MM = Array.from(
    { length: TIP_EXTENSION_MAX_MM - TIP_EXTENSION_MIN_MM + 1 },
    (_, i) => TIP_EXTENSION_MIN_MM + i,
)

function toPercent(mm: number): number {
    return ((mm - TIP_EXTENSION_MIN_MM) / (TIP_EXTENSION_MAX_MM - TIP_EXTENSION_MIN_MM)) * 100
}

const ResetIcon = (
    <svg viewBox="0 0 24 24" width="13" height="13" fill="none" aria-hidden="true">
        <path d="M4.5 12a7.5 7.5 0 1 0 2.2-5.3L4.5 9" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M4.5 4.5V9H9" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
)

const CheckIcon = (
    <svg viewBox="0 0 24 24" width="11" height="11" fill="none" aria-hidden="true">
        <path d="M5 12.5 10 17.5 19 7" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
)

const InfoIcon = (
    <svg viewBox="0 0 24 24" width="15" height="15" fill="none" aria-hidden="true">
        <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.8" />
        <path d="M12 11v5.5M12 7.6v.4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
)

const MinusIcon = (
    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" aria-hidden="true">
        <path d="M6 12h12" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />
    </svg>
)

const PlusIcon = (
    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" aria-hidden="true">
        <path d="M6 12h12M12 6v12" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />
    </svg>
)

type Props = {
    shapeId: string | null
    valueMm: number
    onChange: (nextMm: number) => void
    // 선택한 기록의 실측 손톱 평균 길이 - "어디에 더해지는 길이인지"를 숫자로 보여 주는 데 쓴다
    measuredLengthMm?: number | null
    disabled?: boolean
}

export function NailLengthPanel({ shapeId, valueMm, onChange, measuredLengthMm, disabled = false }: Props) {
    const defaultMm = getDefaultTipExtensionMm(shapeId)
    const isDefault = valueMm === defaultMm
    const tier = LENGTH_TIERS.find((t) => valueMm <= t.maxMm) ?? LENGTH_TIERS[LENGTH_TIERS.length - 1]

    return (
        <div className={`print-length-panel${disabled ? ' is-locked' : ''}`}>
            <figure className="print-length-panel__preview">
                <NailLengthPreview shapeId={shapeId} extensionMm={valueMm} />
                <figcaption className="print-length-panel__legend">
                    <span className="print-length-panel__legend-item print-length-panel__legend-item--ext">연장되는 부분</span>
                    <span className="print-length-panel__legend-item print-length-panel__legend-item--edge">내 손톱 끝</span>
                </figcaption>
            </figure>

            <div className="print-length-panel__control">
                <div className="print-length-panel__head">
                    <span className="print-length-panel__label">연장 길이</span>
                    {isDefault ? (
                        <span className="print-length-panel__default-chip">
                            {CheckIcon}
                            기본 길이
                        </span>
                    ) : (
                        <button
                            type="button"
                            className="print-length-panel__reset"
                            onClick={() => onChange(defaultMm)}
                            disabled={disabled}
                        >
                            {ResetIcon}
                            기본 {defaultMm}mm로
                        </button>
                    )}
                </div>

                <div className="print-length-panel__value-row">
                    <strong className="print-length-panel__value">
                        +{valueMm}
                        <span className="print-length-panel__unit">mm</span>
                    </strong>
                    <span className="print-length-panel__tier">{tier.label}</span>
                </div>
                <p className="print-length-panel__desc">{tier.description}</p>

                <div className="print-length-panel__slider-row">
                    <button
                        type="button"
                        className="print-length-panel__step"
                        onClick={() => onChange(valueMm - 1)}
                        disabled={disabled || valueMm <= TIP_EXTENSION_MIN_MM}
                        aria-label="1mm 짧게"
                    >
                        {MinusIcon}
                    </button>

                    <div className="print-length-panel__slider">
                        <div className="print-length-panel__scale print-length-panel__flags" aria-hidden="true">
                            <span className="print-length-panel__flag" style={{ left: `${toPercent(defaultMm)}%` }}>
                                기본
                            </span>
                        </div>
                        <div className="print-length-panel__input-wrap">
                            <div className="print-length-panel__rail">
                                <span className="print-length-panel__rail-fill" style={{ width: `${toPercent(valueMm)}%` }} />
                            </div>
                            <input
                                type="range"
                                className="print-length-panel__range"
                                min={TIP_EXTENSION_MIN_MM}
                                max={TIP_EXTENSION_MAX_MM}
                                step={1}
                                value={valueMm}
                                onChange={(e) => onChange(Number(e.target.value))}
                                disabled={disabled}
                                aria-label="네일 팁 연장 길이"
                                aria-valuetext={`${valueMm}mm, ${tier.label}`}
                            />
                        </div>
                        <div className="print-length-panel__scale print-length-panel__ticks" aria-hidden="true">
                            {RULER_TICKS_MM.map((mm) => (
                                <span
                                    key={mm}
                                    className={`print-length-panel__tick${RULER_LABEL_MM.includes(mm) ? ' is-major' : ''}${mm === defaultMm ? ' is-default' : ''}`}
                                    style={{ left: `${toPercent(mm)}%` }}
                                />
                            ))}
                        </div>
                        <div className="print-length-panel__scale print-length-panel__ticks-labels" aria-hidden="true">
                            {RULER_LABEL_MM.map((mm) => (
                                <span key={mm} style={{ left: `${toPercent(mm)}%` }}>
                                    {mm}mm
                                </span>
                            ))}
                        </div>
                    </div>

                    <button
                        type="button"
                        className="print-length-panel__step"
                        onClick={() => onChange(valueMm + 1)}
                        disabled={disabled || valueMm >= TIP_EXTENSION_MAX_MM}
                        aria-label="1mm 길게"
                    >
                        {PlusIcon}
                    </button>
                </div>
            </div>

            <p className="print-length-panel__note">
                {InfoIcon}
                <span>
                    스캔한 내 손톱 길이
                    {measuredLengthMm != null && <strong>(평균 {Number(measuredLengthMm).toFixed(1)}mm)</strong>}
                    에 연장 길이만큼 더해서 출력해요.
                </span>
            </p>
        </div>
    )
}
