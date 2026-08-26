import {
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { NavLink, Outlet, useNavigate, useLocation } from 'react-router-dom'
import { AppShell } from '@/shared/layout/AppShell'
import { useMyPageProfile } from '@/features/mypage/hooks/useMyPageProfile'
import { useMyPageData } from '@/features/mypage/hooks/useMyPageData'
import { MyPageModals } from './MyPageModals'
import '@/styles/mypage.css'
import '@/styles/design-chat.css'
import '@/styles/nail-design.css'
import type { MyPageContextValue } from './context'
import {
  type SectionId,
  type TimelineDayGroup,
  type TimelineDayEvent,
  Icon,
  NAV_GROUPS,
  parseDateFlexible,
  dateKeyOf,
  compareByTime,
  todayKey,
  shiftDateKey,
} from './shared'

const SECTION_IDS: readonly SectionId[] = ['dashboard', 'profile', 'timeline', 'scans', 'prints', 'designs', 'favorites']

export function MyPageLayout() {
  const navigate = useNavigate()
  const location = useLocation()

  const {
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
  } = useMyPageProfile()

  const {
    designs,
    favorites,
    scans,
    prints,
    isLoading,
    detailImage,
    openDetailImage,
    closeDetailImage,
    handleDetailLikeChange,
    handleDetailShareChange,
    handleDetailDeleted,
    isBusy,
    savedFolders,
    likeModalTarget,
    setLikeModalTarget,
    selectedFavoriteFolderId,
    setSelectedFavoriteFolderId,
    creatingFolder,
    newFolderNameInStrip,
    setNewFolderNameInStrip,
    isCreatingFolder,
    createFolderError,
    startCreatingFolderInStrip,
    cancelCreatingFolderInStrip,
    handleCreateFolderInStrip,
    likedKeySet,
    scanSessions,
    scanDetailSession,
    openScanDetail,
    closeScanDetail,
    printDetailOrder,
    printDetailScan,
    isLoadingPrintDetail,
    openPrintDetail,
    closePrintDetail,
    findFavoriteFolder,
    openMoveFolderModal,
    toggleLikeFromGrid,
    confirmLikeWithFolder,
    folderToDelete,
    folderDeleteError,
    openDeleteFolderModal,
    closeDeleteFolderModal,
    confirmDeleteFolder,
  } = useMyPageData()

  // 현재 URL 경로에서 활성 탭을 파생시킨다 — 예전엔 useState(section)로 관리했지만, 이제
  // 탭 자체가 서브라우트라 URL이 곧 탭 상태의 단일 소스다.
  const currentSection: SectionId = useMemo(() => {
    const seg = location.pathname.replace(/^\/mypage\/?/, '').split('/')[0]
    return (SECTION_IDS as readonly string[]).includes(seg) ? (seg as SectionId) : 'dashboard'
  }, [location.pathname])

  // ── 활동 타임라인 ──────
  const [selectedTimelineDate, setSelectedTimelineDate] = useState(todayKey)
  const [calendarOpen, setCalendarOpen] = useState(false)
  const [calendarViewMode, setCalendarViewMode] = useState<'days' | 'months'>('days')
  const [calendarMonth, setCalendarMonth] = useState(() => {
    const now = new Date()
    return { year: now.getFullYear(), month: now.getMonth() }
  })
  const calendarRef = useRef<HTMLDivElement | null>(null)
  const dayBodyRef = useRef<HTMLDivElement | null>(null)
  const timelineDateInitialized = useRef(false)
  const [hoveredActivityId, setHoveredActivityId] = useState<string | null>(null)
  const [pinnedActivityId, setPinnedActivityId] = useState<string | null>(null)
  const [listSortOrder, setListSortOrder] = useState<'newest' | 'oldest'>('newest')
  const [folderSortOrder, setFolderSortOrder] = useState<'name' | 'lastSaved'>('lastSaved')
  const [listPage, setListPage] = useState(1)
  const mainPanelRef = useRef<HTMLElement | null>(null)

  // ── 전체 활동 타임라인: 손 스캔 + 디자인 생성 + 네일팁 출력을 날짜별로 통합 ──────
  const timelineByDate = useMemo(() => {
    const map = new Map<string, TimelineDayGroup>()

    const ensure = (key: string) => {
      if (!map.has(key)) map.set(key, { scans: [], designs: [], prints: [] })
      return map.get(key)!
    }

    scanSessions.forEach((s) => ensure(dateKeyOf(s.scannedAt)).scans.push(s))
    designs.forEach((d) => ensure(dateKeyOf(d.createdAt)).designs.push(d))
    prints.forEach((p) => ensure(dateKeyOf(p.orderedAt)).prints.push(p))

    return map
  }, [scanSessions, designs, prints])

  const timelineActivityDates = useMemo(
      () => new Set(timelineByDate.keys()),
      [timelineByDate],
  )

  const hasAnyTimelineActivity = timelineActivityDates.size > 0

  useEffect(() => {
    if (timelineDateInitialized.current || isLoading) return
    timelineDateInitialized.current = true
    if (timelineActivityDates.size > 0) {
      const latest = [...timelineActivityDates].sort((a, b) => (a < b ? 1 : -1))[0]
      setSelectedTimelineDate(latest)
      const [y, m] = latest.split('-').map(Number)
      setCalendarMonth({ year: y, month: m - 1 })
    }
  }, [isLoading, timelineActivityDates])

  // 정렬 드롭다운(SortControl/FolderSortControl)은 각자 바깥 클릭 감지를 자체적으로
  // 처리하므로, 여기서는 날짜 선택 캘린더만 신경 쓰면 된다.
  useEffect(() => {
    if (!calendarOpen) return
    const onPointerDown = (e: MouseEvent) => {
      const target = e.target as Node
      if (!calendarRef.current?.contains(target)) {
        setCalendarOpen(false)
      }
    }
    document.addEventListener('mousedown', onPointerDown)
    return () => document.removeEventListener('mousedown', onPointerDown)
  }, [calendarOpen])

  useEffect(() => {
    setListPage(1)
  }, [currentSection, listSortOrder, folderSortOrder, selectedFavoriteFolderId])

  useEffect(() => {
    if (currentSection !== 'favorites') setSelectedFavoriteFolderId(null)
  }, [currentSection])

  useEffect(() => {
    mainPanelRef.current?.scrollTo({ top: 0, behavior: 'smooth' })
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }, [listPage, currentSection])

  useEffect(() => {
    setPinnedActivityId(null)
    setHoveredActivityId(null)
  }, [selectedTimelineDate])

  useEffect(() => {
    if (currentSection !== 'timeline') {
      setPinnedActivityId(null)
      setHoveredActivityId(null)
    }
  }, [currentSection])

  const selectedDayGroup = useMemo<TimelineDayGroup>(
      () => timelineByDate.get(selectedTimelineDate) ?? { scans: [], designs: [], prints: [] },
      [timelineByDate, selectedTimelineDate],
  )

  const timelineScansOldest = useMemo(
      () => [...selectedDayGroup.scans].sort((a, b) => compareByTime(a.scannedAt, b.scannedAt, 'oldest')),
      [selectedDayGroup.scans],
  )
  const timelinePrintsOldest = useMemo(
      () => [...selectedDayGroup.prints].sort((a, b) => compareByTime(a.orderedAt, b.orderedAt, 'oldest')),
      [selectedDayGroup.prints],
  )
  const timelineDesignsOldest = useMemo(
      () => [...selectedDayGroup.designs].sort((a, b) => compareByTime(a.createdAt, b.createdAt, 'oldest')),
      [selectedDayGroup.designs],
  )

  const sortedScanSessions = useMemo(
      () => [...scanSessions].sort((a, b) => compareByTime(a.scannedAt, b.scannedAt, listSortOrder)),
      [scanSessions, listSortOrder],
  )
  const sortedPrints = useMemo(
      () => [...prints].sort((a, b) => compareByTime(a.orderedAt, b.orderedAt, listSortOrder)),
      [prints, listSortOrder],
  )
  const sortedDesigns = useMemo(
      () => [...designs].sort((a, b) => compareByTime(a.createdAt, b.createdAt, listSortOrder)),
      [designs, listSortOrder],
  )
  const sortedFavorites = useMemo(
      () => [...favorites].sort((a, b) => compareByTime(a.savedAt, b.savedAt, listSortOrder)),
      [favorites, listSortOrder],
  )

  const dayEvents = useMemo<TimelineDayEvent[]>(() => {
    const events: TimelineDayEvent[] = [
      ...timelineScansOldest.map((s) => ({
        id: `scan-${s.key}`,
        kind: 'scan' as const,
        at: s.scannedAt,
        timeMs: parseDateFlexible(s.scannedAt)?.getTime() ?? 0,
      })),
      ...timelinePrintsOldest.map((p) => ({
        id: `print-${p.id}`,
        kind: 'print' as const,
        at: p.orderedAt,
        timeMs: parseDateFlexible(p.orderedAt)?.getTime() ?? 0,
      })),
      ...timelineDesignsOldest.map((d) => ({
        id: `design-${d.designId}-${d.imageUrl}`,
        kind: 'design' as const,
        at: d.createdAt,
        timeMs: parseDateFlexible(d.createdAt)?.getTime() ?? 0,
      })),
    ]
    return events.sort((a, b) => a.timeMs - b.timeMs)
  }, [timelineScansOldest, timelinePrintsOldest, timelineDesignsOldest])

  const dayTotalCount =
      selectedDayGroup.scans.length + selectedDayGroup.designs.length + selectedDayGroup.prints.length

  const activeActivityId = pinnedActivityId ?? hoveredActivityId

  const scrollToRightActivity = (id: string) => {
    const root = dayBodyRef.current
    if (!root) return
    const nodes = root.querySelectorAll<HTMLElement>('[data-activity-side="right"]')
    for (const el of nodes) {
      if (el.dataset.activityId === id) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' })
        break
      }
    }
  }

  const handleActivityHover = (id: string | null) => {
    if (pinnedActivityId) return
    setHoveredActivityId(id)
  }

  const handleActivitySelect = (id: string) => {
    setPinnedActivityId((prev) => {
      if (prev === id) {
        setHoveredActivityId(null)
        return null
      }
      return id
    })
    scrollToRightActivity(id)
  }

  const moveTimelineDate = (delta: number) => {
    const next = shiftDateKey(selectedTimelineDate, delta)
    if (next > todayKey()) return
    setSelectedTimelineDate(next)
    const [y, m] = next.split('-').map(Number)
    setCalendarMonth({ year: y, month: m - 1 })
  }

  const openTimelineCalendar = () => {
    const [y, m] = selectedTimelineDate.split('-').map(Number)
    setCalendarMonth({ year: y, month: m - 1 })
    setCalendarViewMode('days')
    setCalendarOpen((prev) => !prev)
  }

  const selectTimelineDate = (key: string) => {
    if (key > todayKey()) return
    setSelectedTimelineDate(key)
    setCalendarOpen(false)
  }

  // 오늘이 속한 달을 넘어서는(=미래) 달로는 이동할 수 없다 — 어차피 그 달의 날짜는
  // 전부 is-future로 막혀 있어서 고를 게 없기 때문.
  const isCurrentOrFutureMonth = (year: number, month: number) => {
    const now = new Date()
    return year > now.getFullYear() || (year === now.getFullYear() && month >= now.getMonth())
  }

  const shiftCalendarMonth = (delta: number) => {
    setCalendarMonth((prev) => {
      if (delta > 0 && isCurrentOrFutureMonth(prev.year, prev.month)) return prev
      const date = new Date(prev.year, prev.month + delta, 1)
      return { year: date.getFullYear(), month: date.getMonth() }
    })
  }

  const shiftCalendarYear = (delta: number) => {
    setCalendarMonth((prev) => {
      if (delta > 0 && prev.year >= new Date().getFullYear()) return prev
      return { ...prev, year: prev.year + delta }
    })
  }

  const selectCalendarMonth = (month: number) => {
    setCalendarMonth((prev) => ({ ...prev, month }))
    setCalendarViewMode('days')
  }

  const totalDesignCount = designs.length
  const totalScanCount = scanSessions.length
  const totalFavoriteCount = favorites.length
  const totalPrintCount = prints.length

  const getNavCount = (id: SectionId): number | null => {
    switch (id) {
      case 'scans':
        return totalScanCount || null
      case 'designs':
        return totalDesignCount || null
      case 'prints':
        return totalPrintCount || null
      case 'favorites':
        return totalFavoriteCount || null
      default:
        return null
    }
  }

  const pageSizeForSection = (id: SectionId) => (id === 'designs' || id === 'favorites' ? 12 : 10)

  const paginate = <T,>(items: T[], id: SectionId) => {
    const size = pageSizeForSection(id)
    const totalPages = Math.max(1, Math.ceil(items.length / size))
    const page = Math.min(listPage, totalPages)
    const start = (page - 1) * size
    return {
      page,
      totalPages,
      slice: items.slice(start, start + size),
      total: items.length,
    }
  }

  const sortedFolders = (() => {
    const list = [...savedFolders]
    if (folderSortOrder === 'name') {
      list.sort((a, b) => a.name.localeCompare(b.name, 'ko'))
    } else {
      list.sort((a, b) => {
        const ta = parseDateFlexible(a.lastSavedAt ?? '')?.getTime() ?? 0
        const tb = parseDateFlexible(b.lastSavedAt ?? '')?.getTime() ?? 0
        return tb - ta
      })
    }
    return list
  })()

  const ctx: MyPageContextValue = {
    navigate,
    currentSection,

    profile,
    isLoading,
    designs,
    favorites,
    scans,
    prints,
    savedFolders,
    scanSessions,
    likedKeySet,
    sortedScanSessions,
    sortedPrints,
    sortedDesigns,
    sortedFavorites,
    sortedFolders,
    totalScanCount,
    totalPrintCount,
    totalDesignCount,
    totalFavoriteCount,

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

    isBusy,
    selectedFavoriteFolderId,
    setSelectedFavoriteFolderId,
    creatingFolder,
    newFolderNameInStrip,
    setNewFolderNameInStrip,
    isCreatingFolder,
    createFolderError,
    startCreatingFolderInStrip,
    cancelCreatingFolderInStrip,
    handleCreateFolderInStrip,
    openDeleteFolderModal,
    findFavoriteFolder,
    openMoveFolderModal,
    toggleLikeFromGrid,
    openDetailImage,

    listSortOrder,
    setListSortOrder,
    folderSortOrder,
    setFolderSortOrder,
    listPage,
    setListPage,
    paginate,

    calendarRef,
    dayBodyRef,
    selectedTimelineDate,
    calendarOpen,
    calendarViewMode,
    calendarMonth,
    hasAnyTimelineActivity,
    timelineActivityDates,
    timelineScansOldest,
    timelinePrintsOldest,
    timelineDesignsOldest,
    dayEvents,
    dayTotalCount,
    activeActivityId,
    moveTimelineDate,
    openTimelineCalendar,
    selectTimelineDate,
    shiftCalendarMonth,
    shiftCalendarYear,
    setCalendarViewMode,
    selectCalendarMonth,
    isCurrentOrFutureMonth,
    handleActivityHover,
    handleActivitySelect,

    openScanDetail,
    openPrintDetail,
  }

  return (
      <AppShell mainClassName="mypage-x-page">
        <div className="mypage-x">
          {/* ── 왼쪽 사이드바 ───────────────────────────────────────── */}
          <aside className="mypage-x__sidebar">
            <div className="mypage-x__sidebar-profile">
              <div className="mypage-x__avatar" aria-hidden="true">
                {profile?.nickname.charAt(0) ?? '?'}
              </div>
              <div className="mypage-x__sidebar-profile-text">
                <p className="mypage-x__sidebar-name">{profile?.nickname ?? '-'}</p>
                <p className="mypage-x__sidebar-email">{profile?.email ?? '-'}</p>
              </div>
            </div>

            <nav className="mypage-x__nav" aria-label="마이페이지 메뉴">
              {NAV_GROUPS.map((group) => (
                  <div key={group.label} className="mypage-x__nav-group">
                    <p className="mypage-x__nav-group-label">{group.label}</p>
                    {group.items.map((item) => {
                      const count = getNavCount(item.id)
                      const path = `/mypage/${item.id}`
                      return (
                          <NavLink
                              key={item.id}
                              to={path}
                              className={({ isActive }) => `mypage-x__nav-item${isActive ? ' is-active' : ''}`}
                          >
                            {({ isActive }) => (
                                <>
                                  <span className="mypage-x__nav-icon" aria-hidden="true">{Icon[item.icon]}</span>
                                  <span className="mypage-x__nav-label">{item.label}</span>
                                  {count != null && (
                                      <span className="mypage-x__nav-badge">{count}</span>
                                  )}
                                  {isActive && (
                                      <span className="mypage-x__nav-chevron" aria-hidden="true">{Icon.chevron}</span>
                                  )}
                                </>
                            )}
                          </NavLink>
                      )
                    })}
                  </div>
              ))}
            </nav>

            <button type="button" className="mypage-x__logout" onClick={handleLogout}>
              <span aria-hidden="true">{Icon.logout}</span>
              로그아웃
            </button>
          </aside>

          {/* ── 메인 콘텐츠: 실제 탭 내용은 서브라우트(Outlet)가 그린다 ──────── */}
          <main className="mypage-x__main" ref={mainPanelRef}>
            <Outlet context={ctx} />
          </main>
        </div>

        <MyPageModals
            detailImage={detailImage}
            closeDetailImage={closeDetailImage}
            handleDetailLikeChange={handleDetailLikeChange}
            handleDetailShareChange={handleDetailShareChange}
            handleDetailDeleted={handleDetailDeleted}
            likeModalTarget={likeModalTarget}
            setLikeModalTarget={setLikeModalTarget}
            confirmLikeWithFolder={confirmLikeWithFolder}
            folderToDelete={folderToDelete}
            closeDeleteFolderModal={closeDeleteFolderModal}
            isBusy={isBusy}
            folderDeleteError={folderDeleteError}
            confirmDeleteFolder={confirmDeleteFolder}
            scanDetailSession={scanDetailSession}
            closeScanDetail={closeScanDetail}
            printDetailOrder={printDetailOrder}
            printDetailScan={printDetailScan}
            isLoadingPrintDetail={isLoadingPrintDetail}
            closePrintDetail={closePrintDetail}
        />
      </AppShell>
  )
}
