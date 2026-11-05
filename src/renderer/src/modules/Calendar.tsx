// The Calendar: a month grid showing what happened each day across the logbook, trades, savings and habits, plus a panel
// for the selected day where items open in their own tool, habits can be ticked and a note can be added.
// Everything shown is worked out by src/shared/calendar.ts from the other tools' data; nothing new is stored.
import { useCallback, useEffect, useRef, useState } from 'react'
import type { KeyboardEvent as ReactKeyboardEvent, ReactNode } from 'react'
import { BookOpen, CalendarCheck, CandlestickChart, Check, ChevronLeft, ChevronRight, Clapperboard, PiggyBank, Receipt, Timer } from 'lucide-react'
import type { CalendarDay, CalendarData, CalendarHabitItem } from '../../../shared/types'
import { describeDay, monthLabel, monthOf, monthRange, shiftMonth } from '../../../shared/calendar'
import { buildNote } from '../../../shared/capture'
import { WEEKDAY_NAMES, addDays } from '../../../shared/habits'
import { MOOD_STYLE, moodStyle } from '../lib/moods'
import { formatDate, today } from '../lib/dates'
import { fmtAmount, pnlColor } from '../lib/format'
import { errMsg } from '../lib/errors'
import { useRefreshOnCapture } from '../lib/dataChanged'
import type { ModuleProps } from '../lib/navigation'
import { PageHeader } from '../components/PageHeader'
import { Pnl } from '../components/Pnl'

type Layer = 'journal' | 'trades' | 'savings' | 'habits' | 'bills' | 'focus'
const LAYERS: { id: Layer; label: string }[] = [
  { id: 'journal', label: 'Journal' }, { id: 'trades', label: 'Trades' }, { id: 'savings', label: 'Savings' }, { id: 'habits', label: 'Habits' }, { id: 'bills', label: 'Bills' }, { id: 'focus', label: 'Focus' }
]
const LAYER_KEY = 'calendar-layers'
const ALL_ON: Record<Layer, boolean> = { journal: true, trades: true, savings: true, habits: true, bills: true, focus: true }

// Which layers are shown is remembered, but it is only a convenience: if storage is unavailable nothing breaks.
function readLayers(): Record<Layer, boolean> {
  try {
    const saved = JSON.parse(localStorage.getItem(LAYER_KEY) ?? 'null')
    if (saved && typeof saved === 'object') return { ...ALL_ON, ...Object.fromEntries(LAYERS.filter((l) => saved[l.id] === false).map((l) => [l.id, false])) }
  } catch { /* a damaged value means "all on" */ }
  return ALL_ON
}

// +39, -11.5, +1.2K: short enough for a small cell. The sign is always there, so colour is never the only clue.
const compact = (n: number): string =>
  `${n > 0 ? '+' : n < 0 ? '-' : ''}${Math.abs(n).toLocaleString(undefined, { notation: 'compact', maximumFractionDigits: Math.abs(n) < 10 ? 2 : 1 })}`

const pad = (n: number): string => String(n).padStart(2, '0')

// The same day-of-month in another month, or that month's last day when it is shorter (31 Oct -> 30 Nov).
function sameDayIn(month: string, date: string): string {
  const last = Number(monthRange(month).last.slice(8))
  return `${month}-${pad(Math.min(Number(date.slice(8)), last))}`
}

export function Calendar({ onOpen, onNavigate }: ModuleProps) {
  const [month, setMonth] = useState(() => monthOf(today()))
  const [selected, setSelected] = useState(() => today())
  const [data, setData] = useState<CalendarData | null>(null)
  const [error, setError] = useState('')
  const [layers, setLayers] = useState(readLayers)
  const [notes, setNotes] = useState<Record<string, string>>({}) // note text typed but not saved yet, per day, so clicking another day loses nothing
  const latest = useRef(0) // the newest request wins, so a slow answer for an old month cannot overwrite a newer one
  const grid = useRef<HTMLDivElement>(null)
  const focusSelected = useRef(false) // set when the keyboard moved the selection, so focus follows it

  const load = useCallback(async () => {
    const request = ++latest.current
    try {
      const d = await window.api.calendar.month(month, today())
      if (request === latest.current) { setData(d); setError('') }
    } catch (e) {
      if (request === latest.current) setError(errMsg(e))
    }
  }, [month])
  useEffect(() => { load() }, [load])
  useRefreshOnCapture(load) // something was saved from the Quick capture window
  useEffect(() => { // coming back to the window (maybe the next day) shows the right "today"
    window.addEventListener('focus', load)
    return () => window.removeEventListener('focus', load)
  }, [load])

  // After a keyboard move, put the focus on the newly selected day once it is on screen.
  useEffect(() => {
    if (!focusSelected.current) return
    const cell = grid.current?.querySelector<HTMLElement>(`[data-date="${selected}"]`)
    if (cell) { cell.focus(); focusSelected.current = false }
  }, [data, selected])

  const select = (date: string): void => { setSelected(date); if (monthOf(date) !== month) setMonth(monthOf(date)) }
  const step = (delta: number): void => { const next = shiftMonth(month, delta); setMonth(next); setSelected(sameDayIn(next, selected)) }
  const goToday = (): void => { const t = today(); setMonth(monthOf(t)); setSelected(t) }

  const toggleLayer = (id: Layer): void => {
    const next = { ...layers, [id]: !layers[id] }
    setLayers(next)
    try { localStorage.setItem(LAYER_KEY, JSON.stringify(next)) } catch { /* only a convenience */ }
  }

  // Arrow keys move one day or one week, Page Up / Page Down a month. (The grid is one tab stop, like a real calendar.)
  const onGridKey = (e: ReactKeyboardEvent): void => {
    if (e.ctrlKey || e.metaKey || e.altKey) return
    let target: string | null = null
    if (e.key === 'ArrowLeft') target = addDays(selected, -1)
    else if (e.key === 'ArrowRight') target = addDays(selected, 1)
    else if (e.key === 'ArrowUp') target = addDays(selected, -7)
    else if (e.key === 'ArrowDown') target = addDays(selected, 7)
    else if (e.key === 'PageUp') target = sameDayIn(shiftMonth(month, -1), selected)
    else if (e.key === 'PageDown') target = sameDayIn(shiftMonth(month, 1), selected)
    if (!target) return
    e.preventDefault()
    focusSelected.current = true
    select(target)
  }

  const now = today()
  const viewingNow = month === monthOf(now) && selected === now
  const day = data?.weeks.flat().find((d) => d.date === selected) ?? null

  return (
    <div className="page page-lg">
      <PageHeader title="Calendar" subtitle={data?.month === month ? data.label : monthLabel(month)}>
        <div className="flex items-center">
          <button className="btn-icon" aria-label="Previous month" title="Previous month" onClick={() => step(-1)}><ChevronLeft size={18} /></button>
          <button className="btn-icon" aria-label="Next month" title="Next month" onClick={() => step(1)}><ChevronRight size={18} /></button>
        </div>
        {!viewingNow && <button className="btn btn-sm" onClick={goToday}>Today</button>}
      </PageHeader>

      {error && <p role="alert" className="mb-4 text-sm text-neg">{error}</p>}
      {!data && !error && <p className="text-sm text-muted" aria-busy="true">Loading...</p>}

      {data && (
        <div className={data.month === month ? '' : 'opacity-60 transition-opacity'} aria-busy={data.month !== month}>
          <Summary data={data} />

          <div className="mt-3 flex flex-wrap items-center gap-1.5" role="group" aria-label="Show on the calendar">
            <span className="mr-1 text-xs text-muted">Show</span>
            {LAYERS.map((l) => (
              <button key={l.id} aria-pressed={layers[l.id]} onClick={() => toggleLayer(l.id)}
                className={`rounded-lg border px-2.5 py-1 text-xs ${layers[l.id] ? 'border-accent bg-accent/15' : 'border-line text-muted hover:text-fg'}`}>{l.label}</button>
            ))}
          </div>

          <div className="mt-3 grid gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]">
            <div>
              <div className="grid grid-cols-7 gap-1 px-0.5 pb-1 text-center text-xs text-muted" aria-hidden="true">
                {WEEKDAY_NAMES.map((w) => <div key={w}>{w}</div>)}
              </div>
              <div ref={grid} role="grid" aria-label={data.label} onKeyDown={onGridKey} className="flex flex-col gap-1">
                {data.weeks.map((week) => (
                  <div key={week[0].date} role="row" className="grid grid-cols-7 gap-1">
                    {week.map((d) => <Cell key={d.date} day={d} selected={d.date === selected} layers={layers} onSelect={select} />)}
                  </div>
                ))}
              </div>
            </div>

            {day && (
              <DayPanel key={day.date} day={day} onOpen={onOpen} onNavigate={onNavigate} onChanged={load} note={notes[day.date] ?? ''}
                onNote={(text) => setNotes((all) => { const next = { ...all }; if (text) next[day.date] = text; else delete next[day.date]; return next })} />
            )}
          </div>
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------------------------------------------

function Summary({ data }: { data: CalendarData }) {
  const s = data.summary
  return (
    <dl className="flex flex-wrap gap-x-8 gap-y-2 text-sm">
      <div><dt className="meta">Journal</dt><dd className="mt-0.5 font-medium">{s.entries} {s.entries === 1 ? 'entry' : 'entries'} on {s.daysWritten} {s.daysWritten === 1 ? 'day' : 'days'}</dd></div>
      <div><dt className="meta">Trading</dt><dd className="mt-0.5 font-medium">{s.closed === 0 ? (s.open > 0 ? `${s.open} open` : 'No closed trades') : <><Pnl value={s.pnl} /> <span className="font-normal text-muted">({s.closed} closed)</span></>}</dd></div>
      <div><dt className="meta">Savings</dt><dd className="mt-0.5 font-medium">{s.savingsNet === 0 ? 'No movement' : <Pnl value={s.savingsNet} />}</dd></div>
      <div><dt className="meta">Habits</dt><dd className="mt-0.5 font-medium">{s.habitRate === null ? 'None counted yet' : `${Math.round(s.habitRate)}% done`}</dd></div>
      {s.moodAverage !== null && <div><dt className="meta">Mood</dt><dd className="mt-0.5 font-medium">{s.moodAverage.toFixed(1)} / 5</dd></div>}
    </dl>
  )
}

function Cell({ day, selected, layers, onSelect }: { day: CalendarDay; selected: boolean; layers: Record<Layer, boolean>; onSelect: (date: string) => void }) {
  const h = day.habits
  const habitTotal = h.done + h.missed + h.pending
  const label = describeDay(day)
  return (
    <div role="gridcell" aria-selected={selected}>
      <button data-date={day.date} tabIndex={selected ? 0 : -1} aria-label={label} title={label} aria-current={day.isToday ? 'date' : undefined}
        onClick={() => onSelect(day.date)}
        className={`flex h-[5.25rem] w-full flex-col rounded-lg border p-1.5 text-left transition-colors hover:bg-fg/5
          ${selected ? 'border-accent bg-accent/10 ring-1 ring-accent' : 'border-line'} ${day.inMonth ? '' : 'opacity-50'}`}>
        <span className="flex items-center justify-between">
          <span className={`grid h-5 min-w-[1.25rem] place-items-center rounded-full px-1 text-xs ${day.isToday ? 'bg-accent font-semibold text-on-accent' : day.isFuture ? 'text-muted' : ''}`}>
            {Number(day.date.slice(8))}
          </span>
          {layers.journal && day.mood && <span className={`h-2 w-2 rounded-full ${MOOD_STYLE[day.mood].dot}`} aria-hidden="true" />}
        </span>
        <span className="mt-auto flex flex-wrap gap-x-1.5 gap-y-0.5 text-[11px] leading-4" aria-hidden="true">
          {layers.journal && day.entries.length > 0 && <span className="flex items-center gap-0.5 text-muted"><BookOpen size={11} />{day.entries.length}</span>}
          {layers.trades && day.closed > 0 && <span className={`flex items-center gap-0.5 ${pnlColor(day.pnl)}`}><CandlestickChart size={11} />{compact(day.pnl)}</span>}
          {layers.trades && day.open > 0 && <span className="flex items-center gap-0.5 text-muted">{day.closed === 0 && <CandlestickChart size={11} />}{day.open} open</span>}
          {layers.savings && day.txs.length > 0 && <span className={`flex items-center gap-0.5 ${pnlColor(day.savingsNet)}`}><PiggyBank size={11} />{compact(day.savingsNet)}</span>}
          {layers.habits && (habitTotal > 0 || h.bonus > 0) && (
            <span className={`flex items-center gap-0.5 ${habitTotal > 0 && h.done === habitTotal ? 'text-pos' : 'text-muted'}`}>
              <CalendarCheck size={11} />{habitTotal > 0 ? `${h.done}/${habitTotal}` : `+${h.bonus}`}
            </span>
          )}
          {/* Phase 3: content published (solid) and planned (muted) that day. */}
          {day.published.length > 0 && <span className="flex items-center gap-0.5 text-pos"><Clapperboard size={11} />{day.published.length}</span>}
          {day.published.length === 0 && day.planned.length > 0 && <span className="flex items-center gap-0.5 text-muted"><Clapperboard size={11} />{day.planned.length}</span>}
          {/* Phase 1 / 6: bills due that day */}
          {layers.bills && day.bills && day.bills.length > 0 && (
            <span className="flex items-center gap-0.5 text-warn" title={`${day.bills.length} bill(s) due`}>
              <Receipt size={11} />{day.bills.length}
            </span>
          )}
          {/* Phase 4 / 6: focus sessions */}
          {layers.focus && day.focusSessions && day.focusSessions.length > 0 && (
            <span className="flex items-center gap-0.5 text-accent-fg" title={`${day.focusSessions.length} focus session(s)`}>
              <Timer size={11} />{Math.round(day.focusSessions.reduce((sum, s) => sum + s.seconds, 0) / 60)}m
            </span>
          )}
        </span>
      </button>
    </div>
  )
}

const STATUS_TEXT: Record<CalendarHabitItem['status'], string> = { done: 'Done', missed: 'Missed', pending: 'Not yet', bonus: 'Bonus (rest day)' }

function DayPanel({ day, onOpen, onNavigate, onChanged, note, onNote }: {
  day: CalendarDay; onOpen: ModuleProps['onOpen']; onNavigate: ModuleProps['onNavigate']; onChanged: () => Promise<void>; note: string; onNote: (text: string) => void
}) {
  const [busyHabit, setBusyHabit] = useState<number | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [saved, setSaved] = useState('')
  const empty = day.entries.length === 0 && day.trades.length === 0 && day.txs.length === 0 && day.habits.items.length === 0
    && day.published.length === 0 && day.planned.length === 0

  const toggleHabit = async (h: CalendarHabitItem): Promise<void> => {
    if (busyHabit !== null) return
    setError(''); setBusyHabit(h.id)
    try {
      await window.api.habits.setCheckin(h.id, day.date, h.status !== 'done' && h.status !== 'bonus')
      await onChanged()
    } catch (e) { setError(errMsg(e)) }
    setBusyHabit(null)
  }

  const addNote = async (): Promise<void> => {
    if (saving) return
    setError(''); setSaved('')
    const r = buildNote({ text: note, mood: null, tags: '', today: day.date }) // "today" here is the day being viewed
    if (!r.ok) return setError(r.error)
    setSaving(true)
    try {
      const entry = await window.api.logbook.create(r.value)
      onNote(''); setSaved(`Added "${entry.title}" to the Logbook.`)
      await onChanged()
    } catch (e) { setError(errMsg(e)) }
    setSaving(false)
  }

  return (
    <aside className="card card-pad self-start" aria-label={`Details for ${formatDate(day.date)}`}>
      <div className="flex items-start justify-between gap-2">
        <h2 className="section-title">{formatDate(day.date)}</h2>
        {day.isToday && <span className="badge badge-open">Today</span>}
      </div>
      {day.mood && <p className="meta mt-1 flex items-center gap-1.5"><span className={`h-2 w-2 rounded-full ${MOOD_STYLE[day.mood].dot}`} aria-hidden="true" />Mood {moodStyle(day.mood).label.toLowerCase()}</p>}
      {empty && <p className="mt-3 text-sm text-muted">{day.isFuture ? 'Nothing here yet.' : 'Nothing logged on this day.'}</p>}

      {day.entries.length > 0 && (
        <Block icon={<BookOpen size={13} />} title="Journal">
          {day.entries.map((e) => (
            <li key={e.id}>
              <button className="row-link" onClick={() => onOpen({ module: 'logbook', entry: e })}>
                <span className="flex min-w-0 items-center gap-2 text-sm">
                  {e.mood && <span title={moodStyle(e.mood).label} className={`h-2 w-2 shrink-0 rounded-full ${moodStyle(e.mood).dot}`} />}
                  <span className="truncate">{e.title}</span>
                </span>
              </button>
            </li>
          ))}
        </Block>
      )}

      {day.trades.length > 0 && (
        <Block icon={<CandlestickChart size={13} />} title="Trades">
          {day.trades.map((t) => (
            <li key={t.id}>
              <button className="row-link" onClick={() => onOpen({ module: 'trades', trade: t })}>
                <span className="flex min-w-0 items-center gap-2 text-sm">
                  <span className="truncate font-medium">{t.asset}</span>
                  <span className={`badge capitalize ${t.direction === 'long' ? 'badge-pos' : 'badge-neg'}`}>{t.direction}</span>
                </span>
                <span className="shrink-0 text-sm">{t.pnl === null ? <span className="text-muted">open</span> : <Pnl value={t.pnl} />}</span>
              </button>
            </li>
          ))}
        </Block>
      )}

      {(day.published.length > 0 || day.planned.length > 0) && (
        <Block icon={<Clapperboard size={13} />} title="Content">
          {day.published.map((c) => (
            <li key={`pub-${c.id}`} className="flex items-center justify-between gap-2">
              <span className="truncate">{c.title}</span>
              <span className="badge badge-pos shrink-0">Published</span>
            </li>
          ))}
          {day.planned.map((c) => (
            <li key={`plan-${c.id}`} className="flex items-center justify-between gap-2">
              <span className="truncate">{c.title}</span>
              <span className="badge shrink-0">Planned{c.platform ? ` · ${c.platform}` : ''}</span>
            </li>
          ))}
        </Block>
      )}

      {day.bills && day.bills.length > 0 && (
        <Block icon={<Receipt size={13} />} title="Bills due">
          {day.bills.map((b) => (
            <li key={b.id}>
              <button className="row-link" onClick={() => onNavigate('expenses')}>
                <span className="truncate text-sm">{b.name}</span>
                <span className="shrink-0 text-sm font-medium text-warn">{fmtAmount(b.amount / 100)} {b.currency}</span>
              </button>
            </li>
          ))}
        </Block>
      )}

      {day.focusSessions && day.focusSessions.length > 0 && (
        <Block icon={<Timer size={13} />} title="Focus sessions">
          {day.focusSessions.map((fs) => (
            <li key={fs.id} className="flex items-center justify-between text-sm py-1">
              <span className="truncate font-medium">{fs.projectName || 'Focus'}</span>
              <span className="shrink-0 text-xs text-muted">{Math.round(fs.seconds / 60)} min ({fs.type})</span>
            </li>
          ))}
        </Block>
      )}

      {day.txs.length > 0 && (
        <Block icon={<PiggyBank size={13} />} title="Savings">
          {day.txs.map((t) => (
            <li key={t.id}>
              <button className="row-link" onClick={() => onOpen({ module: 'savings', goalId: t.goalId })}>
                <span className="truncate text-sm">{t.goalName}</span>
                <span className={`shrink-0 text-sm ${t.kind === 'deposit' ? 'text-pos' : 'text-neg'}`}>{t.kind === 'deposit' ? '+' : '-'}{fmtAmount(t.amount)}</span>
              </button>
            </li>
          ))}
        </Block>
      )}

      {day.habits.items.length > 0 && (
        <Block icon={<CalendarCheck size={13} />} title="Habits">
          {day.habits.items.map((h) => {
            const on = h.status === 'done' || h.status === 'bonus'
            return (
              <li key={h.id}>
                <button role="checkbox" aria-checked={on} disabled={busyHabit !== null} onClick={() => toggleHabit(h)}
                  title={on ? 'Click to undo' : 'Click to check off'}
                  className="flex w-full items-center gap-3 rounded-lg px-2 py-1.5 text-left text-sm hover:bg-fg/5 disabled:opacity-60">
                  <span className={`grid h-4 w-4 shrink-0 place-items-center rounded border ${on ? 'border-accent bg-accent text-on-accent' : 'border-line'}`} aria-hidden="true">{on && <Check size={12} />}</span>
                  <span className={`min-w-0 flex-1 truncate ${on ? 'text-muted line-through' : ''}`}>{h.name}</span>
                  <span className={`meta shrink-0 ${h.status === 'missed' ? 'text-neg' : ''}`}>{STATUS_TEXT[h.status]}</span>
                </button>
              </li>
            )
          })}
        </Block>
      )}

      <div className="mt-4 border-t border-line pt-3">
        <label className="flex flex-col text-xs text-muted">Add a note to this day
          <textarea className="field mt-1 min-h-[4.5rem] resize-y" value={note} placeholder="The first line becomes the title."
            onChange={(e) => { onNote(e.target.value); setSaved('') }}
            onKeyDown={(e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && !e.nativeEvent.isComposing) { e.preventDefault(); addNote() } }} />
        </label>
        <div className="mt-2 flex items-center gap-2">
          <span className="min-w-0 flex-1 text-xs" aria-live="polite">
            {error ? <span role="alert" className="text-neg">{error}</span> : saved ? <span role="status" className="text-muted">{saved}</span> : <span className="text-muted"><kbd className="kbd">Ctrl+Enter</kbd> saves</span>}
          </span>
          <button className="btn btn-sm" onClick={addNote} aria-busy={saving} disabled={saving || !note.trim()}>Add note</button>
        </div>
      </div>
    </aside>
  )
}

function Block({ icon, title, children }: { icon: ReactNode; title: string; children: ReactNode }) {
  return (
    <section className="mt-4">
      <h3 className="meta flex items-center gap-1.5 font-medium">{icon}{title}</h3>
      <ul className="mt-1 flex flex-col gap-0.5">{children}</ul>
    </section>
  )
}
