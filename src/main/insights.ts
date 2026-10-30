// Insights: fetches the window's rows and hands them to the pure statistics
// module (src/shared/insights.ts). Nothing new is stored; dismissed insight ids
// live in the settings under `intelligence.dismissedInsights` so a dismissal is
// remembered but stays visible in the settings if the user wants it back.
import type Database from 'better-sqlite3'
import { buildInsights, MIN_WEEKS } from '../shared/insights'
import type { InsightsResult } from '../shared/insights'
import { listEntries } from './logbook'
import { listTrades } from './trades'
import { listAllTransactions } from './savings'
import { listHabits } from './habits'
import { listTasks } from './tasks'
import { getSettings, setSetting } from './db'
import { isDate } from './util'

// How far back the window reaches. Six full weeks covers the MIN_WEEKS bar with
// room for partial weeks; a longer window would blur "recent" beyond usefulness.
export const WINDOW_WEEKS = 6

export function getInsights(db: Database.Database, today: string): InsightsResult & { dismissed: string[] } {
  if (!isDate(today)) throw new Error('Date must look like 2026-10-25')
  const startMs = Date.parse(today) - (WINDOW_WEEKS * 7) * 86_400_000
  const start = new Date(startMs).toISOString().slice(0, 10)

  const result = buildInsights({
    today,
    start,
    end: today,
    habits: listHabits(db, today).habits,
    tasks: listTasks(db, today),
    trades: listTrades(db),
    txs: listAllTransactions(db),
    entries: listEntries(db, { from: start, to: today })
  })
  const saved = getSettings().intelligence as { dismissedInsights?: string[] } | undefined
  return { ...result, dismissed: saved?.dismissedInsights ?? [] }
}

// Remember (or forget) a dismissed insight id. Only ids the engine actually
// produces are accepted, so the list cannot grow unbounded with junk.
export function setInsightDismissed(db: Database.Database, id: string, dismissed: boolean): string[] {
  void db
  const KNOWN = ['savings-by-habits', 'trades-by-habits', 'mood-by-tasks', 'mood-vs-tasks']
  if (!KNOWN.includes(id)) throw new Error('Unknown insight id')
  const savedRaw = getSettings().intelligence
  const saved = (savedRaw === undefined || savedRaw === null
    ? {}
    : JSON.parse(JSON.stringify(savedRaw))) as Record<string, unknown>
  const current = new Set((saved.dismissedInsights as string[] | undefined) ?? [])
  if (dismissed) current.add(id)
  else current.delete(id)
  setSetting('intelligence', { ...saved, dismissedInsights: [...current] })
  return [...current]
}

export { MIN_WEEKS }
