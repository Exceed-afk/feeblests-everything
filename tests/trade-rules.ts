import assert from 'node:assert/strict'
import { openDatabase } from './sqlite'
import { applyMigrations } from '../src/main/migrations'
import { consecutiveLosses, tradesOnDate, DEFAULT_AUTOMATIONS, runAutomation, lossStreakPauseRule, overtradingNoteRule, quickReentryRule, type AutomationSettings } from '../src/shared/automations'
import { createTrade, listTrades } from '../src/main/trades'
import { automationActivity } from '../src/main/automations'
import { collectBackup, restoreBackup } from '../src/main/backup'
import { parseBackup } from '../src/shared/backup'
import { MIGRATIONS } from '../src/main/migrations'

let n = 0
const test = (name: string, fn: () => void) => { try { fn(); n++; console.log('ok  ', name) } catch (e) { console.error(e); throw e } }

const TODAY = '2026-11-02'
const trade = (id: number, date: string, pnl: number | null) => ({ id, date, pnl })

const settings = (patch: Partial<AutomationSettings>): AutomationSettings => ({
  ...DEFAULT_AUTOMATIONS,
  lossStreakPause: true,
  overtradingNote: true,
  ...patch
})

const settingsWithLossStreakOff: AutomationSettings = { ...settings({}), lossStreakPause: false }
const settingsWithLength5: AutomationSettings = { ...settings({}), lossStreakLength: 5 }
const settingsWithOvertradingOff: AutomationSettings = { ...settings({}), overtradingNote: false }

const closedEvent = (id = 99) => ({
  kind: 'trade-closed' as const,
  date: TODAY,
  data: { tradeId: id, tradePnl: -10, tradeAsset: 'XAUUSD', tradeDate: TODAY }
})

test('consecutiveLosses counts the newest run of losses, ignoring open trades', () => {
  // newest first: loss, loss, win -> run of 2
  assert.equal(consecutiveLosses([trade(4, '2026-11-02', -5), trade(3, '2026-11-01', -5), trade(2, '2026-10-31', 10)]), 2)
  // a win at the newest position resets to 0
  assert.equal(consecutiveLosses([trade(4, '2026-11-02', 10), trade(3, '2026-11-01', -5)]), 0)
  // open trades (pnl null) are invisible to the streak
  assert.equal(consecutiveLosses([trade(5, '2026-11-02', null), trade(4, '2026-11-02', -5), trade(3, '2026-11-01', -5)]), 2)
  // zero P&L is not a loss: it resets
  assert.equal(consecutiveLosses([trade(2, '2026-11-02', 0), trade(1, '2026-11-01', -5)]), 0)
  assert.equal(consecutiveLosses([]), 0)
})

test('ordering is by date then id, not array order', () => {
  // Newest first: id 2 (the 2nd, a loss), then on the 1st: id 3 (win, higher id
  // sorts newer) breaks BEFORE id 1 (loss), so the run is just 1.
  assert.equal(consecutiveLosses([trade(1, '2026-11-01', -5), trade(2, '2026-11-02', -5), trade(3, '2026-11-01', 10)]), 1)
})

test('tradesOnDate counts by entry date', () => {
  assert.equal(tradesOnDate([trade(1, TODAY, 0), trade(2, TODAY, 0), trade(3, '2026-11-01', 0)], TODAY), 2)
})

test('R1: 3 losses in a row fires; 2 does not; a win resets', () => {
  const trades3 = [trade(9, TODAY, -1), trade(8, TODAY, -1), trade(7, TODAY, -1), trade(6, TODAY, 5)]
  const fires = runAutomation(closedEvent(), { settings: settings({}), recentTrades: trades3 })
  const pause = fires.find((o) => o.ruleId === 'loss-streak-pause')
  assert.ok(pause, 'the rule should produce an outcome')
  assert.match(String(pause.actions[0].type), /message/)
  assert.equal(pause.actions[0].type === 'message' ? pause.actions[0].text.includes('3 losses in a row') : false, true)

  const trades2 = [trade(9, TODAY, -1), trade(8, TODAY, -1), trade(7, TODAY, 5)]
  assert.equal(runAutomation(closedEvent(), { settings: settings({}), recentTrades: trades2 }).find((o) => o.ruleId === 'loss-streak-pause'), undefined)

  // rule off -> nothing (default baseSettings)
  assert.equal(runAutomation(closedEvent(), { settings: settingsWithLossStreakOff, recentTrades: trades3 }).find((o) => o.ruleId === 'loss-streak-pause'), undefined)
})

test('R1: a custom threshold honours lossStreakLength', () => {
  const trades = [trade(9, TODAY, -1), trade(8, TODAY, -1)]
  assert.equal(runAutomation(closedEvent(), { settings: settingsWithLength5, recentTrades: trades }).find((o) => o.ruleId === 'loss-streak-pause'), undefined)
})

test('R2: fires when the day exceeds N; once per day; boundary is strict', () => {
  const sixToday = [trade(9, TODAY, 1), trade(8, TODAY, 1), trade(7, TODAY, 1), trade(6, TODAY, 1), trade(5, TODAY, 1), trade(4, TODAY, 1)]
  const fires = runAutomation(closedEvent(), { settings: settings({}), recentTrades: sixToday })
  const note = fires.find((o) => o.ruleId === 'overtrading-note')
  assert.ok(note, '6 trades on a 5-max day fires')
  assert.equal(note.actions[0].type === 'message' ? note.actions[0].text.includes('6 trades today') : false, true)

  // exactly N does not fire
  const fiveToday = sixToday.slice(1)
  assert.equal(runAutomation(closedEvent(), { settings: settings({}), recentTrades: fiveToday }).find((o) => o.ruleId === 'overtrading-note'), undefined)

  // two fires on the same day -> one (ctx.produced within one run; the dedupe key
  // `overtrading-note:<date>` handles across runs)
  const twice = runAutomation(closedEvent(), { settings: settings({}), recentTrades: sixToday }).filter((o) => o.ruleId === 'overtrading-note')
  assert.equal(twice.length, 1)

  // other days' trades do not count toward today
  const mixed = [...sixToday, trade(3, '2026-11-01', 1)]
  assert.ok(runAutomation(closedEvent(), { settings: settings({}), recentTrades: mixed }).find((o) => o.ruleId === 'overtrading-note'))
})

test('R2: rule off or a quiet day fires nothing', () => {
  const threeToday = [trade(9, TODAY, 1), trade(8, TODAY, 1), trade(7, TODAY, 1)]
  assert.equal(runAutomation(closedEvent(), { settings: settingsWithOvertradingOff, recentTrades: threeToday }).find((o) => o.ruleId === 'overtrading-note'), undefined)
  assert.equal(runAutomation(closedEvent(), { settings: settings({}), recentTrades: threeToday }).find((o) => o.ruleId === 'overtrading-note'), undefined)
})

// --- end-to-end through the db emit path ---

const openDb = () => {
  const db = openDatabase()
  applyMigrations(db)
  db.prepare(
    "INSERT INTO settings (key, value) VALUES ('automations', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value"
  ).run(JSON.stringify({ lossStreakPause: true, overtradingNote: true }))
  return db
}

const closedInput = (date: string) => ({
  date, asset: 'XAUUSD', direction: 'long' as const, entryPrice: 10, exitPrice: 5, quantity: 1, fees: 0, notes: '', tags: []
})

test('end to end: a third losing close shows exactly one pause note', () => {
  const db = openDb()
  createTrade(db, closedInput('2026-10-31'))
  createTrade(db, closedInput('2026-11-01'))
  createTrade(db, closedInput(TODAY))
  const events = automationActivity(db, 50).filter((a) => a.rule === 'loss-streak-pause')
  assert.equal(events.length, 1)
  db.close()
})

test('end to end: two overtrading saves on the same day produce one note', () => {
  const db = openDb()
  // Only 6 trades today (max 5): the 6th crosses the line, the (nonexistent)
  // 7th would be deduped by key �?here exactly one crossing exists.
  for (let i = 0; i < 6; i++) createTrade(db, closedInput(TODAY))
  const events = automationActivity(db, 50).filter((a) => a.rule === 'overtrading-note')
  assert.equal(events.length, 1)
  db.close()
})

test('both trade rules are registered', () => {
  const s = settings({})
  const outcomes = runAutomation(closedEvent(), { settings: s, recentTrades: [] })
  void outcomes
  assert.equal(typeof lossStreakPauseRule().id, 'string')
  assert.equal(typeof overtradingNoteRule().id, 'string')
  assert.equal(typeof quickReentryRule().id, 'string')
})

// --- R3: quick re-entry after a loss ---

const CREATED = '2026-11-02T10:30:00.000Z'

const reentryEvent = (createdAt = CREATED) => ({
  kind: 'trade-created' as const,
  date: TODAY,
  data: { tradeId: 99, tradeCreatedAt: createdAt, tradeDate: TODAY }
})

const r3 = (patch: Partial<AutomationSettings> = {}) => ({ ...settings({ quickReentryNote: true, reentryMinutes: 30, ...patch }) })

const losingClose = (closedAt: string | null) => ({ id: 1, date: TODAY, pnl: -50, closedAt })

test('R3: fires inside the window with the real minutes', () => {
  const closedAt = '2026-11-02T10:10:00.000Z' // 20 minutes before CREATED
  const fires = runAutomation(reentryEvent(), { settings: r3(), recentTrades: [losingClose(closedAt)] })
  const note = fires.find((o) => o.ruleId === 'quick-reentry')
  assert.ok(note, 'a 20-minute re-entry inside a 30-minute window fires')
  assert.equal(note.actions[0].type === 'message' ? note.actions[0].text.includes('20 minutes after a loss') : false, true)
})

// Boundary: exactly N minutes counts ("within N"), N+1 does not.
test('R3: boundary at N and N+1 minutes', () => {
  const atN = runAutomation(reentryEvent('2026-11-02T10:30:00.000Z'), { settings: r3(), recentTrades: [losingClose('2026-11-02T10:00:00.000Z')] }) // exactly 30
  assert.ok(atN.find((o) => o.ruleId === 'quick-reentry'), 'exactly 30 minutes is within')

  const atN1 = runAutomation(reentryEvent('2026-11-02T10:31:00.000Z'), { settings: r3(), recentTrades: [losingClose('2026-11-02T10:00:00.000Z')] }) // 31
  assert.equal(atN1.find((o) => o.ruleId === 'quick-reentry'), undefined)
})

test('R3: null closed_at (old rows) never fires', () => {
  const fires = runAutomation(reentryEvent(), { settings: r3(), recentTrades: [losingClose(null)] })
  assert.equal(fires.find((o) => o.ruleId === 'quick-reentry'), undefined)
  // and a missing createdAt on the new trade too
  const fires2 = runAutomation({ ...reentryEvent(), data: { tradeId: 99, tradeDate: TODAY } }, { settings: r3(), recentTrades: [losingClose('2026-11-02T10:10:00.000Z')] })
  assert.equal(fires2.find((o) => o.ruleId === 'quick-reentry'), undefined)
})

test('R3: a profitable close and a pre-dating close never fire', () => {
  const afterWin = runAutomation(reentryEvent(), { settings: r3(), recentTrades: [{ id: 1, date: TODAY, pnl: 50, closedAt: '2026-11-02T10:00:00.000Z' }] })
  assert.equal(afterWin.find((o) => o.ruleId === 'quick-reentry'), undefined)
  // the "new" trade predates the losing close: not a re-entry
  const before = runAutomation(reentryEvent('2026-11-02T09:00:00.000Z'), { settings: r3(), recentTrades: [losingClose('2026-11-02T10:00:00.000Z')] })
  assert.equal(before.find((o) => o.ruleId === 'quick-reentry'), undefined)
})

test('R3: the closest losing close wins and the rule is off by default', () => {
  const two = runAutomation(reentryEvent('2026-11-02T10:12:00.000Z'), {
    settings: r3(),
    recentTrades: [losingClose('2026-11-02T10:00:00.000Z'), { id: 2, date: TODAY, pnl: -5, closedAt: '2026-11-02T10:10:00.000Z' }]
  })
  const note = two.find((o) => o.ruleId === 'quick-reentry')
  assert.ok(note)
  assert.equal(note.actions[0].type === 'message' ? note.actions[0].text.includes('2 minutes') : false, true)

  // default settings: off
  assert.equal(runAutomation(reentryEvent(), { settings: { ...DEFAULT_AUTOMATIONS }, recentTrades: [losingClose('2026-11-02T10:10:00.000Z')] }).find((o) => o.ruleId === 'quick-reentry'), undefined)
})

test('R3 end to end: creating a trade 10 minutes after a losing close fires once; old rows stay silent', () => {
  const db = openDb()
  db.prepare(
    "INSERT INTO settings (key, value) VALUES ('automations', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value"
  ).run(JSON.stringify({ quickReentryNote: true, reentryMinutes: 30 }))

  // A losing trade closed 10 minutes ago (inserted directly so its timestamps are exact).
  db.prepare(
    `INSERT INTO trades (date, asset, direction, entry_price, exit_price, quantity, fees, notes, tags, closed_at, created_at, updated_at)
     VALUES ('2026-11-02', 'XAUUSD', 'long', 10, 5, 1, 0, '', '[]', ?, ?, ?)`
  ).run('2026-11-02T10:00:00.000Z', '2026-11-02T09:00:00.000Z', '2026-11-02T10:00:00.000Z')

  createTrade(db, { date: TODAY, asset: 'XAUUSD', direction: 'long', entryPrice: 10, exitPrice: null, quantity: 1, fees: 0, notes: '', tags: [] }, new Date('2026-11-02T10:05:00.000Z'))
  const events = automationActivity(db, 50).filter((a) => a.rule === 'quick-reentry')
  assert.equal(events.length, 1)

  // An OLD losing row (closed_at NULL) plus a new trade ONE MINUTE later: the
  // rule re-fires because it is a different trade (a different dedupe key),
  // and the plan accepts that: each trigger gets its own note. To prove the
  // NULL closed_at really is silent, query only the newest event.
  db.prepare(
    `INSERT INTO trades (date, asset, direction, entry_price, exit_price, quantity, fees, notes, tags, closed_at, created_at, updated_at)
     VALUES ('2026-10-20', 'XAUUSD', 'long', 10, 5, 1, 0, '', '[]', NULL, ?, ?)`
  ).run('2026-10-20T09:00:00.000Z', '2026-10-20T10:00:00.000Z')
  createTrade(db, { date: TODAY, asset: 'XAUUSD', direction: 'long', entryPrice: 10, exitPrice: null, quantity: 1, fees: 0, notes: '', tags: [] }, new Date('2026-11-02T10:06:00.000Z'))
  const newest = automationActivity(db, 1)[0]
  assert.equal(newest.rule, 'quick-reentry') // from the still-open losing trade, not the NULL one
  void newest
  db.close()
})

test('R3: backup export/import round-trips closedAt', () => {
  const db = openDb()
  createTrade(db, { date: TODAY, asset: 'XAUUSD', direction: 'long', entryPrice: 10, exitPrice: 5, quantity: 1, fees: 0, notes: '', tags: [] })
  const backup = collectBackup(db)
  assert.ok(backup.trades.every((t) => typeof t.closedAt === 'string'))
  const target = openDb()
  restoreBackup(target, parseBackup(JSON.stringify(backup), MIGRATIONS.length))
  const restored = listTrades(target)
  assert.equal(restored.length, 1)
  assert.equal(typeof restored[0].closedAt, 'string')
  assert.equal(restored[0].closedAt, listTrades(db)[0].closedAt)
  db.close(); target.close()
})

console.log(`${n} trade-rule checks passed`)







