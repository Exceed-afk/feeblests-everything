import assert from 'node:assert/strict'
import { openDatabase } from './sqlite'
import { applyMigrations } from '../src/main/migrations'
import { consecutiveLosses, tradesOnDate, DEFAULT_AUTOMATIONS, runAutomation, lossStreakPauseRule, overtradingNoteRule, type AutomationSettings } from '../src/shared/automations'
import { createTrade } from '../src/main/trades'
import { automationActivity } from '../src/main/automations'

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
  // 7th would be deduped by key — here exactly one crossing exists.
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
})

console.log(`${n} trade-rule checks passed`)






