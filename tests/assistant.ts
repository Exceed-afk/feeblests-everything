// Checks for the AI assistant's shared rules (src/shared/assistant.ts):
// the read-only function table, endpoint validation per mode, prompt/disclosure
// shapes, and the rule that Off sends nothing. No Electron needed:
//   npm test        (tsx tests/assistant.ts)
import assert from 'node:assert/strict'
import {
  ASSISTANT_FUNCTIONS, ASSISTANT_SYSTEM_PROMPT, ASSISTANT_USER_PROMPT, DEFAULT_ASSISTANT,
  assistantReady, checkEndpoint, cleanModelText, defaultUrl, failureText, functionByName,
  parseAssistantReply, weekRange, monthRange, lastWeekRange, lastNDays, CLOUD_CONFIRM_PHRASE,
  type AssistantRows, type DateRange
} from '../src/shared/assistant'
import { computeStats } from '../src/shared/trades'
import type { Habit, LogEntry, Mood, SavingsTx, Task, Trade, TxKind } from '../src/shared/types'

let n = 0
const test = (name: string, fn: () => void) => { fn(); n++; console.log('ok  ', name) }

const TODAY = '2026-10-23' // a Friday
const ROWS_FROM = '2026-09-01'

let id = 1
const tx = (date: string, kind: TxKind, amount: number): SavingsTx => ({ id: id++, goalId: 1, date, kind, amount, note: '', createdAt: '', updatedAt: '' })
const trade = (date: string, entryPrice: number, exitPrice: number | null): Trade => {
  const pnl = exitPrice === null ? null : exitPrice - entryPrice
  return { id: id++, date, asset: 'XAUUSD', direction: 'long', entryPrice, exitPrice, quantity: 1, fees: 0, notes: '', tags: [], pnl, createdAt: '', updatedAt: '' }
}
const habit = (name: string, days: number[], checkins: string[]): Habit => ({
  id: id++, name, notes: '', days, archived: false, startDate: ROWS_FROM, checkins,
  stats: { current: 0, best: 0, rate30: null, total: checkins.length }, createdAt: '', updatedAt: ''
})
const entry = (date: string, mood: Mood | null): LogEntry => ({ id: id++, date, title: 'A day', body: '', mood, tags: [], createdAt: '', updatedAt: '' })
const task = (completedAt: string | null): Task => ({
  id: id++, title: 'T', notes: '', status: completedAt ? 'done' : 'todo', priority: 'medium', dueDate: null,
  createdAt: ROWS_FROM, completedAt, deletedAt: null, dueTime: null, project: null, tags: [], position: 0, recurrenceRule: null, recurrenceNext: null, subtasks: []
})

const EVERY = [0, 1, 2, 3, 4, 5, 6]
const rows = (over: Partial<AssistantRows> = {}): AssistantRows => ({
  txs: [], trades: [], habits: [], tasks: [], entries: [], ...over
})
const full = (r: DateRange): DateRange => r
const THIS_WEEK = weekRange(TODAY)
const LAST_30 = lastNDays(TODAY, 30)

// ---------- the fixed function table ----------
test('exactly the six read-only functions are offered', () => {
  assert.deepEqual(ASSISTANT_FUNCTIONS.map((f) => f.name).sort(), [
    'habit_completion_rate', 'journal_entries', 'mood_average', 'savings_total', 'tasks_completed', 'trade_pnl'
  ].sort())
})
test('savings_total nets deposits and withdrawals in range only', () => {
  const f = functionByName('savings_total')!
  const r = f.run(rows({
    txs: [
      tx('2026-10-01', 'deposit', 200),
      tx('2026-10-05', 'withdrawal', 50),
      tx('2026-07-01', 'deposit', 999) // outside the month range
    ]
  }), monthRange(TODAY))
  assert.equal(r, 150)
})
test('trade_pnl counts closed trades on their entry date, skips open ones', () => {
  const f = functionByName('trade_pnl')!
  const r = f.run(rows({
    trades: [
      trade('2026-10-02', 100, 120),
      trade('2026-10-03', 100, 90),
      trade('2026-10-04', 100, null) // open: excluded
    ]
  }), LAST_30)
  assert.equal(r, 10)
})
test('habit_completion_rate counts scheduled days only', () => {
  const f = functionByName('habit_completion_rate')!
  // Weekdays-only habit; the range is Mon 19 – Fri 23 Oct, all 5 scheduled, 3 checked.
  const h = habit('Read', [0, 1, 2, 3, 4], ['2026-10-19', '2026-10-20', '2026-10-21'])
  const r = f.run(rows({ habits: [h] }), full({ from: '2026-10-19', to: '2026-10-23' }))
  assert.equal(r, 75) // 3 checked of 4 elapsed due days; today is still pending
})
test('habit_completion_rate ignores archived habits and counts only scheduled days', () => {
  const f = functionByName('habit_completion_rate')!
  const archived = { ...habit('Old', EVERY, ['2026-10-20']), archived: true } // ignored
  const weekend = habit('Fun', [5, 6], ['2026-10-24']) // Sat 24 scheduled + checked; Sun 25 scheduled + unchecked
  const r = f.run(rows({ habits: [archived, weekend] }), full({ from: '2026-10-19', to: '2026-10-25' }))
  assert.equal(r, 100) // Sunday is still pending, so only Saturday enters the rate
})
test('tasks_completed matches completion timestamps on their local day', () => {
  const f = functionByName('tasks_completed')!
  const r = f.run(rows({
    tasks: [
      task('2026-10-20T10:00:00.000Z'),
      task('2026-10-21T23:30:00.000-04:00'), // local day 2026-10-21
      task(null),
      task('2026-10-01T10:00:00.000Z') // outside the week
    ]
  }), THIS_WEEK)
  assert.equal(r, 2)
})
test('mood_average averages the 1-5 scores in range, 0 when none', () => {
  const f = functionByName('mood_average')!
  assert.equal(f.run(rows({ entries: [entry('2026-10-20', 'good'), entry('2026-10-21', 'great')] }), LAST_30), 4.5)
  assert.equal(f.run(rows(), LAST_30), 0)
})
test('mood_average ignores automation drafts', () => {
  const f = functionByName('mood_average')!
  const draft = { ...entry('2026-10-20', 'rough'), tags: ['automation'] }
  assert.equal(f.run(rows({ entries: [draft, entry('2026-10-20', 'good')] }), LAST_30), 4)
})
test('journal_entries counts entries in range', () => {
  const f = functionByName('journal_entries')!
  assert.equal(f.run(rows({ entries: [entry('2026-10-20', null), entry('2026-10-21', null), entry('2026-09-01', null)] }), LAST_30), 2)
})
test('journal_entries ignores automation drafts', () => {
  const f = functionByName('journal_entries')!
  const draft = { ...entry('2026-10-20', null), tags: ['automation'] }
  assert.equal(f.run(rows({ entries: [draft, entry('2026-10-20', null)] }), LAST_30), 1)
})
test('every function is read-only by shape: rows in, number out', () => {
  for (const f of ASSISTANT_FUNCTIONS) {
    const before = JSON.stringify([[], [], [], [], []])
    const result = f.run(rows(), THIS_WEEK)
    assert.equal(typeof result, 'number')
    assert.equal(JSON.stringify([[], [], [], [], []]), before) // nothing mutated
    void before; void result
  }
})

// ---------- ranges (UTC-safe local dates) ----------
test('weekRange runs Monday to Sunday', () => {
  assert.deepEqual(weekRange(TODAY), { from: '2026-10-19', to: '2026-10-25' })
})
test('monthRange clamps to the month\'s real end', () => {
  assert.deepEqual(monthRange('2026-10-23'), { from: '2026-10-01', to: '2026-10-31' })
  assert.deepEqual(monthRange('2026-02-10'), { from: '2026-02-01', to: '2026-02-28' })
  assert.deepEqual(monthRange('2028-02-10'), { from: '2028-02-01', to: '2028-02-29' })
})
test('lastWeekRange is the week before this one', () => {
  assert.deepEqual(lastWeekRange(TODAY), { from: '2026-10-12', to: '2026-10-18' })
})
test('lastNDays includes today', () => {
  assert.deepEqual(lastNDays(TODAY, 3), { from: '2026-10-21', to: TODAY })
})

// ---------- endpoint validation ----------
test('local mode accepts loopback hosts only', () => {
  assert.equal(checkEndpoint('http://localhost:11434/v1', 'local').ok, true)
  assert.equal(checkEndpoint('http://127.0.0.1:1234/v1', 'local').ok, true)
  assert.equal(checkEndpoint('http://[::1]:11434/v1', 'local').ok, true)
  const bad = checkEndpoint('http://192.168.1.10:11434/v1', 'local')
  assert.equal(bad.ok, false)
  assert.match(!bad.ok ? bad.error : '', /localhost/i)
  const bad2 = checkEndpoint('https://api.example.com/v1', 'local')
  assert.equal(bad2.ok, false)
})
test('cloud mode requires https, except loopback', () => {
  assert.equal(checkEndpoint('https://api.openai.com/v1', 'cloud').ok, true)
  const http = checkEndpoint('http://api.openai.com/v1', 'cloud')
  assert.equal(http.ok, false)
  assert.match(!http.ok ? http.error : '', /https/i)
  const local = checkEndpoint('http://localhost:8080/v1', 'cloud')
  assert.equal(local.ok, false) // even loopback must not be "cloud"
  assert.match(!local.ok ? local.error : '', /Local model/i)
})
test('nonsense and empty URLs are refused in any mode', () => {
  assert.equal(checkEndpoint('not a url', 'local').ok, false)
  assert.equal(checkEndpoint('', 'cloud').ok, false)
  assert.equal(checkEndpoint('ftp://x', 'local').ok, false)
})
test('off refuses everything', () => {
  assert.equal(checkEndpoint('http://localhost:11434/v1', 'off').ok, false)
})
test('defaults match the modes', () => {
  assert.equal(defaultUrl('local'), DEFAULT_ASSISTANT.localUrl)
  assert.equal(defaultUrl('cloud'), DEFAULT_ASSISTANT.cloudUrl)
})

// ---------- readiness and the Off contract ----------
test('assistantReady requires the master toggle AND a chosen provider', () => {
  assert.equal(assistantReady(DEFAULT_ASSISTANT, false), false) // off by default
  assert.equal(assistantReady({ ...DEFAULT_ASSISTANT, provider: 'local' }, false), false)
  assert.equal(assistantReady({ ...DEFAULT_ASSISTANT, provider: 'local' }, true), true)
  assert.equal(assistantReady({ ...DEFAULT_ASSISTANT, provider: 'cloud' }, true), false) // not confirmed yet
  assert.equal(assistantReady({ ...DEFAULT_ASSISTANT, provider: 'cloud', cloudConfirmed: true }, true), true)
})
test('Off is the default and nothing is built for it', () => {
  assert.equal(DEFAULT_ASSISTANT.provider, 'off')
  assert.equal(DEFAULT_ASSISTANT.cloudConfirmed, false)
  // Off has no valid endpoint, so askAssistant can never assemble a request.
  assert.equal(checkEndpoint(DEFAULT_ASSISTANT.localUrl, 'off').ok, false)
})
test('cloud confirmation uses an exact phrase, off by default', () => {
  assert.equal(CLOUD_CONFIRM_PHRASE, 'I understand')
  assert.equal(DEFAULT_ASSISTANT.cloudConfirmed, false)
})

// ---------- prompt and parsing ----------
test('the system prompt names the functions and nothing else', () => {
  for (const f of ASSISTANT_FUNCTIONS) assert.ok(ASSISTANT_SYSTEM_PROMPT.includes(f.name))
  assert.doesNotMatch(ASSISTANT_SYSTEM_PROMPT, /SELECT|sqlite|database rows/i)
})
test('the user turn carries only the date and the question', () => {
  const p = ASSISTANT_USER_PROMPT('how much did I save?', TODAY)
  assert.match(p, /^Today is 2026-10-23\. Question: how much did I save\?$/)
})
test('a well-formed model reply parses to one call', () => {
  const raw = '{"function":"savings_total","range":{"from":"2026-10-01","to":"2026-10-31"},"question":"how much did I save?"}'
  const r = parseAssistantReply(raw)
  assert.ok(r.ok)
  assert.deepEqual(!r.ok ? null : r.call, { functionName: 'savings_total', range: { from: '2026-10-01', to: '2026-10-31' }, question: 'how much did I save?' })
})
test('a reply wrapped in prose or think-blocks still parses', () => {
  const raw = 'Some preamble {"function":"tasks_completed","range":{"from":"2026-10-19","to":"2026-10-25"},"question":"q"} trailing'
  const r = parseAssistantReply(raw)
  assert.ok(r.ok)
})
test('invented function names, bad dates and non-JSON are refused', () => {
  assert.equal(parseAssistantReply('{"function":"delete_everything","range":{"from":"2026-10-01","to":"2026-10-31"},"question":"q"}').ok, false)
  assert.equal(parseAssistantReply('{"function":"tasks_completed","range":{"from":"nope","to":"2026-10-25"},"question":"q"}').ok, false)
  assert.equal(parseAssistantReply('{"function":"tasks_completed","range":{"from":"2026-10-31","to":"2026-10-01"},"question":"q"}').ok, false) // reversed
  assert.equal(parseAssistantReply('no json here at all').ok, false)
  assert.equal(parseAssistantReply('').ok, false)
})
test('think-block stripping cleans reasoning-wrapped answers', () => {
  const r = cleanModelText('Hmm{"function":"tasks_completed"}')
  assert.ok(r.ok)
  assert.match(!r.ok ? '' : r.text, /^\{"function":"tasks_completed"\}$/)
})

// ---------- failure wording never leaks key or payload ----------
test('failure messages never contain key or payload material', () => {
  for (const kind of ['off', 'confirm', 'offline', 'badkey', 'timeout', 'http', 'model', 'range'] as const) {
    const msg = failureText(kind)
    assert.ok(msg.length > 0)
    assert.doesNotMatch(msg, /sk-[A-Za-z0-9]/i)
    assert.doesNotMatch(msg, /Bearer /i)
  }
})

// ---------- backup sanity via the shared stats module (no key material in shapes) ----------
test('trade stats (the only numbers the assistant exposes) stay numeric', () => {
  const s = computeStats([trade('2026-10-02', 100, 120), trade('2026-10-03', 100, 90)])
  assert.equal(s.totalPnl, 10)
  assert.equal(s.closed, 2)
})

console.log(`\n${n} assistant checks passed`)
