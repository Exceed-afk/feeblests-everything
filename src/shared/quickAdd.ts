// Natural-language quick-add PARSER (pure): a typed sentence in, a structured
// proposal out. No AI, no network, no dependencies — every pattern is a plain
// regular expression with a keyword trigger, so a new pattern is one small
// addition to PATTERNS below. The parser NEVER saves anything: the UI shows the
// proposal as a preview the user edits or cancels (see QuickAddPreview).
//
// Dates are computed from `today` ("YYYY-MM-DD", local) with plain UTC date
// arithmetic, so time zones cannot shift a day. Currency words, relative dates
// (today / tomorrow / next Monday / in 3 days), weekdays, recurrence phrases and
// priorities are all handled here.
import { addDays, weekdayOf } from './habits'
import type { TaskRecurrence, TxKind } from './types'

// ---------- what one sentence can become ----------

export type QuickAddProposal =
  | { kind: 'deposit'; txKind: TxKind; amount: number; goalName: string | null; note: string }
  | { kind: 'task'; title: string; dueDate: string | null; priority: 'low' | 'medium' | 'high'; recurrence: TaskRecurrence | null }
  | { kind: 'habit-checkin'; habitName: string }
  | { kind: 'note'; title: string; body: string }

export interface QuickAddParse {
  proposal: QuickAddProposal
  confidence: 'high' | 'medium' // the preview asks the user when it is not 'high'
  matchedPattern: string // e.g. "deposit", for tests and the preview's footnote
}

export type QuickAddResult =
  | { ok: true; parse: QuickAddParse }
  | { ok: false; error: string } // clearly not quick-add-able, or missing a required piece

// ---------- small helpers ----------

const WEEKDAY_WORDS: Record<string, number> = {
  monday: 0, tuesday: 1, wednesday: 2, thursday: 3, friday: 4, saturday: 5, sunday: 6,
  mon: 0, tue: 1, tues: 1, wed: 2, thu: 3, thur: 3, thurs: 3, fri: 4, sat: 5, sun: 6
}
const PRIORITIES = ['low', 'medium', 'high']

export function nextWeekday(today: string, target: number, forceNextWeek: boolean): string {
  const cur = weekdayOf(today)
  let delta = (target - cur + 7) % 7
  if (delta === 0) delta = 7
  if (forceNextWeek && delta < 7) delta += 7
  return addDays(today, delta)
}

const fmtNum = (n: number): string => String(Math.round(n * 100) / 100)

// ---------- the sentence patterns ----------
// Order matters: the first pattern whose TRIGGER matches the whole line wins, so
// keep the most specific phrases first. A pattern is { triggers, build }.

interface QuickAddContext {
  today: string
  goalNames?: string[] // known goals, for exact-name matching on deposits
  habitNames?: string[] // known habits, for check-ins
}

interface Pattern {
  id: string
  triggers: RegExp // the whole (trimmed, lowercased) line must match this
  build: (line: string, ctx: QuickAddContext) => QuickAddResult | null // null = not for this pattern after all
}

// Splits "task call dentist friday high priority" -> keyword "task", rest "call dentist friday high priority".
const stripKeyword = (line: string, keyword: string): string | null => {
  const m = new RegExp(`^${keyword}\\s+(.+)$`, 'i').exec(line)
  return m ? m[1].trim() : null
}

const PATTERNS: Pattern[] = [
  // ---- deposits / withdrawals: "deposit 200 to vacation fund", "add 25 to trip fund", "withdraw 10 from car" ----
  {
    id: 'deposit',
    triggers: /^(deposit|withdraw|add|save|put)\s+/i,
    build: (line, _ctx) => {
      const m = /^(deposit|withdraw|add|save|put)\s+(?:\$|€|£)?(\d+(?:[.,]\d{1,2})?)\s*(?:to|into|from|in)\s+(.+)$/i.exec(line)
      if (!m) return null
      const verb = m[1].toLowerCase()
      const amount = Number(m[2].replace(',', '.'))
      if (!(amount > 0)) return { ok: false, error: 'The amount must be above 0.' }
      let rest = m[3].trim()
      let note = ''
      const nm = /^(.+?)\s+(?:for|because|note)\s+(.+)$/i.exec(rest)
      if (nm) { rest = nm[1].trim(); note = nm[2].trim() }
      const goalName = matchName(rest, _ctx.goalNames)
      const txKind: TxKind = verb === 'withdraw' ? 'withdrawal' : 'deposit'
      return {
        ok: true,
        parse: {
          proposal: { kind: 'deposit', txKind, amount, goalName, note },
          confidence: goalName === null ? 'medium' : 'high',
          matchedPattern: 'deposit'
        }
      }
    }
  },

  // ---- recurring tasks: "task pay rent every month on the 1st", "task water plants weekly" ----
  {
    id: 'task-recurring',
    triggers: /^task\s+/i,
    build: (line, _ctx) => {
      const rest = stripKeyword(line, 'task')
      if (!rest) return null
      const rec = parseRecurrence(rest)
      if (!rec) return null
      const title = rest.replace(rec.matched, '').replace(/\s+/g, ' ').trim()
      if (!title) return { ok: false, error: 'Give the task a name, e.g. "task pay rent every month on the 1st".' }
      return {
        ok: true,
        parse: {
          proposal: { kind: 'task', title, dueDate: rec.dueDate, priority: 'medium', recurrence: rec.recurrence },
          confidence: 'high',
          matchedPattern: 'task-recurring'
        }
      }
    }
  },

  // ---- one-off tasks: "task call dentist friday high priority" ----
  {
    id: 'task',
    triggers: /^task\s+/i,
    build: (line, ctx) => {
      const rest = stripKeyword(line, 'task')
      if (!rest) return null
      const { title, dueDate, priority, matched } = parseTaskBits(rest, ctx.today)
      if (!title) return { ok: false, error: 'Give the task a name, e.g. "task call dentist friday".' }
      return {
        ok: true,
        parse: {
          proposal: { kind: 'task', title, dueDate, priority, recurrence: null },
          confidence: matched.date || matched.priority ? 'high' : 'medium',
          matchedPattern: 'task'
        }
      }
    }
  },

  // ---- habit check-ins: "habit check in meditation", "checked meditation", "did meditation" ----
  {
    id: 'habit-checkin',
    triggers: /^(habit|checked|did)\s+/i,
    build: (line, ctx) => {
      const m = /^(?:habit\s+check(?:\s*in)?(?:\s+off)?|checked(?:\s+off)?|did)\s+(?:my\s+)?(.+)$/i.exec(line)
      if (!m) return null
      const name = m[1].trim()
      if (!name) return null
      const known = matchName(name, ctx.habitNames)
      return {
        ok: true,
        parse: {
          proposal: { kind: 'habit-checkin', habitName: known ?? name },
          confidence: known ? 'high' : 'medium',
          matchedPattern: 'habit-checkin'
        }
      }
    }
  },

  // ---- notes: "note feeling tired today" (an explicit note) ----
  {
    id: 'note',
    triggers: /^note\s+/i,
    build: (line) => {
      const rest = stripKeyword(line, 'note')
      if (!rest) return null
      const [title, ...body] = rest.split(/\s*[;.:]\s*/) // "; " or ". " starts the body
      return {
        ok: true,
        parse: {
          proposal: { kind: 'note', title: title.trim(), body: body.join('. ').trim() },
          confidence: 'high',
          matchedPattern: 'note'
        }
      }
    }
  }
]

// Best-effort name match: exact (case-insensitive), then unique prefix, then null.
export function matchName(input: string, names?: string[]): string | null {
  if (!names || names.length === 0) return null
  const needle = input.trim().toLowerCase()
  if (!needle) return null
  const exact = names.find((n) => n.toLowerCase() === needle)
  if (exact) return exact
  const prefix = names.filter((n) => n.toLowerCase().startsWith(needle))
  return prefix.length === 1 ? prefix[0] : null
}

// ---------- date / recurrence / priority bit parsing (shared by task patterns) ----------

interface RecurrenceParse { recurrence: TaskRecurrence; dueDate: string | null; matched: string }

// "every month on the 1st", "weekly", "every 3 days", "every monday", "monthly on the 15th"
export function parseRecurrence(rest: string): RecurrenceParse | null {
  const monthlyDay = /every\s+month(?:\s+on\s+the)?\s+(\d{1,2})(?:st|nd|rd|th)?\b/i.exec(rest)
    ?? /monthly\s+on\s+the\s+(\d{1,2})(?:st|nd|rd|th)?\b/i.exec(rest)
  if (monthlyDay) {
    const matched = monthlyDay[0]
    const day = Number(monthlyDay[1])
    if (day >= 1 && day <= 31) {
      // The first occurrence lands on the day the user completes it first; the Tasks module
      // advances "monthly" from there (addTaskMonths clamps to the month's real end).
      return { recurrence: { frequency: 'monthly', intervalDays: 1 }, dueDate: null, matched }
    }
  }
  const everyNd = /every\s+(\d+)\s+days?\b/i.exec(rest)
  if (everyNd) {
    const n = Number(everyNd[1])
    if (n >= 1 && n <= 3650) return { recurrence: { frequency: 'custom', intervalDays: n }, dueDate: null, matched: everyNd[0] }
  }
  if (/\bevery\s+day\b|\bdaily\b/i.test(rest)) return { recurrence: { frequency: 'daily', intervalDays: 1 }, dueDate: null, matched: /\bevery\s+day\b|\bdaily\b/i.exec(rest)![0] }
  const everyWeekday = /every\s+(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i.exec(rest)
  if (everyWeekday) {
    return { recurrence: { frequency: 'weekly', intervalDays: 1 }, dueDate: null, matched: everyWeekday[0] }
  }
  const everyNw = /every\s+(\d+)\s+weeks?\b/i.exec(rest)
  if (everyNw) {
    const n = Number(everyNw[1])
    if (n >= 1 && n <= 520) return { recurrence: { frequency: 'weekly', intervalDays: n }, dueDate: null, matched: everyNw[0] }
  }
  if (/\bevery\s+week\b|\bweekly\b/i.test(rest)) {
    return { recurrence: { frequency: 'weekly', intervalDays: 1 }, dueDate: null, matched: /\bevery\s+week\b|\bweekly\b/i.exec(rest)![0] }
  }
  if (/\bevery\s+month\b|\bmonthly\b/i.test(rest)) {
    return { recurrence: { frequency: 'monthly', intervalDays: 1 }, dueDate: null, matched: /\bevery\s+month\b|\bmonthly\b/i.exec(rest)![0] }
  }
  return null
}

// A task sentence's bits: the title is what is left after date and priority words are pulled out.
export function parseTaskBits(rest: string, today: string): {
  title: string; dueDate: string | null; priority: 'low' | 'medium' | 'high'; matched: { date: boolean; priority: boolean }
} {
  let working = rest
  let priority: 'low' | 'medium' | 'high' = 'medium'
  let priorityMatched = false
  const pm = /\b(high|medium|low)(?:\s+priority)?\b|\bpriority\s+(?:high|medium|low)\b/i.exec(working)
  if (pm) {
    const word = /high|medium|low/i.exec(pm[0])![0].toLowerCase()
    if (PRIORITIES.includes(word)) { priority = word as 'low' | 'medium' | 'high'; priorityMatched = true; working = working.replace(pm[0], ' ') }
  }
  const date = parseRelativeDate(working, today)
  let dueDate: string | null = null
  let dateMatched = false
  if (date) { dueDate = date.iso; working = working.replace(date.matched, ' '); dateMatched = true }
  const title = working.replace(/\s+/g, ' ').trim()
  return { title, dueDate, priority, matched: { date: dateMatched, priority: priorityMatched } }
}

export interface RelativeDate { iso: string; matched: string }

// Relative dates, weekdays and weekday names in a sentence.
export function parseRelativeDate(text: string, today: string): RelativeDate | null {
  const lower = text.toLowerCase()

  const todayM = /\btoday\b/i.exec(text)
  if (todayM) return { iso: today, matched: todayM[0] }
  const tomorrowM = /\btomorrow\b/i.exec(text)
  if (tomorrowM) return { iso: addDays(today, 1), matched: tomorrowM[0] }

  const inNd = /\bin\s+(\d+)\s+days?\b/i.exec(text)
  if (inNd) return { iso: addDays(today, Number(inNd[1])), matched: inNd[0] }

  const nextWeekdayM = /\bnext\s+(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i.exec(text)
  if (nextWeekdayM) {
    const wd = WEEKDAY_WORDS[nextWeekdayM[1].toLowerCase()]
    return { iso: nextWeekday(today, wd, true), matched: nextWeekdayM[0] }
  }

  // A bare weekday name: "friday" means the NEXT friday (today included when it is today).
  const weekdayM = /\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday|mon|tue|tues|wed|thu|thur|thurs|fri|sat|sun)\b/i.exec(text)
  if (weekdayM) {
    const wd = WEEKDAY_WORDS[weekdayM[1].toLowerCase()]
    // Don't eat a word that is part of a recurrence phrase — the recurrence parser handles those.
    if (/\bevery\s+(day|week|month)\b|\bweekly|\bmonthly|\bdaily\b/i.test(lower)) return null
    return { iso: nextWeekday(today, wd, false), matched: weekdayM[0] }
  }

  return null
}

// ---------- entry point ----------

export function parseQuickAdd(text: string, ctx: QuickAddContext): QuickAddResult {
  const line = text.trim().replace(/\s+/g, ' ')
  if (!line) return { ok: false, error: 'Type something first.' }
  for (const p of PATTERNS) {
    if (!p.triggers.test(line)) continue
    const r = p.build(line, ctx)
    if (r !== null) return r
    // A pattern matched the trigger but not the content: keep looking (e.g. "add" without an amount
    // is probably the start of a note, not a deposit).
  }
  return { ok: false, error: 'Not recognised as a quick-add. Start with "note", "task", "deposit" or "habit check in".' }
}

// ---------- preview text (what the confirmation card says) ----------

export function describeProposal(p: QuickAddProposal): string {
  switch (p.kind) {
    case 'deposit':
      return `${p.txKind === 'withdrawal' ? 'Withdrawal' : 'Deposit'} of ${fmtNum(p.amount)}${p.goalName ? ` to ${p.goalName}` : ''}${p.note ? ` — ${p.note}` : ''}`
    case 'task': {
      const bits: string[] = []
      if (p.dueDate) bits.push(`due ${p.dueDate}`)
      if (p.priority !== 'medium') bits.push(`${p.priority} priority`)
      if (p.recurrence) bits.push(`repeats ${p.recurrence.frequency === 'custom' ? `every ${p.recurrence.intervalDays} days` : p.recurrence.frequency}`)
      return `Task: ${p.title}${bits.length > 0 ? ` (${bits.join(', ')})` : ''}`
    }
    case 'habit-checkin':
      return `Check in habit: ${p.habitName}`
    case 'note':
      return `Note: ${p.title}`
  }
}
