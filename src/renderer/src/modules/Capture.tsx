// The Quick capture window: a small always-on-top page for logging a note, trade, deposit, habit check-in or task without
// opening the app. It runs in its own window (src/main/capture.ts) but is part of the same renderer bundle: main.tsx
// shows this instead of <App /> when the address ends in #capture.
//
// What was typed survives the window being hidden (blur, Esc) and only clears once it is saved. The rules for turning
// the text into a valid entry are in src/shared/capture.ts, so the Trades / Savings / Logbook pages and this window agree.
import { useCallback, useEffect, useRef, useState } from 'react'
import type { KeyboardEvent as ReactKeyboardEvent } from 'react'
import type { LucideIcon } from 'lucide-react'
import { BookOpen, CalendarCheck, CandlestickChart, Check, CheckSquare, Flame, PiggyBank } from 'lucide-react'
import { MOODS, type CaptureKind, type Direction, type Mood, type SavingsGoal, type TxKind } from '../../../shared/types'
import { buildDeposit, buildNote, buildTrade, habitsForToday, type CaptureHabit } from '../../../shared/capture'
import { today } from '../lib/dates'
import { errMsg } from '../lib/errors'
import { fmtAmount } from '../lib/format'
import { MOOD_STYLE } from '../lib/moods'
import { loadSettings } from '../lib/settingsStore'

const TABS: { id: CaptureKind; label: string; icon: LucideIcon }[] = [
  { id: 'note', label: 'Note', icon: BookOpen },
  { id: 'trade', label: 'Trade', icon: CandlestickChart },
  { id: 'deposit', label: 'Deposit', icon: PiggyBank },
  { id: 'habit', label: 'Habits', icon: CalendarCheck },
  { id: 'task', label: 'Task', icon: CheckSquare }
]

// Small remembered conveniences (last tab, asset, goal). Only a speed-up: if storage is unavailable nothing breaks.
const memory = {
  get: (k: string): string | null => { try { return localStorage.getItem(k) } catch { return null } },
  set: (k: string, v: string): void => { try { localStorage.setItem(k, v) } catch { /* ignore */ } }
}
const K = { tab: 'capture-tab', asset: 'capture-asset', direction: 'capture-direction', goal: 'capture-goal' }

const isMac = /mac/i.test(navigator.platform)
const MOD = isMac ? '⌘' : 'Ctrl'
const SAVED_PAUSE_MS = 650 // how long "Saved" shows before the window hides itself

export function Capture() {
  const [tab, setTab] = useState<CaptureKind>(() => TABS.find((t) => t.id === memory.get(K.tab))?.id ?? 'note')

  // Note
  const [text, setText] = useState('')
  const [mood, setMood] = useState<Mood | null>(null)
  const [tags, setTags] = useState('')
  // Trade
  const [asset, setAsset] = useState(() => memory.get(K.asset) ?? '')
  const [direction, setDirection] = useState<Direction>(() => (memory.get(K.direction) === 'short' ? 'short' : 'long'))
  const [entry, setEntry] = useState('')
  const [exit, setExit] = useState('')
  const [qty, setQty] = useState('')
  const [fees, setFees] = useState('')
  const [assets, setAssets] = useState<string[]>([])
  // Deposit
  const [goals, setGoals] = useState<SavingsGoal[]>([])
  const [goalId, setGoalId] = useState<number | null>(null)
  const [txKind, setTxKind] = useState<TxKind>('deposit')
  const [amount, setAmount] = useState('')
  const [txNote, setTxNote] = useState('')
  // Habits
  const [habits, setHabits] = useState<{ items: CaptureHabit[]; rest: number }>({ items: [], rest: 0 })
  const [habitDay, setHabitDay] = useState('')
  const [busyHabit, setBusyHabit] = useState<number | null>(null)
  // Task
  const [taskTitle, setTaskTitle] = useState('')

  const [error, setError] = useState('')
  const [flash, setFlash] = useState('')
  const [busy, setBusy] = useState(false)
  const root = useRef<HTMLDivElement>(null)
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Puts the cursor in the first field of the tab on screen.
  const focusFirst = useCallback(() => {
    requestAnimationFrame(() => root.current?.querySelector<HTMLElement>('[data-autofocus]')?.focus())
  }, [])

  // Everything the forms offer to pick from: known assets, goals, today's habits.
  const reload = useCallback(async () => {
    try {
      const [meta, goalList, overview] = await Promise.all([window.api.trades.meta(), window.api.savings.listGoals(), window.api.habits.list()])
      setAssets(meta.assets)
      setGoals(goalList)
      setGoalId((cur) => goalList.find((g) => g.id === cur)?.id ?? goalList.find((g) => String(g.id) === memory.get(K.goal))?.id ?? goalList[0]?.id ?? null)
      setHabits(habitsForToday(overview.habits, overview.today))
      setHabitDay(overview.today)
    } catch (e) { setError(errMsg(e)) }
  }, [])

  // The window is shown again: refresh the look and the lists, and start typing straight away.
  useEffect(() => {
    document.title = 'Quick capture'
    loadSettings()
    reload()
    return window.api.capture.onShown(() => {
      if (hideTimer.current) { clearTimeout(hideTimer.current); hideTimer.current = null } // a pending "hide after saving" must not close a window just reopened
      setFlash(''); setError('')
      loadSettings()
      reload()
      focusFirst()
    })
  }, [reload, focusFirst])

  useEffect(() => { memory.set(K.tab, tab); setError(''); focusFirst() }, [tab, focusFirst])

  // The window is exactly as tall as its content: tell the main process whenever that changes.
  useEffect(() => {
    const el = root.current
    if (!el) return
    const send = (): void => { window.api.capture.resize(Math.ceil(el.getBoundingClientRect().height)) }
    const observer = new ResizeObserver(send)
    observer.observe(el)
    send()
    return () => observer.disconnect()
  }, [])

  // Saved: say so for a moment, tell the main window to reload, then put the window away.
  const finished = async (message: string): Promise<void> => {
    setFlash(message)
    await window.api.capture.saved()
    hideTimer.current = setTimeout(() => { hideTimer.current = null; window.api.capture.hide() }, SAVED_PAUSE_MS)
  }

  const submit = async (): Promise<void> => {
    if (busy || tab === 'habit') return
    setError(''); setFlash('')
    const day = today() // read now, not when the window opened: it may have sat hidden past midnight
    try {
      if (tab === 'note') {
        const r = buildNote({ text, mood, tags, today: day })
        if (!r.ok) return setError(r.error)
        setBusy(true)
        await window.api.logbook.create(r.value)
        setText(''); setMood(null); setTags('')
        await finished('Saved to your Logbook')
      } else if (tab === 'trade') {
        const r = buildTrade({ asset, direction, entry, exit, qty, fees, today: day })
        if (!r.ok) return setError(r.error)
        setBusy(true)
        await window.api.trades.create(r.value)
        memory.set(K.asset, r.value.asset); memory.set(K.direction, direction)
        setEntry(''); setExit(''); setQty(''); setFees('') // the asset and direction stay: the next trade is often the same market
        await finished(r.value.exitPrice === null ? 'Open trade saved' : 'Trade saved')
      } else if (tab === 'task') {
        const title = taskTitle.trim()
        if (!title) return setError('Write a task first.')
        setBusy(true)
        await window.api.tasks.create({ title, notes: '', status: 'todo', priority: 'medium', dueDate: day,
          project: '', tags: [], subtasks: [], recurrence: null, parentTaskId: null })
        setTaskTitle('')
        await finished('Task added for today')
      } else {
        const r = buildDeposit({ goalId, kind: txKind, amount, note: txNote, today: day })
        if (!r.ok) return setError(r.error)
        setBusy(true)
        await window.api.savings.addTransaction(r.value)
        if (goalId !== null) memory.set(K.goal, String(goalId))
        setAmount(''); setTxNote('')
        await finished(txKind === 'deposit' ? 'Deposit saved' : 'Withdrawal saved')
      }
    } catch (e) { setError(errMsg(e)) }
    setBusy(false)
  }

  // Check a habit off (or undo it). The window stays open, so several can be ticked in a row.
  const toggleHabit = async (h: CaptureHabit): Promise<void> => {
    if (busyHabit !== null) return
    setError(''); setBusyHabit(h.id)
    try {
      await window.api.habits.setCheckin(h.id, habitDay, !h.done)
      const overview = await window.api.habits.list()
      setHabits(habitsForToday(overview.habits, overview.today))
      setHabitDay(overview.today)
      await window.api.capture.saved()
    } catch (e) { setError(errMsg(e)) }
    setBusyHabit(null)
  }

  // Esc puts the window away; Ctrl+Enter saves; Ctrl+1 to 5 switch tab. The handler reads the latest state through a ref.
  const latest = useRef({ submit, setTab })
  latest.current = { submit, setTab }
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.isComposing) return // an input method is still choosing characters
      const mod = e.ctrlKey || e.metaKey
      if (e.key === 'Escape') { e.preventDefault(); window.api.capture.hide() }
      else if (mod && e.key === 'Enter') { e.preventDefault(); latest.current.submit() }
      else if (mod && /^[1-5]$/.test(e.key)) { e.preventDefault(); latest.current.setTab(TABS[Number(e.key) - 1].id) }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // Enter in a one-line field saves too (the note box needs Enter for new lines, so it only saves with Ctrl+Enter).
  const enterSaves = (e: ReactKeyboardEvent): void => {
    if (e.key === 'Enter' && !e.ctrlKey && !e.metaKey && !e.nativeEvent.isComposing && (e.target as HTMLElement).tagName === 'INPUT') {
      e.preventDefault(); submit()
    }
  }

  const goal = goals.find((g) => g.id === goalId) ?? null
  const habitList = [...habits.items].sort((a, b) => a.name.localeCompare(b.name)) // alphabetical, so rows never jump when one is ticked
  const left = habits.items.filter((h) => !h.done).length
  const saveLabel = tab === 'note' ? 'Save note' : tab === 'trade' ? 'Save trade' : tab === 'task' ? 'Add task' : txKind === 'deposit' ? 'Add deposit' : 'Add withdrawal'

  return (
    <div ref={root} className="min-h-[200px] border border-line">
      <div className="border-b border-line px-3 py-2">
        <div className="seg w-full" role="group" aria-label="What to capture">
          {TABS.map((t, i) => (
            <button key={t.id} aria-pressed={tab === t.id} onClick={() => setTab(t.id)} title={`${t.label} (${MOD}+${i + 1})`}
              className="flex flex-1 items-center justify-center gap-1.5">
              <t.icon size={14} aria-hidden="true" /> {t.label}
            </button>
          ))}
        </div>
      </div>

      <div className="flex flex-col gap-2.5 p-3" onKeyDown={enterSaves}>
        {tab === 'note' && (<>
          <textarea data-autofocus aria-label="Note" className="field min-h-[7rem] resize-none leading-relaxed" value={text}
            placeholder="What is on your mind? The first line becomes the title." onChange={(e) => setText(e.target.value)} />
          <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Mood (optional)">
            {MOODS.map((m) => (
              <button key={m} aria-pressed={mood === m} onClick={() => setMood(mood === m ? null : m)}
                className={`flex items-center gap-1.5 rounded-lg border px-2 py-1 text-xs ${mood === m ? 'border-accent bg-accent/15' : 'border-line text-muted hover:text-fg'}`}>
                <span className={`h-2 w-2 rounded-full ${MOOD_STYLE[m].dot}`} aria-hidden="true" />{MOOD_STYLE[m].label}
              </button>
            ))}
          </div>
          <input aria-label="Tags (optional)" className="field" value={tags} placeholder="Tags, optional: work, idea" onChange={(e) => setTags(e.target.value)} />
        </>)}

        {tab === 'trade' && (<>
          <div className="grid grid-cols-2 gap-2">
            <label className="flex flex-col text-xs text-muted">Asset
              <input data-autofocus list="capture-assets" className="field mt-1" value={asset} placeholder="XAUUSD" onChange={(e) => setAsset(e.target.value)} />
              <datalist id="capture-assets">{assets.map((a) => <option key={a} value={a} />)}</datalist>
            </label>
            <div className="flex flex-col text-xs text-muted">Direction
              <div className="seg mt-1" role="group" aria-label="Direction">
                {(['long', 'short'] as const).map((d) => (
                  <button key={d} aria-pressed={direction === d} onClick={() => setDirection(d)} className="flex-1 capitalize">{d}</button>
                ))}
              </div>
            </div>
            <label className="flex flex-col text-xs text-muted">Entry price
              <input type="number" step="any" min="0" inputMode="decimal" className="field mt-1" value={entry} onChange={(e) => setEntry(e.target.value)} />
            </label>
            <label className="flex flex-col text-xs text-muted">Exit price (blank = still open)
              <input type="number" step="any" min="0" inputMode="decimal" className="field mt-1" value={exit} onChange={(e) => setExit(e.target.value)} />
            </label>
            <label className="flex flex-col text-xs text-muted">Size
              <input type="number" step="any" min="0" inputMode="decimal" className="field mt-1" value={qty} onChange={(e) => setQty(e.target.value)} />
            </label>
            <label className="flex flex-col text-xs text-muted">Fees (optional)
              <input type="number" step="any" min="0" inputMode="decimal" className="field mt-1" value={fees} placeholder="0" onChange={(e) => setFees(e.target.value)} />
            </label>
          </div>
        </>)}

        {tab === 'task' && (
          <label className="flex flex-col text-xs text-muted">Task
            <input data-autofocus aria-label="Task title" className="field mt-1" value={taskTitle} placeholder="What needs doing today?"
              onChange={(e) => setTaskTitle(e.target.value)} />
            <span className="meta mt-1">Added to Tasks with medium priority and today's due date.</span>
          </label>
        )}

        {tab === 'deposit' && (goals.length === 0 ? (
          <div className="py-4 text-center text-sm text-muted">
            <p>You have no savings goals yet.</p>
            <button className="btn mt-3" onClick={() => window.api.capture.openMain()}>Open the app to create one</button>
          </div>
        ) : (<>
          <div className="grid grid-cols-2 gap-2">
            <label className="flex flex-col text-xs text-muted">Goal
              <select className="field mt-1" value={goalId ?? ''} onChange={(e) => setGoalId(Number(e.target.value))}>
                {goals.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
              </select>
            </label>
            <div className="flex flex-col text-xs text-muted">Type
              <div className="seg mt-1" role="group" aria-label="Deposit or withdrawal">
                {(['deposit', 'withdrawal'] as const).map((k) => (
                  <button key={k} aria-pressed={txKind === k} onClick={() => setTxKind(k)} className="flex-1 capitalize">{k}</button>
                ))}
              </div>
            </div>
            <label className="flex flex-col text-xs text-muted">Amount
              <input data-autofocus type="number" step="any" min="0" inputMode="decimal" className="field mt-1" value={amount} onChange={(e) => setAmount(e.target.value)} />
            </label>
            <label className="flex flex-col text-xs text-muted">Note (optional)
              <input className="field mt-1" value={txNote} onChange={(e) => setTxNote(e.target.value)} />
            </label>
          </div>
          {goal && <p className="meta">Balance now {fmtAmount(goal.balance)}{goal.target !== null && <> of {fmtAmount(goal.target)}</>}</p>}
        </>))}

        {tab === 'habit' && (
          habits.items.length === 0 ? (
            <div className="py-4 text-center text-sm text-muted">
              <p>{habits.rest > 0 ? `Nothing is scheduled today. ${habits.rest} ${habits.rest === 1 ? 'habit is' : 'habits are'} resting.` : 'You have no habits yet.'}</p>
              {habits.rest === 0 && <button className="btn mt-3" onClick={() => window.api.capture.openMain()}>Open the app to add one</button>}
            </div>
          ) : (<>
            <ul className="flex flex-col gap-1" aria-label="Habits for today">
              {habitList.map((h, i) => (
                <li key={h.id}>
                  <button role="checkbox" aria-checked={h.done} data-autofocus={i === 0 ? '' : undefined} disabled={busyHabit !== null}
                    onClick={() => toggleHabit(h)}
                    className="flex w-full items-center gap-3 rounded-xl border border-line px-3 py-2 text-left text-sm hover:bg-fg/5 disabled:opacity-60">
                    <span className={`grid h-5 w-5 shrink-0 place-items-center rounded-md border ${h.done ? 'border-accent bg-accent text-on-accent' : 'border-line'}`} aria-hidden="true">
                      {h.done && <Check size={14} />}
                    </span>
                    <span className={`min-w-0 flex-1 truncate ${h.done ? 'text-muted line-through' : ''}`}>{h.name}</span>
                    {h.streak > 0 && <span className="meta flex items-center gap-0.5" title="Current streak"><Flame size={12} className="warn" aria-hidden="true" />{h.streak}</span>}
                  </button>
                </li>
              ))}
            </ul>
            <p className="meta" role="status">
              {left === 0 ? 'All done for today.' : `${left} left today.`}
              {habits.rest > 0 && <> {habits.rest} {habits.rest === 1 ? 'habit is' : 'habits are'} resting today.</>}
            </p>
          </>)
        )}
      </div>

      <div className="flex items-center gap-2 border-t border-line px-3 py-2 text-xs text-muted">
        <div className="min-w-0 flex-1" aria-live="polite">
          {error ? <span role="alert" className="text-neg">{error}</span>
            : flash ? <span role="status" className="flex items-center gap-1 text-pos"><Check size={13} aria-hidden="true" />{flash}</span>
            : tab === 'habit' ? <span>Click a habit to check it off. <kbd className="kbd">Esc</kbd> closes</span>
            : <span><kbd className="kbd">{MOD}+Enter</kbd> saves, <kbd className="kbd">Esc</kbd> closes · <kbd className="kbd">{MOD}+1–5</kbd> switches type</span>}
        </div>
        <button className="section-link" onClick={() => window.api.capture.openMain()}>Open app</button>
        {tab !== 'habit' && !(tab === 'deposit' && goals.length === 0) && (
          <button className="btn-primary" onClick={submit} aria-busy={busy} disabled={busy}>{saveLabel}</button>
        )}
      </div>
    </div>
  )
}
