import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { getMyProfile, updateNickname, updatePassword, verifyCurrentPassword } from '@/entities/user/api'
import { ApiError } from '@/shared/utils/apiClient'
import { useAuth } from '@/shared/hooks/useAuth'
import { isPasswordValid } from '@/shared/utils/passwordRules'

const PROFILE_QUERY_KEY = ['mypage', 'profile'] as const

export function useMyPageProfile() {
  const navigate = useNavigate()
  const { logout } = useAuth()
  const queryClient = useQueryClient()

  // 프로필은 마이페이지 밖(예: 헤더 닉네임 표시)에서도 재사용될 수 있어 쿼리 캐시에 둔다 —
  // 실패해도 화면은 그냥 "-"로 보여주면 되므로 원래 코드처럼 에러를 조용히 무시한다.
  const { data: profile = null } = useQuery({
    queryKey: PROFILE_QUERY_KEY,
    queryFn: getMyProfile,
  })

  // ── 프로필: 닉네임 변경 (1단계: 현재 비밀번호 확인 → 2단계: 새 닉네임 입력) ──────
  const [isEditingNickname, setIsEditingNickname] = useState(false)
  const [nicknameStage, setNicknameStage] = useState<'password' | 'nickname' | 'done'>('password')
  const [nicknamePassword, setNicknamePassword] = useState('')
  const [nicknamePasswordError, setNicknamePasswordError] = useState('')
  const [isVerifyingNicknamePassword, setIsVerifyingNicknamePassword] = useState(false)
  const [nickname, setNickname] = useState('')
  const [nicknameError, setNicknameError] = useState('')
  const [isSavingNickname, setIsSavingNickname] = useState(false)

  // ── 프로필: 비밀번호 변경 (1단계: 현재 비밀번호 확인 → 2단계: 새 비밀번호 입력) ──────
  const [isEditingPassword, setIsEditingPassword] = useState(false)
  const [passwordStage, setPasswordStage] = useState<'password' | 'new' | 'done'>('password')
  const [currentPassword, setCurrentPassword] = useState('')
  const [currentPasswordError, setCurrentPasswordError] = useState('')
  const [isVerifyingCurrentPassword, setIsVerifyingCurrentPassword] = useState(false)
  const [newPassword, setNewPassword] = useState('')
  const [passwordConfirm, setPasswordConfirm] = useState('')
  const [newPasswordSubmitError, setNewPasswordSubmitError] = useState('')
  const [isSavingPassword, setIsSavingPassword] = useState(false)

  // 닉네임 입력칸 기본값 — 편집 중이 아닐 때만 서버 값으로 맞춰둔다 (편집 흐름 자체는
  // handleStartEditNickname/handleVerifyNicknamePassword가 별도로 초기화한다).
  useEffect(() => {
    if (profile && !isEditingNickname) setNickname(profile.nickname)
  }, [profile, isEditingNickname])

  // ── 닉네임 변경: 1단계(비밀번호 확인) → 2단계(새 닉네임) → 완료 ──────
  const handleStartEditNickname = () => {
    setNicknameStage('password')
    setNicknamePassword('')
    setNicknamePasswordError('')
    setNickname('')
    setNicknameError('')
    setIsEditingNickname(true)
  }

  const handleCloseNicknameForm = () => {
    setIsEditingNickname(false)
    setNicknameStage('password')
    setNicknamePassword('')
    setNicknamePasswordError('')
    setNickname('')
    setNicknameError('')
  }

  const handleVerifyNicknamePassword = async () => {
    if (!nicknamePassword) {
      setNicknamePasswordError('현재 비밀번호를 입력해 주세요.')
      return
    }
    if (!profile?.email) return

    setIsVerifyingNicknamePassword(true)
    setNicknamePasswordError('')

    try {
      const isCorrect = await verifyCurrentPassword(profile.email, nicknamePassword)
      if (!isCorrect) {
        setNicknamePasswordError('현재 비밀번호가 일치하지 않습니다. 다시 입력해 주세요.')
        setNicknamePassword('')
        return
      }
      setNickname(profile.nickname ?? '')
      setNicknameStage('nickname')
    } catch (e) {
      setNicknamePasswordError(e instanceof ApiError ? e.message : '비밀번호 확인에 실패했습니다.')
    } finally {
      setIsVerifyingNicknamePassword(false)
    }
  }

  const handleSaveNickname = async () => {
    const trimmed = nickname.trim()
    if (!trimmed) {
      setNicknameError('닉네임을 입력해 주세요.')
      return
    }

    setIsSavingNickname(true)
    setNicknameError('')

    try {
      const updated = await updateNickname(trimmed)
      queryClient.setQueryData(PROFILE_QUERY_KEY, updated)
      setNicknameStage('done')
    } catch (e) {
      setNicknameError(e instanceof ApiError ? e.message : '닉네임 변경에 실패했습니다.')
    } finally {
      setIsSavingNickname(false)
    }
  }

  // ── 비밀번호 변경: 1단계(현재 비밀번호 확인) → 2단계(새 비밀번호) → 완료 ──────
  const handleStartEditPassword = () => {
    setPasswordStage('password')
    setCurrentPassword('')
    setCurrentPasswordError('')
    setNewPassword('')
    setPasswordConfirm('')
    setNewPasswordSubmitError('')
    setIsEditingPassword(true)
  }

  const handleClosePasswordForm = () => {
    setIsEditingPassword(false)
    setPasswordStage('password')
    setCurrentPassword('')
    setCurrentPasswordError('')
    setNewPassword('')
    setPasswordConfirm('')
    setNewPasswordSubmitError('')
  }

  const handleVerifyCurrentPassword = async () => {
    if (!currentPassword) {
      setCurrentPasswordError('현재 비밀번호를 입력해 주세요.')
      return
    }
    if (!profile?.email) return

    setIsVerifyingCurrentPassword(true)
    setCurrentPasswordError('')

    try {
      const isCorrect = await verifyCurrentPassword(profile.email, currentPassword)
      if (!isCorrect) {
        setCurrentPasswordError('현재 비밀번호가 일치하지 않습니다. 다시 입력해 주세요.')
        setCurrentPassword('')
        return
      }
      setPasswordStage('new')
    } catch (e) {
      setCurrentPasswordError(e instanceof ApiError ? e.message : '비밀번호 확인에 실패했습니다.')
    } finally {
      setIsVerifyingCurrentPassword(false)
    }
  }

  const handleSavePassword = async () => {
    // 저장 버튼이 이 조건에서 비활성화되어 있어 사실상 도달하지 않지만, 방어적으로 한 번 더 확인한다.
    if (!isPasswordValid(newPassword) || newPassword !== passwordConfirm) return

    setIsSavingPassword(true)
    setNewPasswordSubmitError('')

    try {
      await updatePassword(currentPassword, newPassword)
      setPasswordStage('done')
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) {
        // 확인 이후 시점에 뒤늦게 현재 비밀번호 불일치가 감지된 경우 — 1단계로 되돌려서 다시 확인하게 한다.
        setPasswordStage('password')
        setCurrentPassword('')
        setCurrentPasswordError('현재 비밀번호가 일치하지 않습니다. 다시 입력해 주세요.')
      } else {
        setNewPasswordSubmitError(e instanceof ApiError ? e.message : '비밀번호 변경에 실패했습니다.')
      }
    } finally {
      setIsSavingPassword(false)
    }
  }

  const handleLogout = () => {
    logout()
    navigate('/')
  }

  return {
    profile,
    isEditingNickname,
    nicknameStage,
    nicknamePassword,
    setNicknamePassword,
    nicknamePasswordError,
    isVerifyingNicknamePassword,
    nickname,
    setNickname,
    nicknameError,
    isSavingNickname,
    handleStartEditNickname,
    handleCloseNicknameForm,
    handleVerifyNicknamePassword,
    handleSaveNickname,

    isEditingPassword,
    passwordStage,
    currentPassword,
    setCurrentPassword,
    currentPasswordError,
    isVerifyingCurrentPassword,
    newPassword,
    setNewPassword,
    passwordConfirm,
    setPasswordConfirm,
    newPasswordSubmitError,
    isSavingPassword,
    handleStartEditPassword,
    handleClosePasswordForm,
    handleVerifyCurrentPassword,
    handleSavePassword,

    handleLogout,
  }
}
