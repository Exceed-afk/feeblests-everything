// The weekly / monthly review as plain functions (no database, no Electron, no React), so every number on the
// Review page can be checked by a test. The main process only FETCHES rows (src/main/review.ts); this file turns
// them into the summary. Nothing here is stored: it is recalculated from the other tools' data every time.
//
// Dates are "YYYY-MM-DD" text and the arithmetic works on the calendar date itself (UTC), so time zones and
// daylight saving cannot shift a day.
import { addDays, isScheduled, weekdayOf, WEEKDAY_NAMES } from './habits'
import { round8 } from './math'
import { signedAmount } from './savings'
import { computeStats } from './trades'
import { taskReview } from './tasks'
import { MOODS } from './types'
import type {
  Habit, LogEntry, Mood, ReviewData, ReviewGoal, ReviewHabit, ReviewHabits, ReviewJournal, ReviewKind, ReviewMood, Task, TaskReview,
  ReviewSavings, ReviewTrades, SavingsGoal, SavingsTx, Trade
} from './types'

// A saved reflection is a logbook entry carrying this tag.
export const REVIEW_TAG = 'review'

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
const MONTHS_SHORT = MONTHS.map((m) => m.slice(0, 3))

// ---------- Periods ----------

const parts = (iso: string): [number, number, number] => {
  const [y, m, d] = iso.split('-').map(Number)
  return [y, m, d]
}
const ymd = (y: number, m: number, d: number): string => new Date(Date.UTC(y, m - 1, d)).toISOString().slice(0, 10)

export interface PeriodRange { start: string; end: string }

// The week (Monday to Sunday) or the calendar month that contains `anchor`.
export function reviewRange(kind: ReviewKind, anchor: string): PeriodRange {
  if (kind === 'week') {
    const start = addDays(anchor, -weekdayOf(anchor))
    return { start, end: addDays(start, 6) }
  }
  const [y, m] = parts(anchor)
  return { start: ymd(y, m, 1), end: ymd(y, m + 1, 0) } // day 0 of next month = last day of this one
}

// The period `delta` steps away (-1 = the one before). Months roll over the year correctly.
export function shiftRange(kind: ReviewKind, range: PeriodRange, delta: number): PeriodRange {
  if (kind === 'week') return reviewRange('week', addDays(range.start, 7 * delta))
  const [y, m] = parts(range.start)
  return reviewRange('month', ymd(y, m + delta, 1))
}

// Every date from start to end, inclusive (at most a year, so a bad range cannot loop for long).
export function periodDays(start: string, end: string): string[] {
  const out: string[] = []
  for (let d = start; d <= end && out.length < 366; d = addDays(d, 1)) out.push(d)
  return out
}

// "19 Oct to 25 Oct 2026", "28 Dec 2026 to 3 Jan 2027", "October 2026"
export function periodLabel(kind: ReviewKind, start: string, end: string): string {
  const [y1, m1, d1] = parts(start)
  const [y2, m2, d2] = parts(end)
  if (kind === 'month') return `${MONTHS[m1 - 1]} ${y1}`
  return y1 === y2
    ? `${d1} ${MONTHS_SHORT[m1 - 1]} to ${d2} ${MONTHS_SHORT[m2 - 1]} ${y2}`
    : `${d1} ${MONTHS_SHORT[m1 - 1]} ${y1} to ${d2} ${MONTHS_SHORT[m2 - 1]} ${y2}`
}

// The title of the logbook entry that holds this period's reflection. It is also how the page finds it again.
export const reviewTitle = (kind: ReviewKind, start: string, end: string): string =>
  kind === 'week' ? `Weekly review ${start} to ${end}` : `Monthly review ${start.slice(0, 7)}`

const inRange = (date: string, start: string, end: string): boolean => date >= start && date <= end

// ---------- Trades ----------

function tradesSection(trades: Trade[], range: PeriodRange, prev: PeriodRange, days: string[]): ReviewTrades {
  const mine = trades.filter((t) => inRange(t.date, range.start, range.end))
  const before = trades.filter((t) => inRange(t.date, prev.start, prev.end))
  const prevStats = computeStats(before)
  const byDay = new Map<string, { pnl: number; closed: number }>()
  for (const t of mine) {
    if (t.pnl === null) continue
    const day = byDay.get(t.date) ?? { pnl: 0, closed: 0 }
    byDay.set(t.date, { pnl: round8(day.pnl + t.pnl), closed: day.closed + 1 })
  }
  const closed = mine.filter((t) => t.pnl !== null)
  const sorted = [...closed].sort((a, b) => (b.pnl as number) - (a.pnl as number) || a.id - b.id)
  const top = sorted[0] ?? null
  const bottom = sorted[sorted.length - 1] ?? null
  return {
    stats: computeStats(mine),
    days: days.map((date) => ({ date, ...(byDay.get(date) ?? { pnl: 0, closed: 0 }) })),
    best: top && (top.pnl as number) > 0 ? top : null,
    worst: bottom && (bottom.pnl as number) < 0 ? bottom : null,
    previous: { closed: prevStats.closed, totalPnl: prevStats.totalPnl }
  }
}

// ---------- Savings ----------

function savingsSection(goals: SavingsGoal[], txs: SavingsTx[], range: PeriodRange, prev: PeriodRange): ReviewSavings {
  interface Acc { start: number; end: number; deposits: number; withdrawals: number; count: number }
  const acc = new Map<number, Acc>(goals.map((g) => [g.id, { start: 0, end: 0, deposits: 0, withdrawals: 0, count: 0 }]))
  let previousNet = 0
  for (const t of txs) {
    const a = acc.get(t.goalId)
    if (!a) continue // a transaction of a goal that no longer exists
    const signed = signedAmount(t.kind, t.amount)
    if (t.date < range.start) a.start += signed
    if (t.date <= range.end) a.end += signed
    if (inRange(t.date, range.start, range.end)) {
      if (t.kind === 'deposit') a.deposits += t.amount
      else a.withdrawals += t.amount
      a.count++
    }
    if (inRange(t.date, prev.start, prev.end)) previousNet += signed
  }
  const rows: ReviewGoal[] = []
  let deposits = 0, withdrawals = 0, count = 0, startBalance = 0, endBalance = 0
  for (const g of goals) {
    const a = acc.get(g.id) as Acc
    deposits += a.deposits; withdrawals += a.withdrawals; count += a.count
    startBalance += a.start; endBalance += a.end
    if (a.count === 0) continue
    const start = round8(a.start), end = round8(a.end)
    rows.push({
      goalId: g.id, name: g.name, deposits: round8(a.deposits), withdrawals: round8(a.withdrawals),
      net: round8(a.deposits - a.withdrawals), startBalance: start, endBalance: end, target: g.target,
      reached: g.target !== null && start < g.target && end >= g.target
    })
  }
  rows.sort((a, b) => Math.abs(b.net) - Math.abs(a.net) || a.name.localeCompare(b.name))
  return {
    deposits: round8(deposits), withdrawals: round8(withdrawals), net: round8(deposits - withdrawals), txCount: count,
    startBalance: round8(startBalance), endBalance: round8(endBalance), goals: rows, previousNet: round8(previousNet)
  }
}

// ---------- Habits ----------

interface HabitPeriod { rows: ReviewHabit[]; days: Map<string, { due: number; done: number }>; due: number; done: number; bonus: number }

// The same rules as the Habits page (src/shared/habits.ts): only scheduled days count, days before the habit
// existed are not missed, today is not missed until it is over, and a check-in on a rest day is a bonus.
function habitPeriod(habits: Habit[], range: PeriodRange, today: string): HabitPeriod {
  const last = range.end < today ? range.end : today // nothing after today has happened yet
  const days = new Map<string, { due: number; done: number }>()
  const rows: ReviewHabit[] = []
  let due = 0, done = 0, bonus = 0
  for (const h of habits) {
    if (h.archived) continue
    const checked = new Set(h.checkins)
    const first = [h.startDate, ...h.checkins].sort()[0]
    const from = range.start > first ? range.start : first
    const missed: string[] = []
    let hDue = 0, hDone = 0, hBonus = 0
    for (let d = from; d <= last; d = addDays(d, 1)) {
      const scheduled = isScheduled(h.days, d)
      if (checked.has(d)) {
        if (scheduled) { hDue++; hDone++; tally(days, d, true) } else hBonus++
      } else if (scheduled && d !== today) {
        hDue++; missed.push(d); tally(days, d, false)
      }
    }
    due += hDue; done += hDone; bonus += hBonus
    if (hDue > 0 || hBonus > 0) {
      rows.push({ id: h.id, name: h.name, due: hDue, done: hDone, rate: hDue > 0 ? (hDone / hDue) * 100 : null, bonus: hBonus, streak: h.stats.current, missed })
    }
  }
  // Weakest first, so the habit that needs attention is on top. Habits with nothing due go last.
  rows.sort((a, b) => (a.rate ?? 101) - (b.rate ?? 101) || a.name.localeCompare(b.name))
  return { rows, days, due, done, bonus }
}

function tally(days: Map<string, { due: number; done: number }>, date: string, done: boolean): void {
  const d = days.get(date) ?? { due: 0, done: 0 }
  d.due++
  if (done) d.done++
  days.set(date, d)
}

const rateOf = (done: number, due: number): number | null => (due > 0 ? (done / due) * 100 : null)

function habitsSection(habits: Habit[], range: PeriodRange, prev: PeriodRange, today: string, days: string[]): ReviewHabits {
  const now = habitPeriod(habits, range, today)
  const before = habitPeriod(habits, prev, today)
  return {
    due: now.due, done: now.done, rate: rateOf(now.done, now.due), bonus: now.bonus,
    previousRate: rateOf(before.done, before.due), habits: now.rows,
    days: days.map((date) => ({ date, ...(now.days.get(date) ?? { due: 0, done: 0 }) }))
  }
}

// ---------- Mood ----------

// 1 (rough) to 5 (great). The Logbook only stores the word, so this is the one place that turns it into a number.
export const MOOD_SCORE: Record<Mood, number> = { great: 5, good: 4, okay: 3, low: 2, rough: 1 }

const mean = (xs: number[]): number => xs.reduce((a, b) => a + b, 0) / xs.length

function moodSection(entries: LogEntry[], range: PeriodRange, prev: PeriodRange, days: string[]): ReviewMood {
  const withMood = (from: string, to: string) =>
    entries.filter((e) => e.mood !== null && e.mood in MOOD_SCORE && inRange(e.date, from, to))
  const mine = withMood(range.start, range.end)
  const before = withMood(prev.start, prev.end)
  const counts = Object.fromEntries(MOODS.map((m) => [m, 0])) as Record<Mood, number>
  const perDay = new Map<string, number[]>()
  for (const e of mine) {
    counts[e.mood as Mood]++
    perDay.set(e.date, [...(perDay.get(e.date) ?? []), MOOD_SCORE[e.mood as Mood]])
  }
  const series = days.map((date) => ({ date, average: perDay.has(date) ? mean(perDay.get(date) as number[]) : null }))
  const logged = series.filter((d): d is { date: string; average: number } => d.average !== null)

  // The worst entry of the period, but only when it really was a low day.
  const worst = [...mine].sort((a, b) => MOOD_SCORE[a.mood as Mood] - MOOD_SCORE[b.mood as Mood] || a.date.localeCompare(b.date))[0]
  const lowest = worst && MOOD_SCORE[worst.mood as Mood] <= 2 ? { date: worst.date, mood: worst.mood as Mood } : null

  // Second half of the logged days against the first half. Needs at least four days to say anything.
  let trend: ReviewMood['trend'] = null
  if (logged.length >= 4) {
    const half = Math.floor(logged.length / 2)
    const diff = mean(logged.slice(-half).map((d) => d.average)) - mean(logged.slice(0, half).map((d) => d.average))
    trend = diff >= 0.5 ? 'up' : diff <= -0.5 ? 'down' : 'steady'
  }
  return {
    logged: mine.length,
    average: mine.length ? mean(mine.map((e) => MOOD_SCORE[e.mood as Mood])) : null,
    previousAverage: before.length ? mean(before.map((e) => MOOD_SCORE[e.mood as Mood])) : null,
    counts, days: series, lowest, trend
  }
}

// ---------- Journal ----------

const isReflection = (e: LogEntry): boolean => e.tags.includes(REVIEW_TAG)

function journalSection(entries: LogEntry[], range: PeriodRange, title: string): ReviewJournal {
  const mine = entries
    .filter((e) => !isReflection(e) && inRange(e.date, range.start, range.end))
    .sort((a, b) => b.date.localeCompare(a.date) || b.id - a.id)
  return {
    entries: mine,
    daysWritten: new Set(mine.map((e) => e.date)).size,
    reflection: entries.find((e) => isReflection(e) && e.title === title) ?? null
  }
}

// ---------- Links between the tools ----------

const one = (n: number): string => n.toFixed(1)
const two = (n: number): string => n.toFixed(2)
const signed = (n: number): string => `${n > 0 ? '+' : n < 0 ? '-' : ''}${two(Math.abs(n))}`
const plural = (n: number, word: string, many = `${word}s`): string => `${n} ${n === 1 ? word : many}`

const SAME = 0.3 // mood averages closer than this are called "about the same"
const MIN_DAYS = 2 // each side of a comparison needs at least this many days, or it says nothing

// Only said when each side has enough days. It describes what happened; it does not claim one thing caused the other.
function insightsOf(trades: ReviewTrades, habits: ReviewHabits, mood: ReviewMood): ReviewData['insights'] {
  const moodOn = new Map(mood.days.filter((d) => d.average !== null).map((d) => [d.date, d.average as number]))
  const out: ReviewData['insights'] = []

  const full: number[] = [], other: number[] = []
  for (const d of habits.days) {
    const m = moodOn.get(d.date)
    if (d.due > 0 && m !== undefined) (d.done === d.due ? full : other).push(m)
  }
  if (full.length >= MIN_DAYS && other.length >= MIN_DAYS) {
    const a = mean(full), b = mean(other)
    out.push({
      id: 'habits-mood',
      text: Math.abs(a - b) < SAME
        ? `Mood was about the same on the ${plural(full.length, 'day')} you finished every habit (${one(a)} of 5) and on the ${plural(other.length, 'other day')} (${one(b)} of 5).`
        : `Mood averaged ${one(a)} of 5 on the ${plural(full.length, 'day')} you finished every habit and ${one(b)} of 5 on the ${plural(other.length, 'other day')}.`
    })
  }

  const win: number[] = [], loss: number[] = []
  for (const d of trades.days) {
    const m = moodOn.get(d.date)
    if (d.closed > 0 && m !== undefined && d.pnl !== 0) (d.pnl > 0 ? win : loss).push(m)
  }
  if (win.length >= MIN_DAYS && loss.length >= MIN_DAYS) {
    const a = mean(win), b = mean(loss)
    out.push({
      id: 'trades-mood',
      text: Math.abs(a - b) < SAME
        ? `Mood was about the same on the ${plural(win.length, 'day')} your trades made money (${one(a)} of 5) and the ${plural(loss.length, 'day')} they lost (${one(b)} of 5).`
        : `Mood averaged ${one(a)} of 5 on the ${plural(win.length, 'day')} your closed trades made money and ${one(b)} of 5 on the ${plural(loss.length, 'day')} they lost.`
    })
  }
  return out
}

// The order of prompts returned from promptsOf is:\n//   1. Trades loss/win/open prompts (if applicable) - triggered by trade stats\n//   2. Habit weakness/strong prompts - triggered by habit completion stats\n//   3. Mood low prompt - triggered if a low mood day is found\n//   4. Savings up/down prompt - triggered if savings changed\n//   5. Generic prompts: 'went well' and 'change' - always the last two\n//\n// This ordering ensures that period-specific insights come first,\n// followed by habit/mood/savings observations, and ends with\n// two universal reflection questions that always apply.\n//\n// The array order matters for UI rendering - prompts are displayed in the\n// order they appear here, with the first ones being most period-specific.\n//\n// Original: The ones about this period's numbers come first, then two that always apply.\n//\n// Questions for the reflection. The ones about this period's numbers come first, then two that always apply.
function promptsOf(d: Pick<ReviewData, 'kind' | 'complete' | 'trades' | 'savings' | 'habits' | 'mood'>): ReviewData['prompts'] {
  const word = d.kind === 'week' ? 'week' : 'month'
  const when = `${d.complete ? 'that' : 'this'} ${word}`
  const out: ReviewData['prompts'] = []
  const ts = d.trades.stats

  if (ts.closed > 0 && ts.totalPnl < 0) {
    out.push({ id: 'trades-loss', text: `Your closed trades netted ${signed(ts.totalPnl)} (${plural(ts.wins, 'win')}, ${plural(ts.losses, 'loss', 'losses')}). Did you follow your plan on each one, and what would you do differently?` })
  } else if (ts.closed > 0 && ts.totalPnl > 0) {
    out.push({ id: 'trades-win', text: `Your closed trades netted ${signed(ts.totalPnl)} (${plural(ts.wins, 'win')}, ${plural(ts.losses, 'loss', 'losses')}). Which result came from following the plan, and which was luck?` })
  } else if (ts.open > 0) {
    out.push({ id: 'trades-open', text: `You have ${plural(ts.open, 'open trade')} from ${when}. What is the plan for ${ts.open === 1 ? 'it' : 'them'}?` })
  }

  const weak = d.habits.habits.find((h) => h.due >= 2 && h.rate !== null && h.rate < 70)
  if (weak) {
    out.push({ id: 'habit-weak', text: `"${weak.name}" was done ${weak.done} of ${weak.due} scheduled days. What got in the way, and what would make it easier next time?` })
  } else if (d.habits.due >= 3 && d.habits.rate !== null && d.habits.rate >= 80) {
    out.push({ id: 'habit-strong', text: `You kept up ${Math.round(d.habits.rate)}% of your habits. What made that easier, and how do you protect it?` })
  }

  if (d.mood.lowest) {
    const [, m, day] = parts(d.mood.lowest.date)
    out.push({ id: 'mood-low', text: `Your lowest mood was on ${WEEKDAY_NAMES[weekdayOf(d.mood.lowest.date)]} ${day} ${MONTHS_SHORT[m - 1]} (${d.mood.lowest.mood}). What was going on, and did anything help?` })
  }

  if (d.savings.net > 0) {
    out.push({ id: 'savings-up', text: `You added ${two(d.savings.net)} to your savings. What made that possible, and what is the next step toward your goals?` })
  } else if (d.savings.net < 0) {
    out.push({ id: 'savings-down', text: `Your savings went down by ${two(Math.abs(d.savings.net))}. Was that planned, and does it change any goal?` })
  }

  out.push({ id: 'went-well', text: `What went well ${when}, and what do you want more of?` })
  out.push({ id: 'change', text: `What is one thing you will do differently next ${word}?` })
  return out
}

// Plain-text snapshot of the numbers, for pasting into the reflection so the entry keeps them for later.
export function summaryText(d: ReviewData): string {
  const ts = d.trades.stats
  const lines = [`Numbers for ${d.label}`]
  lines.push(ts.closed === 0
    ? `- Trades: no closed trades${ts.open > 0 ? ` (${ts.open} still open)` : ''}`
    : `- Trades: ${ts.closed} closed (${plural(ts.wins, 'win')}, ${plural(ts.losses, 'loss', 'losses')}), net P&L ${signed(ts.totalPnl)}${ts.totalFees > 0 ? `, fees ${two(ts.totalFees)}` : ''}`)
  lines.push(d.savings.txCount === 0
    ? '- Savings: no deposits or withdrawals'
    : `- Savings: net ${signed(d.savings.net)} (deposits ${two(d.savings.deposits)}, withdrawals ${two(d.savings.withdrawals)}), total balance ${two(d.savings.endBalance)}`)
  lines.push(d.habits.rate === null
    ? '- Habits: nothing scheduled to count'
    : `- Habits: ${Math.round(d.habits.rate)}% of scheduled days done (${d.habits.done} of ${d.habits.due})`)
  lines.push(d.mood.average === null
    ? '- Mood: none logged'
    : `- Mood: ${one(d.mood.average)} of 5 on average over ${plural(d.mood.logged, 'entry', 'entries')}`)
  return lines.join('\n')
}

// ---------- The whole review ----------

export interface ReviewInput {
  kind: ReviewKind
  anchor: string // any date inside the period
  today: string
  trades: Trade[] // any superset: only trades dated in the period and the one before are used
  goals: SavingsGoal[]
  txs: SavingsTx[] // every transaction
  habits: Habit[] // with stats worked out for `today`
  tasks: Task[]
  entries: LogEntry[] // entries in the period and the one before, plus every review reflection
}

export function buildReview(i: ReviewInput): ReviewData {
  const range = reviewRange(i.kind, i.anchor)
  const prev = shiftRange(i.kind, range, -1)
  const days = periodDays(range.start, range.end)
  const title = reviewTitle(i.kind, range.start, range.end)
  const trades = tradesSection(i.trades, range, prev, days)
  const savings = savingsSection(i.goals, i.txs, range, prev)
  const habits = habitsSection(i.habits, range, prev, i.today, days)
  const tasks = taskReview(i.tasks, range.start, range.end)
  const mood = moodSection(i.entries, range, prev, days)
  const complete = i.today > range.end
  return {
    kind: i.kind, start: range.start, end: range.end, today: i.today, complete,
    prevStart: prev.start, prevEnd: prev.end,
    label: periodLabel(i.kind, range.start, range.end), title,
    trades, savings, habits, tasks, mood,
    journal: journalSection(i.entries, range, title),
    insights: insightsOf(trades, habits, mood),
    prompts: promptsOf({ kind: i.kind, complete, trades, savings, habits, mood })
  }
}
