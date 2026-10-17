import { useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import {
    getDefaultTipExtensionMm,
    TIP_EXTENSION_MAX_MM,
    TIP_EXTENSION_MIN_MM,
} from '@/shared/constants/nailShapes'
import { NAIL_BASELINE } from '@/shared/utils/nailMetrics'
import { NailLengthPreview } from '@/features/print/components/NailLengthPreview'

// "+5mm"라는 숫자만으로는 실제로 어느 정도 길이인지 감이 잘 안 와서, 구간마다 이름과
// 한 줄 설명을 붙여 준다. 같은 +8mm라도 원래 손톱이 짧은 사람에겐 훨씬 길게 느껴지므로,
// 구간은 mm 절대값이 아니라 "내 손톱 길이 대비 연장 비율"로 나눈다. 비율 경계(30%/65%/100%)는
// 평균 손톱(NAIL_BASELINE 11.5mm)일 때 예전 절대 기준(3/7/11mm까지)과 똑같이 떨어지도록 잡았다.
const LENGTH_TIERS = [
    { maxRatio: 0.3, label: '숏', description: '일상생활에 부담 없는 짧고 깔끔한 길이예요.' },
    { maxRatio: 0.65, label: '미디엄', description: '데일리로 무난하게 어울리는 자연스러운 길이예요.' },
    { maxRatio: 1, label: '롱', description: '손가락이 길고 가늘어 보이는 존재감 있는 길이예요.' },
    { maxRatio: Infinity, label: '엑스트라 롱', description: '화려하지만 타이핑 등 일상생활이 조금 불편할 수 있어요.' },
] as const

// 실측값이 비정상적으로 작거나 크면(측정 오류) 미리보기 비율이 극단적으로 틀어지지 않게 묶어 둔다
const NATURAL_LENGTH_RANGE_MM = { min: 6, max: 20 }

// 손톱이 손가락 끝보다 이만큼 이상 나와 있을 때만 "내 손톱 끝"을 손가락 끝보다 위로 올려 그린다 -
// 그보다 작으면 측정 오차와 구분이 안 되므로 손가락 끝에 그린다
const FINGERTIP_LINE_MIN_FREE_EDGE_MM = 0.5

const RULER_LABEL_MM = [TIP_EXTENSION_MIN_MM, 5, 10, 15, TIP_EXTENSION_MAX_MM]
const RULER_TICKS_MM = Array.from(
    { length: TIP_EXTENSION_MAX_MM - TIP_EXTENSION_MIN_MM + 1 },
    (_, i) => TIP_EXTENSION_MIN_MM + i,
)

// print.css의 --thumb와 같은 값 - 썸 지름
const THUMB_PX = 22

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
    // 선택한 기록의 스캔 사진에서 잰, 손톱이 손가락 끝보다 나와 있는 평균 길이 - 미리보기의 "내 손톱 끝" 위치
    measuredFreeEdgeMm?: number | null
    disabled?: boolean
}

export function NailLengthPanel({ shapeId, valueMm, onChange, measuredLengthMm, measuredFreeEdgeMm, disabled = false }: Props) {
    const defaultMm = getDefaultTipExtensionMm(shapeId)
    const isDefault = valueMm === defaultMm

    // 썸을 잡고 끄는 드래그 - 포인터를 캡처해 두면 마우스/터치 모두, 포인터가 슬라이더 밖으로 나가도 계속 따라온다.
    // 썸 중심은 양 끝에서 썸 반지름만큼 안쪽까지만 움직이므로 그만큼 들인 폭으로 mm를 계산한다.
    const inputWrapRef = useRef<HTMLDivElement>(null)
    const inputRef = useRef<HTMLInputElement>(null)
    const grabOffsetRef = useRef(0)
    const [dragging, setDragging] = useState(false)
    // 썸 위에 마우스가 올라와 있는지 - 드래그를 놓은 직후엔 포인터가 썸 위에 그대로 있어도
    // 호버 모양을 풀어 두고, 포인터가 썸을 벗어난 뒤에야 다시 반응하게 한다
    const [thumbHover, setThumbHover] = useState(false)
    const hoverReleasedRef = useRef(false)

    const getThumbCenterX = (rectLeft: number, rectWidth: number): number =>
        rectLeft + THUMB_PX / 2 + ((rectWidth - THUMB_PX) * toPercent(valueMm)) / 100

    const mmFromPointer = (clientX: number): number => {
        const wrap = inputWrapRef.current
        if (!wrap) return valueMm
        const rect = wrap.getBoundingClientRect()
        const half = THUMB_PX / 2
        const usable = rect.width - THUMB_PX
        if (usable <= 0) return valueMm
        const ratio = Math.min(1, Math.max(0, (clientX - grabOffsetRef.current - rect.left - half) / usable))
        return Math.round(TIP_EXTENSION_MIN_MM + ratio * (TIP_EXTENSION_MAX_MM - TIP_EXTENSION_MIN_MM))
    }

    const handleDragStart = (e: ReactPointerEvent<HTMLDivElement>) => {
        if (disabled || (e.pointerType === 'mouse' && e.button !== 0)) return
        const wrap = inputWrapRef.current
        if (!wrap) return
        const rect = wrap.getBoundingClientRect()
        const thumbCenterX = getThumbCenterX(rect.left, rect.width)
        // 썸을 직접 잡았으면 잡은 지점 그대로 따라가고, 레일을 눌렀으면 그 자리로 썸이 이동한다
        grabOffsetRef.current = Math.abs(e.clientX - thumbCenterX) <= THUMB_PX / 2 ? e.clientX - thumbCenterX : 0
        e.preventDefault()
        e.currentTarget.setPointerCapture(e.pointerId)
        inputRef.current?.focus({ preventScroll: true })
        setDragging(true)
        setThumbHover(false)
        const next = mmFromPointer(e.clientX)
        if (next !== valueMm) onChange(next)
    }

    const handleDragMove = (e: ReactPointerEvent<HTMLDivElement>) => {
        if (!dragging) {
            // 마우스/펜만 호버가 있다 (터치는 손가락을 떼면 올라와 있는 포인터가 없다)
            if (disabled || e.pointerType === 'touch') return
            const rect = e.currentTarget.getBoundingClientRect()
            const overThumb = Math.abs(e.clientX - getThumbCenterX(rect.left, rect.width)) <= THUMB_PX / 2
            if (hoverReleasedRef.current) {
                if (overThumb) return
                hoverReleasedRef.current = false
            }
            setThumbHover(overThumb)
            return
        }
        const next = mmFromPointer(e.clientX)
        if (next !== valueMm) onChange(next)
    }

    const handleDragEnd = (e: ReactPointerEvent<HTMLDivElement>) => {
        if (!dragging) return
        if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId)
        setDragging(false)
        // 놓은 자리에 포인터가 그대로 있어도 호버 모양(확대)과 포커스 링을 풀어 준다
        hoverReleasedRef.current = true
        setThumbHover(false)
        inputRef.current?.blur()
    }

    const handlePointerLeave = () => {
        hoverReleasedRef.current = false
        setThumbHover(false)
    }

    // 내 손톱 길이 - 실측 평균이 없으면 성인 평균 손톱 길이를 기준으로 보여 준다
    const hasMeasured = measuredLengthMm != null && Number.isFinite(Number(measuredLengthMm)) && Number(measuredLengthMm) > 0
    const naturalLengthMm = hasMeasured
        ? Math.min(NATURAL_LENGTH_RANGE_MM.max, Math.max(NATURAL_LENGTH_RANGE_MM.min, Number(measuredLengthMm)))
        : NAIL_BASELINE.length.mean
    const ratio = valueMm / naturalLengthMm
    const tier = LENGTH_TIERS.find((t) => ratio <= t.maxRatio) ?? LENGTH_TIERS[LENGTH_TIERS.length - 1]
    const totalLengthMm = naturalLengthMm + valueMm
    // 완성 길이가 지금 손톱의 몇 배인지 - 소수 첫째 자리까지, 2.0처럼 딱 떨어지면 "2배"로 보여 준다
    const lengthMultiple = Number((totalLengthMm / naturalLengthMm).toFixed(1))

    // 손톱이 손가락 끝보다 얼마나 나와 있는지 (스캔 사진 기준) - 미리보기의 "내 손톱 끝" 위치.
    // 손가락 끝을 넘지 않거나(짧은 손톱), 이 측정 전의 예전 스캔이면 0 - 손가락 끝에 그린다.
    // 연장 길이는 어느 경우든 이 내 손톱 끝에서부터 더해진다 (STL도 큐티클 → 손톱 끝 실측 길이 + 연장 길이).
    const measuredFreeEdge = hasMeasured && measuredFreeEdgeMm != null && Number.isFinite(Number(measuredFreeEdgeMm))
        ? Math.min(Math.max(Number(measuredFreeEdgeMm), 0), naturalLengthMm)
        : 0
    const freeEdgeMm = measuredFreeEdge >= FINGERTIP_LINE_MIN_FREE_EDGE_MM ? measuredFreeEdge : 0

    return (
        <div className={`print-length-panel${disabled ? ' is-locked' : ''}`}>
            <figure className="print-length-panel__preview">
                <NailLengthPreview shapeId={shapeId} extensionMm={valueMm} naturalLengthMm={naturalLengthMm} freeEdgeMm={freeEdgeMm} />
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
                <p className="print-length-panel__total">
                    완성 길이 약 <strong>{totalLengthMm.toFixed(1)}mm</strong>
                    <span className="print-length-panel__total-sep" aria-hidden="true">·</span>
                    <span className="print-length-panel__total-ratio">
                        {hasMeasured ? '지금 내 손톱보다' : '평균 손톱보다'} <strong>{lengthMultiple}배</strong> 더 길어요
                    </span>
                </p>

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
                        <div
                            ref={inputWrapRef}
                            className={`print-length-panel__input-wrap${dragging ? ' is-dragging' : ''}${thumbHover ? ' is-thumb-hover' : ''}`}
                            onPointerDown={handleDragStart}
                            onPointerMove={handleDragMove}
                            onPointerUp={handleDragEnd}
                            onPointerCancel={handleDragEnd}
                            onPointerLeave={handlePointerLeave}
                            onLostPointerCapture={() => setDragging(false)}
                        >
                            <div className="print-length-panel__rail">
                                <span className="print-length-panel__rail-fill" style={{ width: `${toPercent(valueMm)}%` }} />
                            </div>
                            <input
                                ref={inputRef}
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
                {hasMeasured ? (
                    <span>
                        스캔한 내 손톱 길이<strong>(평균 {Number(measuredLengthMm).toFixed(1)}mm)</strong>에 연장 길이만큼
                        더해서 출력해요.
                    </span>
                ) : (
                    <span>
                        스캔한 내 손톱 길이에 연장 길이만큼 더해서 출력해요. 손톱 길이 측정값이 없어 미리보기와
                        길이 단계는 평균 손톱 길이<strong>({NAIL_BASELINE.length.mean}mm)</strong> 기준으로 보여 드려요.
                    </span>
                )}
            </p>
        </div>
    )
}
