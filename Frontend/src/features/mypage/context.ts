import type { RefObject } from 'react'
import { useOutletContext, type NavigateFunction } from 'react-router-dom'
import type { UserProfileResponse } from '@/entities/user/api'
import type { DesignImageResponse, SavedDesignResponse, SavedFolderResponse } from '@/entities/design/api'
import type { ScanHistoryItem } from '@/entities/scan/api'
import type { ScanSession } from '@/shared/utils/scanDetail'
import type { NailTipPrintOrder, SectionId, TimelineDayEvent } from './shared'
import type { SortOrder } from '@/features/mypage/components/SortControl'
import type { FolderSortOrder } from '@/features/mypage/components/FolderSortControl'
import type { DesignImageDetailInput } from '@/features/mypage/components/DesignImageDetailModal'

// MyPageLayout이 <Outlet context={ctx} /> 로 각 탭 라우트에 내려주는 값의 타입.
// 상태/핸들러는 전부 MyPageLayout(및 useMyPageProfile/useMyPageData 훅)에 정의되어 있고,
// 탭 컴포넌트는 이 컨텍스트로 원시 데이터/핸들러를 받아 features/mypage/components의
// 메모이즈된 프레젠테이셔널 컴포넌트(PageHeader, ImageGrid 등)에 props로 넘겨 그린다.
export type MyPageContextValue = {
  navigate: NavigateFunction
  currentSection: SectionId

  // ── 데이터 ──
  profile: UserProfileResponse | null
  isLoading: boolean
  designs: DesignImageResponse[]
  favorites: SavedDesignResponse[]
  scans: ScanHistoryItem[]
  prints: NailTipPrintOrder[]
  savedFolders: SavedFolderResponse[]
  scanSessions: ScanSession[]
  likedKeySet: Set<string>
  sortedScanSessions: ScanSession[]
  sortedPrints: NailTipPrintOrder[]
  sortedDesigns: DesignImageResponse[]
  sortedFavorites: SavedDesignResponse[]
  sortedFolders: SavedFolderResponse[]
  totalScanCount: number
  totalPrintCount: number
  totalDesignCount: number
  totalFavoriteCount: number

  // ── 프로필: 닉네임 변경 ──
  isEditingNickname: boolean
  nicknameStage: 'password' | 'nickname' | 'done'
  nicknamePassword: string
  setNicknamePassword: (v: string) => void
  nicknamePasswordError: string
  isVerifyingNicknamePassword: boolean
  nickname: string
  setNickname: (v: string) => void
  nicknameError: string
  isSavingNickname: boolean
  handleStartEditNickname: () => void
  handleCloseNicknameForm: () => void
  handleVerifyNicknamePassword: () => Promise<void>
  handleSaveNickname: () => Promise<void>

  // ── 프로필: 비밀번호 변경 ──
  isEditingPassword: boolean
  passwordStage: 'password' | 'new' | 'done'
  currentPassword: string
  setCurrentPassword: (v: string) => void
  currentPasswordError: string
  isVerifyingCurrentPassword: boolean
  newPassword: string
  setNewPassword: (v: string) => void
  passwordConfirm: string
  setPasswordConfirm: (v: string) => void
  newPasswordSubmitError: string
  isSavingPassword: boolean
  handleStartEditPassword: () => void
  handleClosePasswordForm: () => void
  handleVerifyCurrentPassword: () => Promise<void>
  handleSavePassword: () => Promise<void>

  // ── 찜 목록 / 폴더 ──
  isBusy: boolean
  selectedFavoriteFolderId: number | null
  setSelectedFavoriteFolderId: (id: number | null) => void
  creatingFolder: boolean
  newFolderNameInStrip: string
  setNewFolderNameInStrip: (v: string) => void
  isCreatingFolder: boolean
  createFolderError: string | null
  startCreatingFolderInStrip: () => void
  cancelCreatingFolderInStrip: () => void
  handleCreateFolderInStrip: () => Promise<void>
  openDeleteFolderModal: (folder: SavedFolderResponse) => void
  findFavoriteFolder: (designId: number, imageUrl: string) => SavedDesignResponse['folder']
  openMoveFolderModal: (designId: number, imageUrl: string) => void
  toggleLikeFromGrid: (designId: number, imageUrl: string) => Promise<void>
  openDetailImage: (img: DesignImageDetailInput) => void

  // ── 목록 정렬/페이지네이션 ──
  listSortOrder: SortOrder
  setListSortOrder: (order: SortOrder) => void
  folderSortOrder: FolderSortOrder
  setFolderSortOrder: (order: FolderSortOrder) => void
  listPage: number
  setListPage: (page: number) => void
  paginate: <T>(items: T[], id: SectionId) => { page: number; totalPages: number; slice: T[]; total: number }

  // ── 활동 타임라인 ──
  calendarRef: RefObject<HTMLDivElement | null>
  dayBodyRef: RefObject<HTMLDivElement | null>
  selectedTimelineDate: string
  calendarOpen: boolean
  calendarViewMode: 'days' | 'months'
  calendarMonth: { year: number; month: number }
  hasAnyTimelineActivity: boolean
  timelineActivityDates: Set<string>
  timelineScansOldest: ScanSession[]
  timelinePrintsOldest: NailTipPrintOrder[]
  timelineDesignsOldest: DesignImageResponse[]
  dayEvents: TimelineDayEvent[]
  dayTotalCount: number
  activeActivityId: string | null
  moveTimelineDate: (delta: number) => void
  openTimelineCalendar: () => void
  selectTimelineDate: (key: string) => void
  shiftCalendarMonth: (delta: number) => void
  shiftCalendarYear: (delta: number) => void
  setCalendarViewMode: (mode: 'days' | 'months') => void
  selectCalendarMonth: (month: number) => void
  isCurrentOrFutureMonth: (year: number, month: number) => boolean
  handleActivityHover: (id: string | null) => void
  handleActivitySelect: (id: string) => void

  // ── 상세 모달 열기 ──
  openScanDetail: (session: ScanSession) => void
  openPrintDetail: (order: NailTipPrintOrder) => Promise<void>
}

export function useMyPageContext() {
  return useOutletContext<MyPageContextValue>()
}
