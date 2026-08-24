import { useMemo, useState } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import {
  buildDesignPrompt,
  INITIAL_PREFERENCES,
  type NailDesignPreferences,
  PERSONAL_COLOR_SWATCHES,
  PREFERENCE_LIMITS,
  type PreferenceKey,
} from '@/shared/constants/designPreferences'
import { getHandScanResult } from '@/features/nail-design/utils/handScanStorage'
import { getRecommendedSeasonCode } from '@/features/nail-design/utils/personalColorStorage'
import { createChatSession, savePreferences, refineKeywords } from '@/features/nail-design/api/chat'
import { generateDesign } from '@/entities/design/api'
import { ApiError } from '@/shared/utils/apiClient'

export function togglePreference(
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
      if (nextSelected.length >= limit) return prev
      nextSelected = [...nextSelected, value]
    }
  } else if (limit === 1) {
    nextSelected = [value]
  } else {
    if (nextSelected.length >= limit) return prev
    nextSelected = [...nextSelected, value]
  }

  return { ...prev, [key]: nextSelected }
}

export function useNailDesignPreferencePage() {
  const navigate = useNavigate()
  const location = useLocation()
  const incomingScanId = (location.state?.scanId as number | undefined) ?? 0
  const incomingSeasonCode = (location.state?.seasonCode as string | undefined) ?? null
  const scanResult = getHandScanResult()
  const scanShape = scanResult?.recommendedShape

  const [preferences, setPreferences] = useState<NailDesignPreferences>(() => ({
    ...INITIAL_PREFERENCES,
    shape: scanShape ? [scanShape] : [],
  }))
  const [colorMethod, setColorMethod] = useState<'palette' | 'picker'>('palette')
  const [selectedSeasonCode, setSelectedSeasonCode] = useState<string>(
      () => incomingSeasonCode ?? getRecommendedSeasonCode() ?? 'spring_light',
  )
  const [pickerColor, setPickerColor] = useState<string>('#DE869F')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [errorMessage, setErrorMessage] = useState('')

  const prompt = useMemo(() => buildDesignPrompt(preferences), [preferences])
  const seasonSwatches = PERSONAL_COLOR_SWATCHES[selectedSeasonCode] ?? []
  const isValidHex = /^#[0-9a-fA-F]{6}$/.test(pickerColor)

  const handleToggle = (key: PreferenceKey, value: string) => {
    setPreferences((prev) => togglePreference(prev, key, value))
  }

  const toggleColor = (hex: string) => {
    setPreferences((prev) => togglePreference(prev, 'color', hex.toUpperCase()))
  }

  const handleSubmit = async () => {
    setIsSubmitting(true)
    setErrorMessage('')

    try {
      // 1. 채팅 세션 생성 → POST /chats/session
      const sessionId = await createChatSession()

      // 2. 선호도 저장 → POST /chats/{sessionId}/preferences
      await savePreferences(sessionId, {
        mood: preferences.mood,
        designType: preferences.designType,
        season: preferences.season[0] ?? '',
        motif: preferences.motif,
        shape: preferences.shape[0] ?? '',
        color: preferences.color,
      })

      // freeText 있으면 키워드 추출 -> POST /chats/{sessionId}/refine
      if (preferences.freeText.trim()) {
        await refineKeywords(sessionId, preferences.freeText.trim())
      }

      // 4. 디자인 생성 -> POST /designs/generate
      const designData = await generateDesign({
        sessionId,
        scanId: incomingScanId,
      })

      // 5. 결과 페이지로 이동 (이미지 3장 전달)
      navigate('/design/result', {
        state: {
          designId: designData.designId,
          imageUrls: designData.imageUrls,
          preferences,
          prompt,
        },
      })
    } catch (e) {
      if (e instanceof ApiError) {
        setErrorMessage(e.message)
      } else {
        setErrorMessage('요청에 실패했습니다. 다시 시도해 주세요.')
      }
    } finally {
      setIsSubmitting(false)
    }
  }

  return {
    incomingSeasonCode,
    preferences,
    setPreferences,
    colorMethod,
    setColorMethod,
    selectedSeasonCode,
    setSelectedSeasonCode,
    pickerColor,
    setPickerColor,
    isSubmitting,
    errorMessage,
    seasonSwatches,
    isValidHex,
    handleToggle,
    toggleColor,
    handleSubmit,
  }
}
