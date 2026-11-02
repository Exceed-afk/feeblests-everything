// "What changed since you last opened" (P4): a pure rule that lists the
// things dated after a stored `since` day, capped at a few lines. Nothing is
// stored here — the caller keeps `lastSeenDate` in `dailyCheckState` and hands
// the rows in. Dates are local "YYYY-MM-DD" text; drafts never count.
import { isAutomationEntry } from './automations'
import { round8 } from './math'
import type { Habit, LogEntry, SavingsTx, TaskCompletion, Trade, Task } from './types'

export interface ChangeItem {
  kind: 'trade' | 'savings' | 'task' | 'habit' | 'journal'
  text: string // one plain line for the Briefing
}

export interface ChangesInput {
  trades: Trade[]
  txs: SavingsTx[]
  completions: TaskCompletion[]
  tasks: Task[]
  habits: Habit[]
  entries: LogEntry[]
  goals?: { id: number; name: string }[]
}

// The strict "after": an item dated ON `since` was already seen (the state is
// written when the window closes, after the briefing was built).
export function changesSince(rows: ChangesInput, since: string, today: string, cap = 6): ChangeItem[] {
  if (since >= today) return []
  const items: ChangeItem[] = []

  const closed = rows.trades
    .filter((t) => t.pnl !== null && t.date > since && t.date <= today)
    .sort((a, b) => b.date.localeCompare(a.date) || b.id - a.id)
  if (closed.length > 0) {
    const net = round8(closed.reduce((sum, t) => sum + (t.pnl as number), 0))
    items.push({
      kind: 'trade',
      text: `${closed.length} trade${closed.length === 1 ? '' : 's'} closed (net ${net >= 0 ? '+' : ''}${String(Number(net.toFixed(2)))})`
    })
  }

  const saved = rows.txs.filter((t) => t.date > since && t.date <= today)
  if (saved.length > 0) {
    const net = round8(saved.reduce((sum, t) => sum + (t.kind === 'deposit' ? t.amount : -t.amount), 0))
    items.push({
      kind: 'savings',
      text: `${saved.length} savings transaction${saved.length === 1 ? '' : 's'} (net ${net >= 0 ? '+' : ''}${String(Number(net.toFixed(2)))})`
    })
  }

  const doneTasks = rows.completions.filter((c) => {
    const day = localDayOf(c.completedAt)
    return day !== null && day > since && day <= today
  })
  if (doneTasks.length > 0) items.push({ kind: 'task', text: `${doneTasks.length} task${doneTasks.length === 1 ? '' : 's'} completed` })

  // Habits missed: a due day in the window with no record and before today.
  const missed: string[] = []
  for (const habit of rows.habits) {
    if (habit.archived) continue
    const missedDays = countMissed(habit, since, today)
    if (missedDays > 0) missed.push(`${missedDays} missed on "${habit.name}"`)
  }
  if (missed.length > 0) items.push({ kind: 'habit', text: `Habits: ${missed.join(', ')}` })

  const written = rows.entries.filter((e) => !isAutomationEntry(e) && e.date > since && e.date <= today)
  if (written.length > 0) items.push({ kind: 'journal', text: `${written.length} journal entr${written.length === 1 ? 'y' : 'ies'} written` })

  return items.slice(0, cap)
}

const localDayOf = (iso: string | null): string | null => {
  if (!iso) return null
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return null
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

// Missed due days of one habit between the day after `since` and `today`
// exclusive of today. A day with a record (done OR skipped) is not missed.
const countMissed = (habit: Habit, since: string, today: string): number => {
  const recorded = new Set((habit.completions ?? habit.checkins.map((date) => ({ date, status: 'done' as const }))).map((c) => c.date))
  const start = addDay(since, 1)
  let missed = 0
  for (let date = start; date < today; date = addDay(date, 1)) {
    if (!isDueOn(habit.days, date)) continue
    if (recorded.has(date)) continue
    missed++
  }
  return missed
}

// A habit's `days` are 0=Sunday..6=Saturday weekday numbers (the app's rule).
const isDueOn = (days: number[], date: string): boolean => {
  if (!days || days.length === 0) return false
  const [y, m, d] = date.split('-').map(Number)
  const weekday = new Date(Date.UTC(y, m - 1, d)).getUTCDay()
  return days.includes(weekday)
}

const addDay = (iso: string, n: number): string => {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d) + n * 86_400_000).toISOString().slice(0, 10)
}
