import assert from 'node:assert/strict'
import { applyMigrations } from '../src/main/migrations'
import { createEntry } from '../src/main/logbook'
import { createTrade, updateTrade } from '../src/main/trades'
import { openDatabase } from './sqlite'

let n = 0
const test = (name: string, fn: () => void) => { fn(); n++; console.log('ok  ', name) }

function freshDb() {
  const db = openDatabase()
  applyMigrations(db)
  db.exec('DROP TABLE automation_events')
  return db
}

function captureErrors<T>(fn: () => T): { result: T; errors: unknown[][] } {
  const errors: unknown[][] = []
  const originalError = console.error
  console.error = (...args: unknown[]): void => { errors.push(args) }
  try {
    return { result: fn(), errors }
  } finally {
    console.error = originalError
  }
}

test('a Logbook entry saves when the automation activity table is missing', () => {
  const db = freshDb()
  db.prepare("INSERT INTO settings (key, value) VALUES ('intelligence', '{')").run()

  const { result: entry, errors } = captureErrors(() =>
    createEntry(db, { date: '2026-10-25', title: 'Saved entry', body: '', mood: null, tags: [] })
  )

  assert.equal(entry.title, 'Saved entry')
  assert.equal((db.prepare('SELECT COUNT(*) AS count FROM logbook_entries').get() as { count: number }).count, 1)
  assert.equal(errors.length, 1, 'the automation failure is logged')
  db.close()
})

test('closing a trade saves when automation activity cannot be recorded', () => {
  const db = freshDb()
  db.prepare("INSERT INTO settings (key, value) VALUES ('automations', ?)").run(
    JSON.stringify({ lossReflection: true, lossThreshold: 50 })
  )
  const open = createTrade(db, {
    date: '2026-10-25', asset: 'XAUUSD', direction: 'long',
    entryPrice: 100, exitPrice: null, quantity: 1, fees: 0, notes: '', tags: []
  })

  const { result: closed, errors } = captureErrors(() => updateTrade(db, open.id, {
    date: open.date, asset: open.asset, direction: open.direction,
    entryPrice: open.entryPrice, exitPrice: 40, quantity: open.quantity,
    fees: open.fees, notes: open.notes, tags: open.tags
  }))

  assert.equal(closed.exitPrice, 40)
  assert.equal(closed.pnl, -60)
  assert.equal((db.prepare('SELECT exit_price FROM trades WHERE id = ?').get(open.id) as { exit_price: number }).exit_price, 40)
  assert.equal(errors.length, 1, 'the automation failure is logged')
  assert.equal(errors[0][1], 'trade-closed')
  db.close()
})

test('a Logbook save still succeeds when automation settings cannot be read', () => {
  const db = openDatabase()
  applyMigrations(db)
  db.prepare("INSERT INTO settings (key, value) VALUES ('intelligence', '{')").run()

  const { result: entry, errors } = captureErrors(() =>
    createEntry(db, { date: '2026-10-25', title: 'Saved despite bad settings', body: '', mood: null, tags: [] })
  )

  assert.equal(entry.title, 'Saved despite bad settings')
  assert.equal(errors.length, 1)
  db.close()
})

console.log(`\n${n} automation safety checks passed`)
