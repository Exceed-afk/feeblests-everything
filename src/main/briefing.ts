// Daily briefing: fetches what the rules need from each tool's own query code and hands it to
// src/shared/briefing.ts, which does all the deciding. Nothing new is stored, and nothing here
// talks to the network.
import type Database from 'better-sqlite3'
import { buildBriefing } from '../shared/briefing'
import { automationSettings, automationActivity } from './automations'
import { listEntries } from './logbook'
import { listTrades } from './trades'
import { listAllTransactions, listGoals } from './savings'
import { listHabits } from './habits'
import { listTasks } from './tasks'
import { isDate } from './util'
import type { DailyBriefing } from '../shared/types'

export function getBriefing(db: Database.Database, today: string): DailyBriefing {
  if (!isDate(today)) throw new Error('Date must look like 2026-10-25')
  return buildBriefing({
    today,
    tasks: listTasks(db, today),
    habits: listHabits(db, today).habits,
    goals: listGoals(db),
    txs: listAllTransactions(db),
    trades: listTrades(db),
    entries: listEntries(db),
    automations: automationActivity(db, 5), // the Activity trail, newest few
    overdueDays: automationSettings().overdueTaskNudge ? automationSettings().overdueDays : Number.MAX_SAFE_INTEGER
  })
}
