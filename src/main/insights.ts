// Insights: fetches the window's rows and hands them to the pure statistics
// module (src/shared/insights.ts). Dismissed insight ids live in their own
// settings key so they are not coupled to the Intelligence feature toggles.
import type Database from 'better-sqlite3'
import { buildInsights, MIN_WEEKS } from '../shared/insights'
import type { InsightsResult } from '../shared/insights'
import { listEntries } from './logbook'
import { listTrades } from './trades'
import { listAllTransactions } from './savings'
import { listHabits } from './habits'
import { listCompletions, listTasks } from './tasks'
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
    completions: listCompletions(db, { from: start, to: today }),
    trades: listTrades(db),
    txs: listAllTransactions(db),
    entries: listEntries(db, { from: start, to: today })
  })
  const saved = getSettings() as ReturnType<typeof getSettings> & { insightDismissals?: string[] }
  return { ...result, dismissed: saved.insightDismissals ?? [] }
}

// Remember (or forget) a dismissed insight id. Only ids the engine actually
// produces are accepted, so the list cannot grow unbounded with junk.
export function setInsightDismissed(db: Database.Database, id: string, dismissed: boolean): string[] {
  void db
  const KNOWN = ['savings-by-habits', 'trades-by-habits', 'mood-by-tasks', 'mood-vs-tasks']
  if (!KNOWN.includes(id)) throw new Error('Unknown insight id')
  const saved = getSettings() as ReturnType<typeof getSettings> & { insightDismissals?: string[] }
  const current = new Set(saved.insightDismissals ?? [])
  if (dismissed) current.add(id)
  else current.delete(id)
  setSetting('insightDismissals', [...current])
  return [...current]
}

export { MIN_WEEKS }
