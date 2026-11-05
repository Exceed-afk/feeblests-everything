// Insights: fetches the window's rows and hands them to the pure statistics
// module (src/shared/insights.ts). Snoozed/hidden insight ids live in their own
// settings key ({ id, until }[], I3) so they are not coupled to the toggles.
import type Database from 'better-sqlite3'
import { buildInsights, isInsightId, MIN_WEEKS } from '../shared/insights'
import type { InsightsResult } from '../shared/insights'
import { listEntries } from './logbook'
import { listTrades } from './trades'
import { listAllTransactions } from './savings'
import { listExpenseTransactions } from '../modules/expenses/service/transactions'
import { listNotes } from './notes'
import { listSessions } from './focus'
import { listPublishedBetween } from './content'
import { listHabits } from './habits'
import { listCompletions, listTasks } from './tasks'
import { getSettings, setSetting } from './db'
import { isDate } from './util'

export interface InsightDismissal { id: string; until: string | null } // null = hidden until restored

// How far back the window reaches. Six full weeks covers the MIN_WEEKS bar with
// room for partial weeks; a longer window would blur "recent" beyond usefulness.
export const WINDOW_WEEKS = 6

export const SNOOZE_WEEKS = 4

const addDays = (iso: string, n: number): string =>
  new Date(Date.parse(iso) + n * 86_400_000).toISOString().slice(0, 10)

// Reads the dismissals list from ANY handle (the app's or a test's own db).
function readDismissalsFrom(handle: Database.Database): InsightDismissal[] {
  const row = handle.prepare("SELECT value FROM settings WHERE key = 'insightDismissals'").get() as { value: string } | undefined
  if (!row) return []
  let parsed: unknown
  try { parsed = JSON.parse(row.value) } catch { return [] }
  if (!Array.isArray(parsed)) return []
  return parsed.flatMap((item): InsightDismissal[] => {
    if (typeof item === 'string') return [{ id: item, until: null }] // old format
    if (item && typeof item === 'object' && typeof (item as { id?: unknown }).id === 'string') {
      const until = (item as { until?: unknown }).until
      return [{ id: (item as { id: string }).id, until: typeof until === 'string' ? until : null }]
    }
    return []
  })
}

function readDismissals(): InsightDismissal[] {
  const saved = getSettings() as ReturnType<typeof getSettings> & { insightDismissals?: unknown }
  const raw = saved.insightDismissals
  if (!Array.isArray(raw)) return []
  return raw.flatMap((item): InsightDismissal[] => {
    if (typeof item === 'string') return [{ id: item, until: null }] // old format
    if (item && typeof item === 'object' && typeof (item as { id?: unknown }).id === 'string') {
      const until = (item as { until?: unknown }).until
      return [{ id: (item as { id: string }).id, until: typeof until === 'string' ? until : null }]
    }
    return []
  })
}

// A dismissal is active when it has no end (hidden) or the end day has not
// passed: the snooze covers THROUGH its `until` day and resurfaces the day after.
export const isDismissedOn = (d: InsightDismissal, today: string): boolean =>
  d.until === null || d.until >= today

export function getInsights(db: Database.Database, today: string): InsightsResult & {
  dismissed: InsightDismissal[]
  snoozeWeeks: number
} {
  if (!isDate(today)) throw new Error('Date must look like 2026-10-25')
  const startMs = Date.parse(today) - (WINDOW_WEEKS * 7) * 86_400_000
  const start = new Date(startMs).toISOString().slice(0, 10)

  const result = buildInsights({
    today,
    start,
    end: today,
    habits: listHabits(db, today).habits,
    tasks: listTasks(db, today),
    completions: listCompletions(db, { from: start, to: today }),
    trades: listTrades(db),
    txs: listAllTransactions(db),
    entries: listEntries(db, { from: start, to: today }),
    expenses: listExpenseTransactions(db, { startDate: start, endDate: today }),
    notes: listNotes(db).map((n) => ({ id: n.id, createdAt: n.createdAt })),
    focusSessions: listSessions(db, { from: start, to: today }).map((s) => ({ startedAt: s.startedAt, endedAt: s.endedAt, type: s.type })),
    contentPublished: listPublishedBetween(db, start, today).map((c) => ({ id: c.id, publishedDate: c.publishedDate! }))
  })
  // Only ACTIVE dismissals reach the page; expired snoozes resurface the card.
  const dismissed = readDismissalsFrom(db).filter((d) => isDismissedOn(d, today))
  return { ...result, dismissed, snoozeWeeks: SNOOZE_WEEKS }
}

// Snooze (until a day 4 weeks out), hide (until restored) or restore one id.
export function setInsightDismissed(
  db: Database.Database, id: string, dismissed: boolean, mode: 'snooze' | 'hide' | 'restore' = 'hide', today: string = new Date().toISOString().slice(0, 10)
): InsightDismissal[] {
  if (!isInsightId(id)) throw new Error('Unknown insight id')
  const current = readDismissalsFrom(db).filter((d) => d.id !== id)
  if (dismissed && mode !== 'restore') {
    current.push({ id, until: mode === 'snooze' ? addDays(today, SNOOZE_WEEKS * 7) : null })
  }
  const next = current.sort((a, b) => a.id.localeCompare(b.id))
  db.prepare("INSERT INTO settings (key, value) VALUES ('insightDismissals', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
    .run(JSON.stringify(next))
  return next
}

export { MIN_WEEKS }
