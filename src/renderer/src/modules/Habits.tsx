import { useCallback, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { Bell, CalendarCheck, Check, ChevronLeft, ChevronRight, Clock, Flame, GripVertical, Plus } from 'lucide-react'
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent
} from '@dnd-kit/core'
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import type { Habit, HabitsOverview } from '../../../shared/types'
import {
  calculateBestStreak,
  calculateCurrentStreak,
  cleanTimeOfDay,
  completionRateOrNull,
  groupByTimeOfDay,
  isHabitDue,
  isPerfectWeek,
  loggedValue,
  progressText,
  scheduleLabel,
  shiftWeek,
  storedStatusFor,
  TIME_OF_DAY_LABELS,
  weekDays,
  weekLabel,
  weekProgress,
  weekStart
} from '../../../shared/habits'
import type { DayChoice } from '../../../shared/habits'
import { errMsg } from '../lib/errors'
import { useRefreshOnCapture } from '../lib/dataChanged'
import { ProgressBar } from '../components/ProgressBar'
import { MilestoneBadge, PerfectWeekMark, WeekStrip, completionState, habitCompletions } from '../components/HabitViews'
import { LogValuePopover } from '../components/LogValuePopover'
import { DayStatusPopover } from '../components/DayStatusPopover'
import { PageHeader } from '../components/PageHeader'
import { EmptyState } from '../components/EmptyState'
import { HabitEditor } from './HabitEditor'
import { formatDate } from '../lib/dates'

// Which day the popover is open for: the habit, the day and the dot that was clicked.
interface OpenPopover {
  habitId: number
  date: string
  anchor: HTMLElement | null
}

// The number menu is open for: the habit, the day and the circle that was clicked.
interface OpenValuePopover {
  habitId: number
  date: string
  anchor: HTMLElement | null
}

export function Habits() {
  const [overview, setOverview] = useState<HabitsOverview>({ today: '', habits: [] })
  const [loaded, setLoaded] = useState(false)
  const [editingId, setEditingId] = useState<number | 'new' | null>(null)
  const [showArchived, setShowArchived] = useState(false)
  const [error, setError] = useState('')
  const [busyKey, setBusyKey] = useState<string | null>(null) // "habitId:date" while a check-in is saving
  // The week being shown. null means "the week that holds today".
  const [shownWeek, setShownWeek] = useState<string | null>(null)
  // The day whose popover is open, if any.
  const [openPopover, setOpenPopover] = useState<OpenPopover | null>(null)
  // The number menu that is open, if any.
  const [openValue, setOpenValue] = useState<OpenValuePopover | null>(null)
  // Whether the list is grouped by time of day (Morning, Afternoon, Evening,
  // Anytime). Off by default, so the plain list the user knows is untouched.
  const [groupByTime, setGroupByTime] = useState(false)

  const refresh = useCallback(async () => {
    setOverview(await window.api.habits.list())
    setLoaded(true)
  }, [])
  useEffect(() => { refresh() }, [refresh])
  useRefreshOnCapture(refresh) // something was saved from the Quick capture window

  // Coming back to the window (maybe the next day) shows the right "today".
  useEffect(() => {
    window.addEventListener('focus', refresh)
    return () => window.removeEventListener('focus', refresh)
  }, [refresh])

  // Ctrl+N starts a new habit.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.key.toLowerCase() === 'n') { e.preventDefault(); setEditingId('new') }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const { today, habits } = overview
  const active = habits.filter((h) => !h.archived)
  const archived = habits.filter((h) => h.archived)
  const editing = typeof editingId === 'number' ? habits.find((h) => h.id === editingId) ?? null : null

  // The week on screen. It is the week that holds today, unless the user moved it.
  const currentWeek = today ? weekStart(today) : ''
  const shown = shownWeek ?? currentWeek
  const isThisWeek = shown === currentWeek
  const shownDays = useMemo(() => (shown ? weekDays(shown) : []), [shown])

  const toggle = async (h: Habit, date: string) => {
    const key = `${h.id}:${date}`
    setBusyKey(key)
    try {
      await window.api.habits.setCheckin(h.id, date, !h.checkins.includes(date))
      setError('')
      await refresh()
    } catch (e) { setError(errMsg(e)) }
    setBusyKey(null)
  }

  // Changes one day from the popover. The list is reloaded afterwards, so the
  // streak and the header are up to date straight away.
  const chooseDay = async (h: Habit, date: string, choice: DayChoice) => {
    const key = `${h.id}:${date}`
    setBusyKey(key)
    try {
      await window.api.habits.setDayStatus(h.id, date, storedStatusFor(choice))
      setError('')
      setOpenPopover(null)
      await refresh()
    } catch (e) { setError(errMsg(e)) }
    setBusyKey(null)
  }

  // Saves the number that was typed for a 'count' or 'duration' habit.
  const saveValue = async (h: Habit, date: string, value: number) => {
    const key = `${h.id}:${date}`
    setBusyKey(key)
    try {
      await window.api.habits.logValue(h.id, date, value)
      setError('')
      setOpenValue(null)
      await refresh()
    } catch (e) { setError(errMsg(e)) }
    setBusyKey(null)
  }

  const restore = async (h: Habit) => {
    await window.api.habits.update(h.id, { name: h.name, notes: h.notes, days: h.days, archived: false })
    refresh()
  }

  // Drag-and-drop: a short move starts a drag, so a plain click is never one,
  // and the keyboard can reorder too (focus the grip, hold Space, arrow keys).
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  )

  // Saves a new order of the ACTIVE habits. The list is re-ordered on screen
  // straight away, so it does not jump back while the database catches up.
  const saveOrder = async (ordered: Habit[]) => {
    setOverview((prev) => ({ ...prev, habits: [...ordered, ...prev.habits.filter((h) => h.archived)] }))
    try {
      await window.api.habits.reorder(ordered.map((h) => h.id))
      setError('')
    } catch (e) { setError(errMsg(e)) }
    await refresh()
  }

  // A drop ends a drag and reorders the list. With grouping on, a habit can
  // only move within its own time-of-day group, so Morning stays with Morning.
  const onDragEnd = (event: DragEndEvent) => {
    const { active: drag, over } = event
    if (!over || drag.id === over.id) return
    const from = active.findIndex((h) => h.id === drag.id)
    const to = active.findIndex((h) => h.id === over.id)
    if (from < 0 || to < 0) return
    if (groupByTime && cleanTimeOfDay(active[from].timeOfDay) !== cleanTimeOfDay(active[to].timeOfDay)) return
    void saveOrder(arrayMove(active, from, to))
  }

  // Only habits that are actually DUE today count towards the header.
  // A habit that is resting today is dimmed and labelled instead of being
  // silently counted as "not done".
  const dueToday = active.filter((h) => isHabitDue(h, today))
  // A habit counts as done today when its day is done, which for a count or
  // duration habit means the target was reached.
  const doneToday = dueToday.filter((h) => completionState(h, habitCompletions(h), today, today) === 'done').length

  // The habit whose popover is open, and the state of that day.
  const popoverHabit = openPopover ? habits.find((h) => h.id === openPopover.habitId) ?? null : null
  const popoverStatus = popoverHabit && openPopover
    ? completionState(popoverHabit, habitCompletions(popoverHabit), openPopover.date, today)
    : null
  // The habit whose number menu is open.
  const valueHabit = openValue ? habits.find((h) => h.id === openValue.habitId) ?? null : null

  // One habit row. The content is the same as it always was (circle, name,
  // week dots); SortableHabitRow only adds the grip and the drag behaviour.
  const renderRow = (h: Habit) => {
    // A habit is due today when its schedule says so. On a rest day it
    // cannot be checked off, so the circle is disabled and the row is dimmed.
    const due = isHabitDue(h, today)
    // The stats come from the shared rules, so the numbers on the row
    // always match the dots and the header.
    const completions = habitCompletions(h)
    // The day is done when the target was reached (a plain check habit is
    // done as soon as it is ticked).
    const done = completionState(h, completions, today, today) === 'done'
    const streak = calculateCurrentStreak(h, completions, today)
    const best = calculateBestStreak(h, completions, today)
    const rate30 = completionRateOrNull(h, completions, 30, today)
    // The perfect-week mark is about the week on screen, not always this week.
    const perfect = isPerfectWeek(h, completions, shown, today)
    const progress = weekProgress(h, completions, shown, today)
    // A 'count' or 'duration' habit needs a number, so its circle opens
    // the number menu instead of ticking straight away.
    const needsValue = (h.type ?? 'check') !== 'check'
    // What was logged today, shown as "6 / 10 min" on the row.
    const todayCompletion = completions.find((c) => c.date === today)
    const logged = progressText(h, todayCompletion)
    // Which time-of-day group the row belongs to (only matters when grouping).
    const section = groupByTime ? cleanTimeOfDay(h.timeOfDay) : 'all'
    return (
      <SortableHabitRow key={h.id} habit={h} dimmed={!due} section={section}>
        <button
          onClick={(e) => {
            // A count/duration habit opens the number menu.
            if (needsValue) {
              setOpenValue({ habitId: h.id, date: today, anchor: e.currentTarget })
              return
            }
            toggle(h, today)
          }}
          aria-pressed={done} aria-busy={busyKey === `${h.id}:${today}`}
          disabled={!due}
          aria-label={due
            ? needsValue
              ? `Log ${h.name} for today`
              : `${done ? 'Uncheck' : 'Check off'} ${h.name} for today`
            : `${h.name} is not scheduled today (rest day)`}
          className="check">
          <Check size={20} strokeWidth={3} />
        </button>
        <button onClick={() => setEditingId(h.id)} className="min-w-0 flex-1 text-left">
          <div className={`truncate font-medium ${done ? 'text-muted line-through decoration-muted/50' : ''}`}>{h.name}</div>
          <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
            <span className="flex items-center gap-1">
              <Flame size={13} className={streak > 0 ? 'warn' : ''} />
              {streak} day streak
            </span>
            <span>Best: {best}</span>
            <span>{rate30 === null ? 'No days due yet' : `${Math.round(rate30)}% over 30 days`}</span>
            {/* The progress of a count/duration habit, like "6 / 10 min". */}
            {logged && <span className="tabular-nums">{logged}</span>}
            {/* A reminder set on this habit, shown as "08:30" with a bell. */}
            {h.reminderTime && (
              <span className="inline-flex items-center gap-1" aria-label={`Reminder at ${h.reminderTime}`}>
                <Bell size={12} />{h.reminderTime}
              </span>
            )}
            {due
              ? <span>{scheduleLabel(h.days)}</span>
              : <span className="inline-flex items-center gap-1 rounded-full border border-line px-1.5 py-px text-[10px] uppercase tracking-wide">
                Rest day
              </span>}
          </div>
          {/* The milestone and the perfect-week mark. Both are optional, so a
              habit that has not earned one simply shows nothing here. */}
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <MilestoneBadge streak={streak} />
            {perfect && (
              <PerfectWeekMark label={`${progress.done} of ${progress.due} days done`} />
            )}
          </div>
        </button>
        {/* The dots open the day menu. Only today is checked off with the big circle. */}
        <div className="relative">
          <WeekStrip
            habit={h}
            today={today}
            weekStart={shown}
            onDayClick={(d, element) => setOpenPopover(
              openPopover?.habitId === h.id && openPopover.date === d ? null : { habitId: h.id, date: d, anchor: element }
            )}
          />
        </div>
      </SortableHabitRow>
    )
  }

  return (
    <div className="page page-sm">
      <PageHeader title="Habits" subtitle={active.length === 0 ? 'Small things, done regularly.' : dueToday.length === 0 ? 'Nothing is scheduled today.' : `${doneToday} of ${dueToday.length} due today`}>
        <button className="btn-primary" onClick={() => setEditingId('new')} title="Ctrl+N">
          <Plus size={16} /> New habit
        </button>
      </PageHeader>

      {active.length > 0 && (
        <div className="card card-pad">
          {dueToday.length > 0 ? (
            <>
              <div className="flex items-baseline justify-between">
                <div className="text-sm font-medium">
                  {doneToday === dueToday.length ? 'All done for today. Nicely done.' : `Today: ${doneToday} of ${dueToday.length} due`}
                </div>
                <div className="text-xs tabular-nums text-muted">{Math.round((doneToday / dueToday.length) * 100)}%</div>
              </div>
              <div className="mt-3"><ProgressBar percent={(doneToday / dueToday.length) * 100} /></div>
            </>
          ) : (
            <div className="text-sm font-medium">Nothing is scheduled today. Enjoy the rest day.</div>
          )}
        </div>
      )}

      {active.length > 0 && (
        <div className="mt-6 flex items-center justify-between gap-3">
          <div className="flex items-center gap-1">
            <button className="btn-icon" onClick={() => setShownWeek(shiftWeek(shown, -1))}
              aria-label="Previous week" title="Previous week">
              <ChevronLeft size={16} />
            </button>
            <button className="btn-icon" onClick={() => setShownWeek(shiftWeek(shown, 1))}
              aria-label="Next week" title="Next week" disabled={isThisWeek}>
              <ChevronRight size={16} />
            </button>
            <span className="ml-1 text-sm font-medium tabular-nums" aria-live="polite">{weekLabel(shown)}</span>
          </div>
          <div className="flex items-center gap-2">
            {!isThisWeek && (
              <button className="btn btn-sm" onClick={() => setShownWeek(null)}>This week</button>
            )}
            {/* Groups the list into Morning / Afternoon / Evening / Anytime. */}
            <button className="btn btn-sm" onClick={() => setGroupByTime(!groupByTime)}
              aria-pressed={groupByTime}
              title={groupByTime ? 'Show one flat list' : 'Group the list by time of day'}>
              <Clock size={14} /> {groupByTime ? 'Show one list' : 'Group by time'}
            </button>
          </div>
        </div>
      )}

      {error && <p role="alert" className="mt-4 text-sm text-neg">{error}</p>}

      {loaded && habits.length === 0 && (
        <EmptyState icon={CalendarCheck} title="Small habits, checked off day by day, add up."
          text="Start with one you can do even on a bad day, then build the streak from there."
          action={<button className="btn-primary" onClick={() => setEditingId('new')}><Plus size={16} /> Add your first habit</button>} />
      )}

      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
        {groupByTime ? (
          // Grouped: one section per time of day that has habits. Dragging is
          // limited to inside a group (see onDragEnd).
          groupByTimeOfDay(active).map((group) => (
            <section key={group.timeOfDay} className="mt-4" aria-label={group.label}>
              <h2 className="mb-2 text-xs font-medium uppercase tracking-wide text-muted">{group.label}</h2>
              <SortableContext items={group.habits.map((h) => h.id)} strategy={verticalListSortingStrategy}>
                <div className="flex flex-col gap-3">
                  {group.habits.map(renderRow)}
                </div>
              </SortableContext>
            </section>
          ))
        ) : (
          // Flat: one list in the manual order, every row draggable.
          <div className="mt-4 flex flex-col gap-3">
            <SortableContext items={active.map((h) => h.id)} strategy={verticalListSortingStrategy}>
              {active.map(renderRow)}
            </SortableContext>
          </div>
        )}
      </DndContext>

      {shownDays.length > 0 && !isThisWeek && (
        <p className="mt-3 text-xs text-muted">
          Showing {weekLabel(shown)}. Days you can still change are the ones that have already happened.
        </p>
      )}

      {openPopover && popoverHabit && popoverStatus && (
        <DayStatusPopover
          habitName={popoverHabit.name}
          dateLabel={formatDate(openPopover.date)}
          status={popoverStatus}
          anchor={openPopover.anchor}
          onChoose={(choice) => popoverHabit && chooseDay(popoverHabit, openPopover.date, choice)}
          onClose={() => setOpenPopover(null)}
        />
      )}

      {/* The number menu for a 'count' or 'duration' habit. */}
      {openValue && valueHabit && (
        <LogValuePopover
          habitName={valueHabit.name}
          dateLabel={formatDate(openValue.date)}
          type={valueHabit.type ?? 'check'}
          unit={valueHabit.unit ?? ''}
          target={valueHabit.target ?? null}
          value={loggedValue(habitCompletions(valueHabit).find((c) => c.date === openValue.date))}
          anchor={openValue.anchor}
          onSave={(value) => saveValue(valueHabit, openValue.date, value)}
          onClose={() => setOpenValue(null)}
        />
      )}

      {archived.length > 0 && (
        <div className="mt-8">
          <button className="text-sm text-muted hover:text-fg" onClick={() => setShowArchived(!showArchived)} aria-expanded={showArchived}>
            {showArchived ? 'Hide' : 'Show'} archived ({archived.length})
          </button>
          {showArchived && (
            <div className="mt-3 flex flex-col gap-2">
              {archived.map((h) => (
                <div key={h.id} className="card flex items-center justify-between px-4 py-3 opacity-80">
                  <button className="min-w-0 truncate text-left text-sm text-muted hover:text-fg" onClick={() => setEditingId(h.id)}>
                    {h.name} <span className="text-xs">({h.stats.total} check-ins)</span>
                  </button>
                  <button className="btn btn-sm" onClick={() => restore(h)}>Restore</button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {editingId !== null && (editingId === 'new' || editing) && (
        <HabitEditor key={`editor-${editingId}`} habit={editingId === 'new' ? null : editing} today={today}
          onToggleDay={(d) => editing && toggle(editing, d)}
          onClose={() => setEditingId(null)}
          onSaved={() => { setEditingId(null); refresh() }} />
      )}
    </div>
  )
}

// One habit card that can be dragged by its grip handle.
// The grip is its own button so dragging never fights with the check circle
// or the week dots, and it is keyboard-reachable (Space to pick up, arrows to
// move, Space to drop).
function SortableHabitRow({ habit, dimmed, section, children }: {
  habit: Habit
  dimmed: boolean
  section: string // which time-of-day group the row belongs to ('all' when ungrouped)
  children: ReactNode
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: habit.id,
    data: { section }
  })
  return (
    <article ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      className={`card card-pad-sm flex items-center gap-4 ${dimmed ? 'opacity-60' : ''} ${isDragging ? 'relative z-10 opacity-90' : ''}`}>
      <button {...attributes} {...listeners}
        aria-label={`Reorder ${habit.name}`} title="Drag to reorder"
        className="btn-icon shrink-0 cursor-grab touch-none text-muted hover:text-fg">
        <GripVertical size={16} />
      </button>
      {children}
    </article>
  )
}
