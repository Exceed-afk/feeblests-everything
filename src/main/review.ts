// Review: fetches what the weekly / monthly summary needs from each tool's own query code and hands it to
// src/shared/review.ts, which does all the arithmetic. Nothing new is stored.
import type Database from 'better-sqlite3'
import { buildReview, reviewRange, shiftRange, REVIEW_TAG } from '../shared/review'
import { listEntries } from './logbook'
import { listTrades } from './trades'
import { listAllTransactions, listGoals } from './savings'
import { listHabits } from './habits'
import { listTasks } from './tasks'
import { listExpenseTransactions } from '../modules/expenses/service/transactions'
import { listCategories as listExpenseCategories } from '../modules/expenses/service/categories'
import { listNotesCreatedBetween } from './notes'
import { listSessions } from './focus'
import { listPublishedBetween } from './content'
import { splitSessionByDay } from '../shared/focus'
import { isDate } from './util'
import type { LogEntry, ReviewData, ReviewKind } from '../shared/types'

export function getReview(db: Database.Database, kind: ReviewKind, anchor: string, today: string): ReviewData {
  if (kind !== 'week' && kind !== 'month') throw new Error('Review must be for a week or a month')
  if (!isDate(anchor) || !isDate(today)) throw new Error('Date must look like 2026-10-25')
  const range = reviewRange(kind, anchor)
  const prev = shiftRange(kind, range, -1)

  // Entries of this period and the one before (for the mood comparison), plus every saved reflection, so
  // a reflection is found by its title even if its date was edited later. The two lists can overlap.
  const byId = new Map<number, LogEntry>()
  for (const e of [...listEntries(db, { from: prev.start, to: range.end }), ...listEntries(db, { tag: REVIEW_TAG })]) byId.set(e.id, e)

  return buildReview({
    kind, anchor, today,
    trades: listTrades(db, { from: prev.start, to: range.end }),
    goals: listGoals(db),
    txs: listAllTransactions(db),
    habits: listHabits(db, today).habits,
    tasks: listTasks(db, today),
    entries: [...byId.values()],
    expenses: listExpenseTransactions(db, { startDate: prev.start, endDate: range.end }),
    categories: listExpenseCategories(db, true),
    notesCreated: listNotesCreatedBetween(db, range.start, range.end).length,
    focusSeconds: listSessions(db, { from: range.start, to: range.end }).flatMap((s) =>
      splitSessionByDay(s.startedAt, s.endedAt).filter((sl) => sl.date >= range.start && sl.date <= range.end)
    ).reduce((sum, sl) => sum + sl.seconds, 0),
    contentPublished: listPublishedBetween(db, range.start, range.end).length
  })
}
