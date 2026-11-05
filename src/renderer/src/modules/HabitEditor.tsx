import { useEffect, useState } from 'react'
import { X } from 'lucide-react'
import type { AutoCompleteOn, Habit, HabitType, TimeOfDay } from '../../../shared/types'
import {
  ALL_DAYS,
  completionRateOrNull,
  defaultTarget,
  defaultUnit,
  guessHabitTarget,
  guessHabitType,
  HABIT_TYPE_LABELS,
  TIME_OF_DAY_LABELS,
  TIME_OF_DAY_ORDER,
  WEEKDAYS_ONLY,
  WEEKDAY_NAMES
} from '../../../shared/habits'
import { errMsg } from '../lib/errors'
import { noteUndoableDelete } from '../lib/undo'
import { HabitHeatmap, habitCompletions } from '../components/HabitViews'

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
  // The kind of habit. An existing habit keeps its type; a new one starts as
  // a plain check habit and is guessed from the name as you type.
  const [type, setType] = useState<HabitType>(habit?.type ?? 'check')
  // How much is enough, for 'count' and 'duration' habits.
  const [target, setTarget] = useState<string>(habit?.target != null ? String(habit.target) : '')
  // The label for that number ("sessions", "min", ...).
  const [unit, setUnit] = useState<string>(habit?.unit ?? '')
  // When in the day the habit belongs to. Used by the "group by time" toggle
  // on the Habits page; a habit without one is an 'anytime' habit.
  const [timeOfDay, setTimeOfDay] = useState<TimeOfDay>(habit?.timeOfDay ?? 'anytime')
  // A daily reminder, "HH:MM" in 24-hour time, or null for none.
  const [reminderTime, setReminderTime] = useState<string | null>(habit?.reminderTime ?? null)
  // The Logbook link: writing an entry that day ticks this habit off (if due).
  const [autoComplete, setAutoComplete] = useState(habit?.autoCompleteOn === 'logbook-entry')
  // True while the user is typing the name of a NEW habit, so the type is
  // guessed from it. Once they pick a type by hand, it stays as they chose.
  const [typePicked, setTypePicked] = useState(habit !== null)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [error, setError] = useState('')

  // As the name of a new habit changes, the type and target follow it, so
  // "Read for 10mn" starts life as a duration habit of 10 minutes.
  const onNameChange = (text: string) => {
    setName(text)
    setError('')
    if (typePicked) return
    const guessedType = guessHabitType(text)
    const guessed = guessHabitTarget(text)
    setType(guessedType)
    if (guessed.target !== null) {
      setTarget(String(guessed.target))
      setUnit(guessed.unit)
    } else if (guessedType === 'check') {
      setTarget('')
      setUnit('')
    } else {
      // The name says "duration" but not how long: offer a sensible default.
      setTarget(target || String(defaultTarget(guessedType) ?? ''))
      setUnit(unit || defaultUnit(guessedType))
    }
  }

  // Picking a type by hand sets the target and unit to sensible defaults.
  const pickType = (next: HabitType) => {
    setType(next)
    setTypePicked(true)
    if (next === 'check') {
      setTarget('')
      setUnit('')
      return
    }
    setTarget(target || String(defaultTarget(next) ?? ''))
    setUnit(unit || defaultUnit(next))
  }

  const save = async () => {
    if (!name.trim()) return setError('Give this habit a name, for example "Read 20 minutes".')
    if (days.length === 0) return setError('Pick at least one day of the week.')
    // A count or duration habit needs to know how much is enough.
    const number = Number(target)
    if (type !== 'check' && (!isFinite(number) || number <= 0)) {
      return setError('Say how much is enough, for example 10.')
    }
    try {
      const input = {
        name, notes, days, archived,
        type,
        target: type === 'check' ? null : number,
        unit: type === 'check' ? '' : unit.trim() || defaultUnit(type),
        timeOfDay,
        reminderTime,
        autoCompleteOn: (autoComplete ? 'logbook-entry' : '') as AutoCompleteOn
      }
      if (habit) await window.api.habits.update(habit.id, input)
      else await window.api.habits.create(input)
      onSaved()
    } catch (e) { setError(errMsg(e)) }
  }

  const remove = async () => {
    if (!habit) return
    const batchId = await window.api.habits.remove(habit.id)
    if (batchId) noteUndoableDelete({ label: `habit "${habit.name}"`, batchId })
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
    <div className="scrim fixed inset-0 z-10 flex justify-end" onMouseDown={onClose}>
      <aside onMouseDown={(e) => e.stopPropagation()}
        className="flex h-full w-[min(34rem,100%)] flex-col gap-5 overflow-y-auto border-l border-line bg-panel p-6 shadow-card">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">{habit ? 'Edit habit' : 'New habit'}</h2>
          <button className="btn-icon" onClick={onClose} aria-label="Close"><X size={18} /></button>
        </div>

        <label className="text-xs text-muted">Name
          <input className="field mt-1" value={name} autoFocus placeholder="Read 20 minutes"
            onChange={(e) => onNameChange(e.target.value)} />
        </label>

        {/* What kind of habit is it? A new habit works this out from the name,
            and you can always change it by hand. */}
        <div>
          <div className="text-xs text-muted">How do you track it?</div>
          <div className="mt-1 flex flex-wrap gap-2">
            {(['check', 'count', 'duration'] as HabitType[]).map((t) => (
              <button key={t} onClick={() => pickType(t)} aria-pressed={type === t}
                className={`rounded-xl border px-3 py-1.5 text-sm ${type === t ? 'border-accent bg-accent/15' : 'border-line text-muted hover:text-fg'}`}>
                {HABIT_TYPE_LABELS[t]}
              </button>
            ))}
          </div>
          {type === 'check' && (
            <p className="mt-1 text-xs text-muted">Just tick it off on the days you do it.</p>
          )}
        </div>

        {/* How much is enough? Only for a count or a duration habit. */}
        {type !== 'check' && (
          <div className="flex gap-2">
            <label className="flex-1 text-xs text-muted">How much is enough?
              <input className="field mt-1" type="number" min={0} step="any" value={target}
                aria-label="Target amount"
                onChange={(e) => { setTarget(e.target.value); setError('') }} />
            </label>
            <label className="w-32 text-xs text-muted">Unit
              <input className="field mt-1" value={unit} placeholder={defaultUnit(type)}
                aria-label="Unit" onChange={(e) => setUnit(e.target.value)} />
            </label>
          </div>
        )}

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

        {/* When in the day the habit belongs to. This only decides which
            group the habit sits in when the list is grouped by time of day. */}
        <div>
          <div className="text-xs text-muted">When do you do it?</div>
          <div className="mt-1 flex flex-wrap gap-2">
            {TIME_OF_DAY_ORDER.map((t) => (
              <button key={t} onClick={() => setTimeOfDay(t)} aria-pressed={timeOfDay === t}
                className={`rounded-xl border px-3 py-1.5 text-sm ${timeOfDay === t ? 'border-accent bg-accent/15' : 'border-line text-muted hover:text-fg'}`}>
                {TIME_OF_DAY_LABELS[t]}
              </button>
            ))}
          </div>
        </div>

        {/* Reminders and cross-module links. The reminder means a desktop
            notification while the app is running; the Logbook link means a
            written entry counts as doing the habit on that day. */}
        <div>
          <div className="text-xs text-muted">Remind me at (optional)</div>
          <input className="field mt-1 w-40" type="time" value={reminderTime ?? ''} aria-label="Reminder time"
            onChange={(e) => setReminderTime(e.target.value || null)} />
          <label className="mt-2 flex items-center gap-2 text-sm" title="Writing a Logbook entry on one of this habit's days marks it done">
            <input type="checkbox" checked={autoComplete} onChange={(e) => setAutoComplete(e.target.checked)}
              aria-label="Auto-complete when a Logbook entry is written" />
            Auto-complete when I write a Logbook entry
          </label>
          <p className="mt-1 text-xs text-muted">A reminder only rings while the app is open, and only for a habit that is still open for today.</p>
        </div>

        <label className="flex min-h-[5rem] flex-col text-xs text-muted">Notes (optional)
          <textarea className="field mt-1 flex-1 resize-none leading-relaxed" value={notes}
            placeholder="Why does this matter to you?" onChange={(e) => setNotes(e.target.value)} />
        </label>

        {habit && s && (() => {
          // The rates count only days the habit was actually due, by the same
          // rules as everywhere else in the app.
          const completions = habitCompletions(habit)
          const rate = (days: number) => completionRateOrNull(habit, completions, days, today)
          const show = (r: number | null) => r === null ? '0%' : `${Math.round(r)}%`
          return (
            <section>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                {stat('Current streak', String(s.current))}
                {stat('Best streak', String(s.best))}
                {stat('Last 7 days', show(rate(7)))}
                {stat('Last 30 days', show(rate(30)))}
                {stat('Last 90 days', show(rate(90)))}
                {stat('Check-ins', String(s.total))}
              </div>
              <h3 className="mb-2 mt-5 text-sm font-medium">Last 12 months</h3>
              <HabitHeatmap habit={habit} today={today} onToggle={onToggleDay} />
              <p className="mt-2 text-xs text-muted">
                Click a square to fix a day. Streaks count scheduled days only, so rest days never break them.
              </p>
            </section>
          )
        })()}

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
