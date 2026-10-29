// Dashboard: gathers everything the home page shows in ONE request, so the
// page loads in a single round trip. Each table's own query code does the work.
import type Database from 'better-sqlite3'
import { round8 } from '../shared/math'
import { computeStats, pnlSeries } from '../shared/trades'
import { logbookSummary, recentEntries } from './logbook'
import { listTrades, recentTrades } from './trades'
import { listGoals } from './savings'
import { listHabits } from './habits'
import { habitsToday } from '../shared/dashboard'
import { isDate } from './util'
import type { DashboardData } from '../shared/types'

const RECENT = 5 // how many recent entries / trades to show

export function getDashboard(db: Database.Database, today: string): DashboardData {
  if (!isDate(today)) throw new Error('Date must look like 2026-10-25')
  const goals = listGoals(db)
  const trades = listTrades(db)
  return {
    recentEntries: recentEntries(db, RECENT),
    recentTrades: recentTrades(db, RECENT),
    goals,
    tradeStats: computeStats(trades),
    pnlSeries: pnlSeries(trades),
    totalSaved: round8(goals.reduce((sum, g) => sum + g.balance, 0)),
    log: logbookSummary(db, today),
    habits: habitsToday(listHabits(db, today).habits, today) // same request, no extra round trip
  }
}
