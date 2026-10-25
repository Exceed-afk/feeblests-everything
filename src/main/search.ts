// Universal search: asks each module's own query code for matches and bundles
// the answers. The table-specific SQL lives next to each table (logbook.ts,
// trades.ts, savings.ts), so a schema change only has to be fixed in one place.
import type Database from 'better-sqlite3'
import { isEmptyQuery, parseQuery } from '../shared/search'
import { searchEntries } from './logbook'
import { searchTrades } from './trades'
import { searchGoals, searchTransactions } from './savings'
import type { SearchResults } from '../shared/types'

const DEFAULT_LIMIT = 8
const MAX_LIMIT = 100

export function runSearch(db: Database.Database, text: string, limit: number = DEFAULT_LIMIT): SearchResults {
  const q = parseQuery(text)
  const n = Math.min(MAX_LIMIT, Math.max(1, Math.floor(Number(limit)) || DEFAULT_LIMIT))
  if (isEmptyQuery(q)) {
    const none = { items: [], total: 0 }
    return { logbook: none, trades: none, goals: none, transactions: none }
  }
  return {
    logbook: searchEntries(db, q, n),
    trades: searchTrades(db, q, n),
    goals: searchGoals(db, q, n),
    transactions: searchTransactions(db, q, n)
  }
}
