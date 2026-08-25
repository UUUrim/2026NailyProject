import { useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import {
  likeDesign,
  moveLikedDesign,
  unlikeDesign,
  shareDesign,
  unshareDesign,
  getDesignDetail,
  getDesignSwatches,
  getLikedDesigns,
  type DesignExtractedDetails,
  type SavedDesignResponse,
} from '@/entities/design/api'
import { getMyProfile } from '@/entities/user/api'
import { ApiError } from '@/shared/utils/apiClient'

const SAMPLE_IMAGE = `data:image/svg+xml;utf8,${encodeURIComponent(`
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 312">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#ffd6e3"/>
      <stop offset="1" stop-color="#c9a8ff"/>
    </linearGradient>
  </defs>
  <rect width="400" height="312" rx="16" fill="url(#g)"/>
  <path d="M170 60c-24 0-40 22-40 55v70c0 30 16 47 40 47s40-17 40-47V115c0-33-16-55-40-55Z" fill="none" stroke="#ffffff" stroke-width="4" opacity="0.9"/>
  <path d="M230 60c-24 0-40 22-40 55v70c0 30 16 47 40 47s40-17 40-47V115c0-33-16-55-40-55Z" fill="none" stroke="#ffffff" stroke-width="4" opacity="0.55"/>
  <text x="200" y="272" font-family="sans-serif" font-size="20" font-weight="700" fill="#ffffff" text-anchor="middle">샘플 미리보기</text>
</svg>
`)}`

const SAMPLE_DETAILS: DesignExtractedDetails = {
  colorPalette: ['#FDE2EA', '#DE869F', '#C9A8FF'],
  textures: ['그라데이션', '펄'],
  nailParts: ['플로럴', '크리스탈'],
}

export type GenerationContext = {
  source: string
  keywords: string[]
  referenceImageUrl: string | null
  handSummary: {
    seasonNameKo: string
    shapeLabel: string
    avgLength: number
    avgWidth: number
    avgCurve: number
  } | null
  revisionKeywords: string[]
}

const SAMPLE_CONTEXT: GenerationContext = {
  source: 'preference',
  keywords: ['우아', '그라데이션', '봄', '플로럴', '아몬드'],
  referenceImageUrl: null,
  handSummary: null,
  revisionKeywords: [],
}

const POLL_INTERVAL = 5000  // 5초마다 스와치 확인
const POLL_MAX = 24         // 최대 24회 (2분)

export function useNailDesignResultPage() {
  const location = useLocation()
  const navigate = useNavigate()

  // 이 페이지는 새로고침/뒤로가기/헤더 링크 등 어떤 방식으로 들어오든 location.state에
  // 결과가 남아있으면 그대로 보여준다(의도적으로 POP 여부를 구분하지 않고, 이탈 경고도 없음).
  const hasRealResult = Boolean((location.state?.imageUrls as string[] | undefined)?.length)
  const designId = (location.state?.designId as number | undefined) ?? null
  const imageUrls = hasRealResult ? (location.state!.imageUrls as string[]) : [SAMPLE_IMAGE]
  const image = imageUrls[0] ?? ''

  const initialDetails = hasRealResult
      ? ((location.state?.details as DesignExtractedDetails | undefined) ?? null)
      : SAMPLE_DETAILS
  const context = hasRealResult
      ? ((location.state?.context as GenerationContext | undefined) ?? null)
      : SAMPLE_CONTEXT

  // ★ 스와치 상태 — 처음엔 location.state에서 받은 값, 없으면 폴링으로 채움
  const [swatches, setSwatches] = useState<Record<string, string> | null>(
      initialDetails?.swatches ?? null
  )
  const [swatchLoading, setSwatchLoading] = useState(
      hasRealResult && !initialDetails?.swatches
  )
  const pollCountRef = useRef(0)
  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const [liked, setLiked] = useState(false)
  const [likedFolder, setLikedFolder] = useState<{ folderId: number; name: string } | null>(null)
  const [isLiking, setIsLiking] = useState(false)
  const [likeModalMode, setLikeModalMode] = useState<'like' | 'move' | null>(null)
  const [userName, setUserName] = useState('')
  const [shared, setShared] = useState(false)
  const [shareBusy, setShareBusy] = useState(false)

  // ★ 스와치 폴링
  useEffect(() => {
    if (!hasRealResult || !designId || swatches) return

    const poll = async () => {
      pollCountRef.current += 1

      try {
        const result = await getDesignSwatches(designId)
        if (result && Object.keys(result).length > 0) {
          setSwatches(result)
          setSwatchLoading(false)
          if (pollTimerRef.current) clearInterval(pollTimerRef.current)
          return
        }
      } catch {
        // 폴링 실패는 조용히 무시
      }

      // 최대 횟수 초과 시 포기
      if (pollCountRef.current >= POLL_MAX) {
        setSwatchLoading(false)
        if (pollTimerRef.current) clearInterval(pollTimerRef.current)
      }
    }

    // 즉시 1회 + 이후 인터벌
    void poll()
    pollTimerRef.current = setInterval(() => void poll(), POLL_INTERVAL)

    return () => {
      if (pollTimerRef.current) clearInterval(pollTimerRef.current)
    }
  }, [hasRealResult, designId, swatches])

  useEffect(() => {
    if (!hasRealResult) return

    let cancelled = false
    void getMyProfile()
        .then((profile) => {
          if (!cancelled) setUserName(profile.nickname || profile.name || '')
        })
        .catch(() => {})

    if (designId != null) {
      void getDesignDetail(designId)
          .then((detail) => {
            if (!cancelled) setShared(Boolean(detail.shared))
          })
          .catch(() => {})

      // getDesignDetail 응답엔 찜 여부가 안 들어있어서(공유 여부만 있음), 이미 찜한 디자인을
      // 다시 들어와서 볼 때 하트/폴더명이 항상 초기 상태(false/null)로 보이는 문제가 있었다.
      // 내 찜 목록을 따로 조회해서 이 디자인이 있는지 확인해 초기 상태를 맞춰준다.
      void getLikedDesigns()
          .then((likedDesigns) => {
            if (cancelled) return
            const match = likedDesigns.find((d) => d.designId === designId && d.imageUrl === image)
            if (match) {
              setLiked(true)
              setLikedFolder(match.folder)
            }
          })
          .catch(() => {})
    }

    return () => { cancelled = true }
  }, [hasRealResult, designId, image])

  const handleToggleShare = async () => {
    if (!designId || shareBusy) return
    setShareBusy(true)
    try {
      const next = shared ? await unshareDesign(designId) : await shareDesign(designId)
      setShared(Boolean(next.shared))
    } catch (e) {
      alert(e instanceof ApiError ? e.message : '공유 처리에 실패했습니다.')
    } finally {
      setShareBusy(false)
    }
  }

  const handleToggleLike = async () => {
    if (!designId || !image || isLiking) return
    if (!liked) { setLikeModalMode('like'); return }
    setIsLiking(true)
    try {
      await unlikeDesign(designId, image)
      setLiked(false)
      setLikedFolder(null)
    } catch (e) {
      alert(e instanceof ApiError ? e.message : '요청에 실패했습니다.')
    } finally {
      setIsLiking(false)
    }
  }

  const confirmLikeWithFolder = async (choice: { folderId?: number; newFolderName?: string }) => {
    if (!designId || !image || !likeModalMode) return
    const saved = likeModalMode === 'move'
        ? await moveLikedDesign(designId, image, choice)
        : await likeDesign(designId, image, choice)
    setLiked(true)
    setLikedFolder(saved.folder)
  }

  // 이미지 상세모달(DesignImageDetailModal)이 자체적으로 좋아요/공유 API를 호출한 뒤
  // 그 결과만 이 페이지 상태에 반영할 때 쓰는 순수 상태 동기화 함수 (API 재호출 없음)
  const applyLikeChange = (saved: SavedDesignResponse | null) => {
    setLiked(Boolean(saved))
    setLikedFolder(saved?.folder ?? null)
  }
  const applyShareChange = (nextShared: boolean) => setShared(nextShared)

  // details에 폴링으로 받은 swatches 주입
  const detailsWithSwatches: DesignExtractedDetails | null = initialDetails
      ? { ...initialDetails, swatches: swatches ?? undefined }
      : null

  return {
    navigate,
    image,
    designId,
    context,
    swatchLoading,
    liked,
    likedFolder,
    isLiking,
    likeModalMode,
    setLikeModalMode,
    userName,
    shared,
    shareBusy,
    detailsWithSwatches,
    handleToggleShare,
    handleToggleLike,
    confirmLikeWithFolder,
    applyLikeChange,
    applyShareChange,
  }
}
