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
import { localDate } from './util'

export interface DailyCheckState { lastRun: string | null }

export const readDailyCheckState = (db: Database.Database): DailyCheckState => {
  const row = db.prepare("SELECT value FROM settings WHERE key = 'dailyCheckState'").get() as { value: string } | undefined
  if (!row) return { lastRun: null }
  try {
    const parsed: unknown = JSON.parse(row.value)
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      const state = parsed as Record<string, unknown>
      return { lastRun: typeof state.lastRun === 'string' ? state.lastRun : null }
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

// One row per check, so a test can drive the same list the app runs.
export type DailyCheck = (db: Database.Database, from: string, today: string) => void

// The checks themselves. P1 ships with an empty list; P3's streak-broken
// detection registers itself here, and later phases can add more.
export const CHECKS: { id: string; run: DailyCheck }[] = []

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
  writeDailyCheckState(db, { lastRun: today })
  return { ran: true }
}

// Re-exported so callers (and tests) have one import site for the emit path.
export { emitAutomation }
