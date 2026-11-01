import assert from 'node:assert/strict'
import { createTrade, updateTrade } from '../src/main/trades'
import { applyMigrations } from '../src/main/migrations'
import { addDays } from '../src/shared/habits'
import { localDate } from '../src/main/util'
import type { TradeInput } from '../src/shared/types'
import { openDatabase } from './sqlite'

let n = 0
const test = (name: string, fn: () => void) => { fn(); n++; console.log('ok  ', name) }

function openAutomationDb() {
  const db = openDatabase()
  applyMigrations(db)
  db.prepare("INSERT INTO settings (key, value) VALUES ('automations', ?)").run(
    JSON.stringify({ lossReflection: true, lossThreshold: 50 })
  )
  return db
}

const losingTrade = (date: string, notes = ''): TradeInput => ({
  date, asset: 'XAUUSD', direction: 'long',
  entryPrice: 100, exitPrice: 40, quantity: 1, fees: 0, notes, tags: []
})

const counts = (db: ReturnType<typeof openDatabase>) => ({
  drafts: (db.prepare('SELECT COUNT(*) AS n FROM logbook_entries').get() as { n: number }).n,
  events: (db.prepare('SELECT COUNT(*) AS n FROM automation_events').get() as { n: number }).n
})

test('creating a closed losing trade creates one reflection draft and editing does not duplicate it', () => {
  const db = openAutomationDb()
  try {
    const today = localDate()
    const trade = createTrade(db, losingTrade(today))
    assert.equal(trade.pnl, -60)
    assert.deepEqual(counts(db), { drafts: 1, events: 1 })

    updateTrade(db, trade.id, losingTrade(today, 'edited later'))
    assert.deepEqual(counts(db), { drafts: 1, events: 1 })
  } finally {
    db.close()
  }
})

test('creating or editing a closed trade dated 30 days ago creates no reflection draft', () => {
  const db = openAutomationDb()
  try {
    const oldDate = addDays(localDate(), -30)
    const trade = createTrade(db, losingTrade(oldDate))
    assert.deepEqual(counts(db), { drafts: 0, events: 0 })

    updateTrade(db, trade.id, losingTrade(oldDate, 'edited later'))
    assert.deepEqual(counts(db), { drafts: 0, events: 0 })
  } finally {
    db.close()
  }
})

console.log(`\n${n} closed-trade automation checks passed`)
