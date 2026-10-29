import { useEffect, useState } from 'react'
import { X } from 'lucide-react'
import type { Habit } from '../../../shared/types'
import { ALL_DAYS, WEEKDAYS_ONLY, WEEKDAY_NAMES } from '../../../shared/habits'
import { errMsg } from '../lib/errors'
import { HabitHeatmap } from '../components/HabitViews'

interface Props {
  habit: Habit | null // null = creating a new habit. Passed fresh after every check-in change.
  today: string
  onToggleDay: (date: string) => void // fix a past day from the history grid
  onSaved: () => void
  onClose: () => void
}

export function HabitEditor({ habit, today, onToggleDay, onSaved, onClose }: Props) {
  const [name, setName] = useState(habit?.name ?? '')
  const [notes, setNotes] = useState(habit?.notes ?? '')
  const [days, setDays] = useState<number[]>(habit?.days ?? ALL_DAYS)
  const [archived, setArchived] = useState(habit?.archived ?? false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [error, setError] = useState('')

  const save = async () => {
    if (!name.trim()) return setError('Give this habit a name, for example "Read 20 minutes".')
    if (days.length === 0) return setError('Pick at least one day of the week.')
    try {
      const input = { name, notes, days, archived }
      if (habit) await window.api.habits.update(habit.id, input)
      else await window.api.habits.create(input)
      onSaved()
    } catch (e) { setError(errMsg(e)) }
  }

  const remove = async () => {
    if (!habit) return
    await window.api.habits.remove(habit.id)
    onSaved()
  }

  const toggleWeekday = (d: number) => {
    setDays(days.includes(d) ? days.filter((x) => x !== d) : [...days, d].sort((a, b) => a - b))
    setError('')
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
      if (e.key === 'Enter' && e.ctrlKey) { e.preventDefault(); save() }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  const s = habit?.stats
  const stat = (label: string, value: string) => (
    <div className="rounded-xl border border-line bg-card p-3">
      <div className="text-lg font-semibold tabular-nums">{value}</div>
      <div className="text-xs text-muted">{label}</div>
    </div>
  )

  return (
    <div className="fixed inset-0 z-10 flex justify-end bg-black/40" onMouseDown={onClose}>
      <aside onMouseDown={(e) => e.stopPropagation()}
        className="flex h-full w-[min(34rem,100%)] flex-col gap-5 overflow-y-auto border-l border-line bg-panel p-6 shadow-card">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">{habit ? 'Edit habit' : 'New habit'}</h2>
          <button className="btn-icon" onClick={onClose} aria-label="Close"><X size={18} /></button>
        </div>

        <label className="text-xs text-muted">Name
          <input className="field mt-1" value={name} autoFocus placeholder="Read 20 minutes"
            onChange={(e) => { setName(e.target.value); setError('') }} />
        </label>

        <div>
          <div className="text-xs text-muted">Repeat on</div>
          <div className="mt-1 flex flex-wrap gap-2">
            {WEEKDAY_NAMES.map((n, i) => (
              <button key={n} onClick={() => toggleWeekday(i)} aria-pressed={days.includes(i)}
                className={`rounded-xl border px-3 py-1.5 text-sm ${days.includes(i) ? 'border-accent bg-accent/15' : 'border-line text-muted hover:text-fg'}`}>
                {n}
              </button>
            ))}
          </div>
          <div className="mt-2 flex gap-2">
            <button className="btn btn-sm" onClick={() => setDays(ALL_DAYS)}>Every day</button>
            <button className="btn btn-sm" onClick={() => setDays(WEEKDAYS_ONLY)}>Weekdays</button>
          </div>
        </div>

        <label className="flex min-h-[5rem] flex-col text-xs text-muted">Notes (optional)
          <textarea className="field mt-1 flex-1 resize-none leading-relaxed" value={notes}
            placeholder="Why does this matter to you?" onChange={(e) => setNotes(e.target.value)} />
        </label>

        {habit && s && (
          <section>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {stat('Current streak', String(s.current))}
              {stat('Best streak', String(s.best))}
              {stat('Last 30 days', s.rate30 === null ? '-' : `${Math.round(s.rate30)}%`)}
              {stat('Check-ins', String(s.total))}
            </div>
            <h3 className="mb-2 mt-5 text-sm font-medium">Last 12 weeks</h3>
            <HabitHeatmap habit={habit} today={today} onToggle={onToggleDay} />
            <p className="mt-2 text-xs text-muted">
              Click a square to fix a day. Streaks count scheduled days only, so rest days never break them.
            </p>
          </section>
        )}

        {habit && (
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={archived} onChange={(e) => setArchived(e.target.checked)} />
            Archive this habit (hide it from the daily list, keep its history)
          </label>
        )}

        {error && <p className="text-sm text-neg">{error}</p>}

        <div className="mt-auto flex items-center gap-2">
          {habit && !confirmDelete && <button className="btn text-neg" onClick={() => setConfirmDelete(true)}>Delete</button>}
          {habit && confirmDelete && (
            <>
              <button className="btn-danger" onClick={remove}>
                Delete habit{habit.checkins.length > 0 ? ` and ${habit.checkins.length} check-in${habit.checkins.length === 1 ? '' : 's'}` : ''}
              </button>
              <button className="btn" onClick={() => setConfirmDelete(false)}>Keep it</button>
            </>
          )}
          <span className="ml-auto text-xs text-muted">Ctrl+Enter to save</span>
          <button className="btn-primary" onClick={save}>Save habit</button>
        </div>
      </aside>
    </div>
  )
}
