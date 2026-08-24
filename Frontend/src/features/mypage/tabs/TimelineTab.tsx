import { PageHeader } from '@/features/mypage/components/PageHeader'
import { EmptyState } from '@/features/mypage/components/EmptyState'
import { ScanSessionRow } from '@/features/mypage/components/ScanSessionRow'
import { PrintOrderRow } from '@/features/mypage/components/PrintOrderRow'
import { ImageGrid } from '@/features/mypage/components/ImageGrid'
import { useMyPageContext } from '../context'
import { Icon, buildCalendarCells, formatNavDate, formatTimeHms, todayKey, type TimelineEventKind } from '../shared'

const eventKindMeta: Record<TimelineEventKind, { label: string; icon: keyof typeof Icon }> = {
  scan: { label: '손 촬영 · 분석', icon: 'hand' },
  print: { label: '네일팁 출력', icon: 'print' },
  design: { label: '디자인 생성', icon: 'design' },
}

export function TimelineTab() {
  const {
    profile,
    totalScanCount,
    totalPrintCount,
    totalDesignCount,
    listSortOrder,
    setListSortOrder,
    isLoading,
    hasAnyTimelineActivity,
    navigate,
    calendarRef,
    moveTimelineDate,
    selectedTimelineDate,
    calendarOpen,
    openTimelineCalendar,
    calendarViewMode,
    shiftCalendarMonth,
    shiftCalendarYear,
    setCalendarViewMode,
    calendarMonth,
    isCurrentOrFutureMonth,
    selectCalendarMonth,
    timelineActivityDates,
    selectTimelineDate,
    dayBodyRef,
    dayTotalCount,
    dayEvents,
    activeActivityId,
    handleActivityHover,
    handleActivitySelect,
    timelineScansOldest,
    openScanDetail,
    timelinePrintsOldest,
    openPrintDetail,
    timelineDesignsOldest,
    designs,
    likedKeySet,
    findFavoriteFolder,
    openDetailImage,
    openMoveFolderModal,
    toggleLikeFromGrid,
  } = useMyPageContext()

  return (
      <section className="mypage-x__panel">
        <PageHeader
            id="timeline"
            nickname={profile?.nickname}
            totalScanCount={totalScanCount}
            totalPrintCount={totalPrintCount}
            totalDesignCount={totalDesignCount}
            listSortOrder={listSortOrder}
            onChangeSort={setListSortOrder}
        />
        {isLoading ? (
            <p className="mypage-x__loading">불러오는 중...</p>
        ) : !hasAnyTimelineActivity ? (
            <EmptyState
                icon="timeline"
                title="아직 활동 기록이 없어요"
                description="손 스캔이나 디자인 생성을 시작하면 여기에 타임라인으로 모여요."
                actionLabel="손 스캔하기"
                onAction={() => navigate('/scan/hand')}
            />
        ) : (
            <div className="mypage-x__day-timeline">
              <div className="mypage-x__day-nav" ref={calendarRef}>
                <div className="mypage-x__day-nav-main">
                  <button
                      type="button"
                      className="mypage-x__day-nav-arrow"
                      onClick={() => moveTimelineDate(-1)}
                      aria-label="이전 날"
                  >
                    {Icon.chevronLeft}
                  </button>
                  <button
                      type="button"
                      className={`mypage-x__day-nav-date-btn${calendarOpen ? ' is-open' : ''}`}
                      onClick={openTimelineCalendar}
                      aria-label="날짜 선택"
                      aria-expanded={calendarOpen}
                  >
                    {formatNavDate(selectedTimelineDate)}
                  </button>
                  <button
                      type="button"
                      className="mypage-x__day-nav-arrow"
                      onClick={() => moveTimelineDate(1)}
                      disabled={selectedTimelineDate >= todayKey()}
                      aria-label="다음 날"
                  >
                    {Icon.chevronRight}
                  </button>
                </div>

                {calendarOpen && (
                    <div className="mypage-x__naily-cal" role="dialog" aria-label="날짜 선택 달력">
                      <div className="mypage-x__naily-cal-head">
                        <div className="mypage-x__naily-cal-month-nav">
                          <button
                              type="button"
                              className="mypage-x__naily-cal-month-btn"
                              onClick={() =>
                                  calendarViewMode === 'days' ? shiftCalendarMonth(-1) : shiftCalendarYear(-1)
                              }
                              aria-label={calendarViewMode === 'days' ? '이전 달' : '이전 연도'}
                          >
                            {Icon.chevronLeft}
                          </button>
                          <button
                              type="button"
                              className="mypage-x__naily-cal-month mypage-x__naily-cal-month--btn"
                              onClick={() => setCalendarViewMode(calendarViewMode === 'days' ? 'months' : 'days')}
                              aria-label="월 선택"
                          >
                            {calendarViewMode === 'days'
                                ? `${calendarMonth.year}년 ${calendarMonth.month + 1}월`
                                : `${calendarMonth.year}년`}
                          </button>
                          <button
                              type="button"
                              className="mypage-x__naily-cal-month-btn"
                              onClick={() =>
                                  calendarViewMode === 'days' ? shiftCalendarMonth(1) : shiftCalendarYear(1)
                              }
                              aria-label={calendarViewMode === 'days' ? '다음 달' : '다음 연도'}
                              disabled={
                                  calendarViewMode === 'days'
                                      ? isCurrentOrFutureMonth(calendarMonth.year, calendarMonth.month)
                                      : calendarMonth.year >= new Date().getFullYear()
                              }
                          >
                            {Icon.chevronRight}
                          </button>
                        </div>
                      </div>

                      {calendarViewMode === 'months' ? (
                          <div className="mypage-x__naily-cal-month-grid">
                            {Array.from({ length: 12 }, (_, month) => month).map((month) => {
                              const now = new Date()
                              const isFutureMonth =
                                  calendarMonth.year > now.getFullYear() ||
                                  (calendarMonth.year === now.getFullYear() && month > now.getMonth())
                              const isSelected = month === calendarMonth.month
                              return (
                                  <button
                                      key={month}
                                      type="button"
                                      className={[
                                        'mypage-x__naily-cal-month-cell',
                                        isSelected ? 'is-selected' : '',
                                      ].filter(Boolean).join(' ')}
                                      onClick={() => selectCalendarMonth(month)}
                                      disabled={isFutureMonth}
                                  >
                                    {month + 1}월
                                  </button>
                              )
                            })}
                          </div>
                      ) : (
                          <>
                            <div className="mypage-x__naily-cal-weekdays">
                              {['일', '월', '화', '수', '목', '금', '토'].map((w) => (
                                  <span key={w}>{w}</span>
                              ))}
                            </div>

                            <div className="mypage-x__naily-cal-grid">
                              {buildCalendarCells(calendarMonth.year, calendarMonth.month).map((cell, idx) => {
                                if (!cell) {
                                  return <span key={`empty-${idx}`} className="mypage-x__naily-cal-empty" />
                                }
                                const isSelected = cell.key === selectedTimelineDate
                                const isToday = cell.key === todayKey()
                                const hasActivity = timelineActivityDates.has(cell.key)
                                const isFuture = cell.key > todayKey()
                                return (
                                    <button
                                        key={cell.key}
                                        type="button"
                                        className={[
                                          'mypage-x__naily-cal-day',
                                          isSelected ? 'is-selected' : '',
                                          isToday ? 'is-today' : '',
                                          hasActivity ? 'has-activity' : '',
                                          isFuture ? 'is-future' : '',
                                        ].filter(Boolean).join(' ')}
                                        onClick={() => selectTimelineDate(cell.key)}
                                        disabled={isFuture}
                                    >
                                      {cell.day}
                                      {hasActivity && <i aria-hidden="true" />}
                                    </button>
                                )
                              })}
                            </div>
                          </>
                      )}

                      <div className="mypage-x__naily-cal-footer">
                        <button
                            type="button"
                            className="mypage-x__naily-cal-today"
                            onClick={() => selectTimelineDate(todayKey())}
                        >
                          오늘로 이동
                        </button>
                      </div>
                    </div>
                )}
              </div>

              <div className="mypage-x__day-body" ref={dayBodyRef}>
                <aside className="mypage-x__day-rail">
                  <div className="mypage-x__day-rail-head">
                    <p className="mypage-x__day-rail-title">하루 활동 타임라인</p>
                    <span>{dayTotalCount}건</span>
                  </div>
                  {dayEvents.length === 0 ? (
                      <p className="mypage-x__day-overview-empty">이 날에는 아직 활동이 없어요.</p>
                  ) : (
                      <div className="mypage-x__day-rail-list" role="list">
                        {dayEvents.map((event) => {
                          const meta = eventKindMeta[event.kind]
                          const timeLabel = formatTimeHms(event.at)
                          const highlighted = activeActivityId === event.id
                          return (
                              <button
                                  key={event.id}
                                  type="button"
                                  data-activity-id={event.id}
                                  data-activity-side="left"
                                  className={`mypage-x__day-rail-item mypage-x__day-rail-item--${event.kind}${highlighted ? ' is-highlighted' : ''}`}
                                  onMouseEnter={() => handleActivityHover(event.id)}
                                  onMouseLeave={() => handleActivityHover(null)}
                                  onClick={() => handleActivitySelect(event.id)}
                              >
                                <div className="mypage-x__day-rail-marker" aria-hidden="true">
                                  <span className="mypage-x__day-rail-dot" />
                                </div>
                                <div className="mypage-x__day-rail-content">
                                  {timeLabel && (
                                      <p className="mypage-x__day-rail-time">{timeLabel}</p>
                                  )}
                                  <p className="mypage-x__day-rail-label">
                                    <span className="mypage-x__day-rail-icon">{Icon[meta.icon]}</span>
                                    {meta.label}
                                  </p>
                                </div>
                              </button>
                          )
                        })}
                      </div>
                  )}
                </aside>

                <div className="mypage-x__day-sections">
                  <div className="mypage-x__timeline-block mypage-x__timeline-block--scan">
                    <p className="mypage-x__timeline-block-title">
                      {Icon.hand} 손 촬영 · 분석 <span>{timelineScansOldest.length}건</span>
                    </p>
                    {timelineScansOldest.length === 0 ? (
                        <p className="mypage-x__day-section-empty">이 날의 손 분석 기록이 없어요.</p>
                    ) : (
                        <div className="mypage-x__scan-list">
                          {timelineScansOldest.map((session) => (
                              <ScanSessionRow
                                  key={session.key}
                                  session={session}
                                  activityId={`scan-${session.key}`}
                                  interactive
                                  activeActivityId={activeActivityId}
                                  onOpenDetail={openScanDetail}
                                  onSelectActivity={handleActivitySelect}
                                  onHoverActivity={handleActivityHover}
                              />
                          ))}
                        </div>
                    )}
                  </div>

                  <div className="mypage-x__timeline-block mypage-x__timeline-block--print">
                    <p className="mypage-x__timeline-block-title">
                      {Icon.print} 네일팁 출력 <span>{timelinePrintsOldest.length}건</span>
                    </p>
                    {timelinePrintsOldest.length === 0 ? (
                        <p className="mypage-x__day-section-empty">이 날의 네일팁 출력 기록이 없어요.</p>
                    ) : (
                        <div className="mypage-x__print-list">
                          {timelinePrintsOldest.map((order) => (
                              <PrintOrderRow
                                  key={order.id}
                                  order={order}
                                  activityId={`print-${order.id}`}
                                  interactive
                                  activeActivityId={activeActivityId}
                                  onOpenDetail={openPrintDetail}
                                  onSelectActivity={handleActivitySelect}
                                  onHoverActivity={handleActivityHover}
                              />
                          ))}
                        </div>
                    )}
                  </div>

                  <div className="mypage-x__timeline-block mypage-x__timeline-block--design">
                    <p className="mypage-x__timeline-block-title">
                      {Icon.design} 디자인 생성 <span>{timelineDesignsOldest.length}건</span>
                    </p>
                    {timelineDesignsOldest.length === 0 ? (
                        <p className="mypage-x__day-section-empty">이 날의 디자인 생성 기록이 없어요.</p>
                    ) : (
                        <ImageGrid
                            items={timelineDesignsOldest}
                            isFavoriteView={false}
                            options={{
                              dateMode: 'time',
                              interactive: true,
                              getActivityId: (item) => `design-${item.designId}-${item.imageUrl}`,
                            }}
                            designs={designs}
                            likedKeySet={likedKeySet}
                            activeActivityId={activeActivityId}
                            findFavoriteFolder={findFavoriteFolder}
                            onHoverActivity={handleActivityHover}
                            onSelectActivity={handleActivitySelect}
                            onOpenDetailImage={openDetailImage}
                            onMoveFolder={openMoveFolderModal}
                            onToggleLike={toggleLikeFromGrid}
                            navigate={navigate}
                        />
                    )}
                  </div>
                </div>
              </div>
            </div>
        )}
      </section>
  )
}
