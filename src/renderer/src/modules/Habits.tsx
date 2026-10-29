import { useCallback, useEffect, useState } from 'react'
import { CalendarCheck, Check, Flame, Plus } from 'lucide-react'
import type { Habit, HabitsOverview } from '../../../shared/types'
import { isScheduled, scheduleLabel } from '../../../shared/habits'
import { errMsg } from '../lib/errors'
import { useRefreshOnCapture } from '../lib/dataChanged'
import { ProgressBar } from '../components/ProgressBar'
import { WeekStrip } from '../components/HabitViews'
import { PageHeader } from '../components/PageHeader'
import { EmptyState } from '../components/EmptyState'
import { HabitEditor } from './HabitEditor'

export function Habits() {
  const [overview, setOverview] = useState<HabitsOverview>({ today: '', habits: [] })
  const [loaded, setLoaded] = useState(false)
  const [editingId, setEditingId] = useState<number | 'new' | null>(null)
  const [showArchived, setShowArchived] = useState(false)
  const [error, setError] = useState('')
  const [busyKey, setBusyKey] = useState<string | null>(null) // "habitId:date" while a check-in is saving

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

  const restore = async (h: Habit) => {
    await window.api.habits.update(h.id, { name: h.name, notes: h.notes, days: h.days, archived: false })
    refresh()
  }

  const dueToday = active.filter((h) => isScheduled(h.days, today))
  const doneToday = dueToday.filter((h) => h.checkins.includes(today)).length

  return (
    <div className="page page-sm">
      <PageHeader title="Habits" subtitle={active.length === 0 ? 'Small things, done regularly.' : dueToday.length === 0 ? 'Nothing is scheduled today.' : `${doneToday} of ${dueToday.length} done today`}>
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
                  {doneToday === dueToday.length ? 'All done for today. Nicely done.' : `Today: ${doneToday} of ${dueToday.length} done`}
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

      {error && <p role="alert" className="mt-4 text-sm text-neg">{error}</p>}

      {loaded && habits.length === 0 && (
        <EmptyState icon={CalendarCheck} title="Small habits, checked off day by day, add up."
          text="Start with one you can do even on a bad day, then build the streak from there."
          action={<button className="btn-primary" onClick={() => setEditingId('new')}><Plus size={16} /> Add your first habit</button>} />
      )}

      <div className="mt-6 flex flex-col gap-3">
        {active.map((h) => {
          const done = h.checkins.includes(today)
          const scheduled = isScheduled(h.days, today)
          return (
            <article key={h.id} className={`card card-pad-sm flex items-center gap-4 ${scheduled || done ? '' : 'opacity-75'}`}>
              <button onClick={() => toggle(h, today)} aria-pressed={done} aria-busy={busyKey === `${h.id}:${today}`}
                aria-label={`${done ? 'Uncheck' : 'Check off'} ${h.name} for today`} className="check">
                <Check size={20} strokeWidth={3} />
              </button>
              <button onClick={() => setEditingId(h.id)} className="min-w-0 flex-1 text-left">
                <div className={`truncate font-medium ${done ? 'text-muted line-through decoration-muted/50' : ''}`}>{h.name}</div>
                <div className="mt-0.5 flex flex-wrap items-center gap-x-3 text-xs text-muted">
                  <span className="flex items-center gap-1">
                    <Flame size={13} className={h.stats.current > 0 ? 'warn' : ''} />
                    {h.stats.current} day streak
                  </span>
                  <span>{scheduled ? scheduleLabel(h.days) : `Rest day (${scheduleLabel(h.days)})`}</span>
                </div>
              </button>
              <WeekStrip habit={h} today={today} onToggle={(d) => toggle(h, d)} />
            </article>
          )
        })}
      </div>

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
