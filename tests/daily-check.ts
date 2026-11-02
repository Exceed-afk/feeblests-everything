import assert from 'node:assert/strict'
import { openDatabase } from './sqlite'
import { applyMigrations, MIGRATIONS } from '../src/main/migrations'
import {
  runDailyChecksIfNeeded, readDailyCheckState, writeDailyCheckState,
  lookbackStart, FIRST_RUN_LOOKBACK_DAYS, type DailyCheck
} from '../src/main/dailyCheck'
import { CHECKS } from '../src/main/dailyCheck'
import { automationSettings } from '../src/main/automations'

let n = 0
const test = (name: string, fn: () => void) => {
  try { fn(); n++; console.log('ok  ', name) } catch (e) { console.error(e); throw e }
}

const openDb = () => {
  const db = openDatabase()
  applyMigrations(db)
  return db
}

const TODAY = '2026-11-02'

// Registers a temporary check for one test; returns the restore function.
const withChecks = (checks: { id: string; run: DailyCheck }[]): (() => void) => {
  const original = [...CHECKS]
  CHECKS.length = 0
  CHECKS.push(...checks)
  return () => {
    CHECKS.length = 0
    CHECKS.push(...original)
  }
}

test('a second call on the same day does nothing', () => {
  const db = openDb()
  let runs = 0
  const restore = withChecks([{ id: 'counting', run: () => { runs++ } }])
  try {
    assert.deepEqual(runDailyChecksIfNeeded(db, TODAY), { ran: true })
    assert.equal(runs, 1)
    assert.deepEqual(runDailyChecksIfNeeded(db, TODAY), { ran: false })
    assert.equal(runs, 1)
  } finally { restore() }
  db.close()
})

test('a throwing check does not stop the others, and lastRun is still written', () => {
  const db = openDb()
  const ran: string[] = []
  const restore = withChecks([
    { id: 'broken', run: () => { throw new Error('boom') } },
    { id: 'fine', run: () => { ran.push('fine') } }
  ])
  try {
    const result = runDailyChecksIfNeeded(db, TODAY)
    assert.deepEqual(result, { ran: true })
    assert.deepEqual(ran, ['fine'])
    assert.equal(readDailyCheckState(db).lastRun, TODAY)
    assert.equal(readDailyCheckState(db).lastSeenDate, TODAY) // defaults to the day itself on a fresh db
    // and the same day still refuses to run again
    assert.deepEqual(runDailyChecksIfNeeded(db, TODAY), { ran: false })
  } finally { restore() }
  db.close()
})

test('a new day runs again', () => {
  const db = openDb()
  let runs = 0
  const restore = withChecks([{ id: 'counting', run: () => { runs++ } }])
  try {
    runDailyChecksIfNeeded(db, TODAY)
    runDailyChecksIfNeeded(db, '2026-11-03')
    assert.equal(runs, 2)
  } finally { restore() }
  db.close()
})

test('first run after an upgrade looks back only two days', () => {
  // No lastRun at all: from = today - (lookback - 1).
  assert.equal(lookbackStart(null, TODAY), '2026-11-01')
  assert.equal(FIRST_RUN_LOOKBACK_DAYS, 2)
  // An old or a recent lastRun changes nothing: the window is always the last
  // two local days, so no gap ever grows past two days and no flood can occur.
  assert.equal(lookbackStart('2026-09-01', TODAY), '2026-11-01')
  assert.equal(lookbackStart(TODAY, '2026-11-03'), '2026-11-02')
})

test('a broken state row reads as never having run', () => {
  const db = openDb()
  db.prepare("INSERT INTO settings (key, value) VALUES ('dailyCheckState', '{not json')").run()
  assert.deepEqual(readDailyCheckState(db), { lastRun: null })
  db.close()
})

test('state round-trips through the settings table', () => {
  const db = openDb()
  writeDailyCheckState(db, { lastRun: '2026-10-31' })
  assert.deepEqual(readDailyCheckState(db), { lastRun: '2026-10-31', lastSeenDate: null })
  writeDailyCheckState(db, { lastRun: '2026-10-31', lastSeenDate: '2026-10-30' })
  assert.deepEqual(readDailyCheckState(db), { lastRun: '2026-10-31', lastSeenDate: '2026-10-30' })
  db.close()
})

test('the checks run even when every rule is off; the state is still marked', () => {
  const db = openDb()
  // Default automation settings have every rule off; the daily check is about
  // the day being marked, not about whether a rule had something to say.
  assert.equal(automationSettings(db).streakReminder, false)
  const result = runDailyChecksIfNeeded(db, TODAY)
  assert.deepEqual(result, { ran: true })
  assert.equal(readDailyCheckState(db).lastRun, TODAY)
  db.close()
})

test('the migration list grew by exactly the closed_at migration and nothing else', () => {
  // R3 needed a migration (trades.closed_at, migration 16); the P1 daily check
  // itself stores state in the settings table, so it added none.
  assert.equal(MIGRATIONS.length, 16)
})

console.log(`${n} daily check checks passed`)
