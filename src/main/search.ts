// Universal search: asks each module's own query code for matches and bundles
// the answers. The table-specific SQL lives next to each table (logbook.ts,
// trades.ts, savings.ts), so a schema change only has to be fixed in one place.
import type Database from 'better-sqlite3'
import { isEmptyQuery, parseQuery } from '../shared/search'
import { searchEntries } from './logbook'
import { searchTrades } from './trades'
import { searchGoals, searchTransactions } from './savings'
import { listTasks } from './tasks'
import type { SearchResults } from '../shared/types'

const DEFAULT_LIMIT = 8
const MAX_LIMIT = 100

export function runSearch(db: Database.Database, text: string, limit: number = DEFAULT_LIMIT): SearchResults {
  const q = parseQuery(text)
  const n = Math.min(MAX_LIMIT, Math.max(1, Math.floor(Number(limit)) || DEFAULT_LIMIT))
  if (isEmptyQuery(q)) {
    const none = { items: [], total: 0 }
    return { logbook: none, trades: none, goals: none, transactions: none, tasks: none }
  }
  const tasks = listTasks(db).filter((task) => {
    const values = [task.title, task.notes, task.project ?? '', ...task.tags].map((value) => value.toLowerCase())
    return q.terms.every((term) => values.some((value) => value.includes(term.toLowerCase()))) &&
      q.tags.every((tag) => task.tags.some((value) => value.toLowerCase().startsWith(tag)))
  })
  return {
    logbook: searchEntries(db, q, n),
    trades: searchTrades(db, q, n),
    goals: searchGoals(db, q, n),
    transactions: searchTransactions(db, q, n),
    tasks: { items: tasks.slice(0, n), total: tasks.length }
  }
}
