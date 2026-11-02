// The daily check: things that must run once per local day, not once per user
// action. Nothing here edits data — every check may only EMIT an automation
// event (which, through the normal rules, may show a message or create a draft
// tagged #automation).
//
// Idempotence: `dailyCheckState.lastRun` stores the last local day the checks
// ran. A second call on the same day does nothing, so it is safe to call this
// from startup AND from the reminders minute loop (the app open past midnight).
//
// Every check runs inside its own try/catch, and `lastRun` is written even if
// a check throws, so one broken rule cannot repeat or block the others.
import type Database from 'better-sqlite3'
import { automationSettings, emitAutomation } from './automations'
import { habitCompletionsOf, listHabits } from './habits'
import { effectiveStart, getDayStatus, streakBeforeMiss } from '../shared/habits'
import { localDate } from './util'

export interface DailyCheckState { lastRun: string | null; lastSeenDate?: string | null }

export const readDailyCheckState = (db: Database.Database): DailyCheckState => {
  const row = db.prepare("SELECT value FROM settings WHERE key = 'dailyCheckState'").get() as { value: string } | undefined
  if (!row) return { lastRun: null }
  try {
    const parsed: unknown = JSON.parse(row.value)
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      const state = parsed as Record<string, unknown>
      return {
        lastRun: typeof state.lastRun === 'string' ? state.lastRun : null,
        lastSeenDate: typeof state.lastSeenDate === 'string' ? state.lastSeenDate : null
      }
    }
  } catch { /* a broken row reads as "never ran" */ }
  return { lastRun: null }
}

export const writeDailyCheckState = (db: Database.Database, state: DailyCheckState): void => {
  db.prepare(
    "INSERT INTO settings (key, value) VALUES ('dailyCheckState', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value"
  ).run(JSON.stringify(state))
}

// The day we look back from on the FIRST run after an upgrade: only the last two
// days, so upgrading never floods the user with notes about old misses.
export const FIRST_RUN_LOOKBACK_DAYS = 2

const addDaysLocal = (iso: string, n: number): string => {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d) + n * 86_400_000).toISOString().slice(0, 10)
}

export const lookbackStart = (lastRun: string | null, today: string): string =>
  addDaysLocal(today, -(FIRST_RUN_LOOKBACK_DAYS - 1))

// The day the "what changed" briefing list should look back FROM. Written by
// the daily check after it runs, so the briefing built at startup sees the
// previous value; the main-window-close hook keeps it fresh otherwise.
export const changesSinceDate = (db: Database.Database, today: string = localDate()): string => {
  const state = readDailyCheckState(db)
  const seen = state.lastSeenDate ?? state.lastRun ?? null
  // Never further back than the no-flood window, and never into the future.
  if (!seen || seen >= today) return addDaysLocal(today, -(FIRST_RUN_LOOKBACK_DAYS - 1))
  const earliest = addDaysLocal(today, -(FIRST_RUN_LOOKBACK_DAYS - 1))
  return seen < earliest ? earliest : seen
}

// One row per check, so a test can drive the same list the app runs.
export type DailyCheck = (db: Database.Database, from: string, today: string) => void

// The checks themselves.
export const CHECKS: { id: string; run: DailyCheck }[] = [
  // P3: a genuinely missed due day after a streak of 7 or more. Today is never
  // "missed" (the day is not over), and the event key includes the missed day,
  // so it fires exactly once per miss.
  { id: 'streak-broken', run: checkStreakBreaks }
]

// Finds the most recent due day M before `today` with no record, per active
// habit, and emits `habit-streak-broken` when the streak that ended just
// before M was 7 or more and M is within the last 2 days.
function checkStreakBreaks(db: Database.Database, from: string, today: string): void {
  const settings = automationSettings(db)
  if (!settings.streakReminder) return
  const { habits } = listHabits(db, today)
  for (const habit of habits) {
    if (habit.archived) continue
    const completions = habitCompletionsOf(db, habit.id)
    const start = effectiveStart(habit, completions)
    // Walk back at most two days plus the lookback window: any further back is
    // old news that an earlier run should already have handled.
    let cursor = addDaysLocal(today, -1)
    let guard = 0
    while (cursor >= from && guard < 7) {
      guard++
      if (start && cursor < start) break // before the habit existed
      const status = getDayStatus(habit, cursor, completions, today, start)
      if (status !== 'missed') {
        cursor = addDaysLocal(cursor, -1)
        continue // done, skipped, rest or (never) pending: not a new miss
      }
      // M = cursor: the most recent unrecorded due day. The streak that ended
      // on the due day before it:
      const streak = streakBeforeMiss(habit, completions, cursor)
      if (streak >= 7) {
        emitAutomation(db, 'habit-streak-broken', `habit:${habit.id}:miss:${cursor}`, {
          habitId: habit.id, habitName: habit.name, habitStreak: streak
        }, { date: today })
      }
      break // only the MOST RECENT miss matters per check
    }
  }
}

// Runs every pending daily check, at most once per local day.
export function runDailyChecksIfNeeded(db: Database.Database, today: string = localDate()): { ran: boolean } {
  const state = readDailyCheckState(db)
  if (state.lastRun === today) return { ran: false }

  const from = lookbackStart(state.lastRun, today)
  // The master toggle gates the whole system; each rule below still checks its own switch.
  const masterOn = automationSettings(db) !== null
  if (masterOn) {
    for (const check of CHECKS) {
      try {
        check.run(db, from, today)
      } catch (error) {
        console.error(`[daily-check] "${check.id}" failed and was skipped:`, error)
      }
    }
  }

  // Written even when a check threw, and even when nothing was enabled: the
  // day is done either way, and retrying it tomorrow would double old notes.
  // P4: `lastSeenDate` advances ONLY here, after the "what changed" list was
  // built from the PREVIOUS value, so a day away is reported once.
  const previous = readDailyCheckState(db)
  writeDailyCheckState(db, { lastRun: today, lastSeenDate: previous.lastSeenDate ?? previous.lastRun ?? today })
  return { ran: true }
}

// Re-exported so callers (and tests) have one import site for the emit path.
export { emitAutomation }
