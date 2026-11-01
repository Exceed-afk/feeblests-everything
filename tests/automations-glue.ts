import assert from 'node:assert/strict'
import { clearAutomationActivity, automationActivity, deleteAutomationActivity, emitAutomation } from '../src/main/automations'
import { applyMigrations } from '../src/main/migrations'
import { localDate } from '../src/main/util'
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

function fireLoss(db: ReturnType<typeof openAutomationDb>, key = 'trade:1') {
  return emitAutomation(db, 'trade-closed', key, {
    tradeId: 1, tradePnl: -60, tradeAsset: 'XAUUSD', tradeDate: localDate()
  })
}

test('automation draft inserts cover every required logbook column', () => {
  const db = openAutomationDb()
  try {
    const insertColumns = new Set(['date', 'title', 'body', 'mood', 'tags', 'created_at', 'updated_at'])
    const requiredColumns = db.prepare('PRAGMA table_info(logbook_entries)').all() as {
      name: string; notnull: number; dflt_value: unknown; pk: number
    }[]
    const missing = requiredColumns
      .filter((column) => column.notnull === 1 && column.dflt_value === null && column.pk === 0)
      .filter((column) => !insertColumns.has(column.name))
      .map((column) => column.name)
    assert.deepEqual(missing, [], 'new required logbook columns must be added to createAutomationEntry')
  } finally {
    db.close()
  }
})

test('the same automation trigger creates only one draft', () => {
  const db = openAutomationDb()
  try {
    assert.equal(fireLoss(db).fired.length, 1)
    assert.equal(fireLoss(db).fired.length, 0)
    assert.equal((db.prepare('SELECT COUNT(*) AS n FROM logbook_entries').get() as { n: number }).n, 1)
    assert.equal(automationActivity(db).length, 1)
  } finally {
    db.close()
  }
})

test('clearing or deleting activity hides rows without releasing their dedupe claims', () => {
  const db = openAutomationDb()
  try {
    fireLoss(db, 'trade:clear')
    clearAutomationActivity(db)
    assert.deepEqual(automationActivity(db), [])
    assert.equal(fireLoss(db, 'trade:clear').fired.length, 0)

    fireLoss(db, 'trade:delete')
    const activity = automationActivity(db)
    deleteAutomationActivity(db, activity[0].id)
    assert.equal(fireLoss(db, 'trade:delete').fired.length, 0)
    assert.deepEqual(automationActivity(db), [])
    assert.equal((db.prepare('SELECT COUNT(*) AS n FROM logbook_entries').get() as { n: number }).n, 2)
    assert.equal((db.prepare('SELECT COUNT(*) AS n FROM automation_events WHERE hidden = 1').get() as { n: number }).n, 2)
  } finally {
    db.close()
  }
})

test('a failed draft insert rolls back its claim so the event can be retried', () => {
  const db = openAutomationDb()
  const errors: unknown[][] = []
  const originalError = console.error
  console.error = (...args: unknown[]): void => { errors.push(args) }
  try {
    db.exec(`CREATE TRIGGER fail_automation_draft BEFORE INSERT ON logbook_entries
      WHEN NEW.title LIKE 'Loss reflection:%'
      BEGIN SELECT RAISE(ABORT, 'forced draft failure'); END;`)
    assert.deepEqual(fireLoss(db, 'trade:retry').fired, [])
    assert.equal((db.prepare('SELECT COUNT(*) AS n FROM automation_events').get() as { n: number }).n, 0)
    assert.equal(errors.length, 1)

    db.exec('DROP TRIGGER fail_automation_draft')
    assert.equal(fireLoss(db, 'trade:retry').fired.length, 1)
    assert.equal((db.prepare('SELECT COUNT(*) AS n FROM logbook_entries').get() as { n: number }).n, 1)
  } finally {
    console.error = originalError
    db.close()
  }
})

test('automation drafts use the local calendar date', () => {
  const db = openAutomationDb()
  try {
    const expectedDate = localDate()
    fireLoss(db, 'trade:local-date')
    assert.equal(
      (db.prepare('SELECT date FROM logbook_entries').get() as { date: string }).date,
      expectedDate
    )
  } finally {
    db.close()
  }
})

console.log(`\n${n} automation glue checks passed`)
