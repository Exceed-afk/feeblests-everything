// Calendar: fetches what the month grid needs from each tool's own queries and hands it to src/shared/calendar.ts,
// which lays it out. Nothing new is stored.
import type Database from 'better-sqlite3'
import { buildCalendar, gridRange, isMonth } from '../shared/calendar'
import { listEntries } from './logbook'
import { listTrades } from './trades'
import { listTransactionsBetween } from './savings'
import { listHabits } from './habits'
import { isDate } from './util'
import type { CalendarData } from '../shared/types'

export function getCalendar(db: Database.Database, month: string, today: string): CalendarData {
  if (!isMonth(month)) throw new Error('Month must look like 2026-10')
  if (!isDate(today)) throw new Error('Date must look like 2026-10-25')
  const { start, end } = gridRange(month) // the whole grid, so the greyed days of the neighbouring months show their activity too
  return buildCalendar({
    month, today,
    entries: listEntries(db, { from: start, to: end }),
    trades: listTrades(db, { from: start, to: end }),
    txs: listTransactionsBetween(db, start, end),
    habits: listHabits(db, today).habits
  })
}
