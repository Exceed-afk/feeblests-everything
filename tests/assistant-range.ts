import assert from 'node:assert/strict'
import { performance } from 'node:perf_hooks'
import {
  clampRange, failureText, functionByName, isRealDate, MAX_RANGE_DAYS, parseAssistantReply,
  type AssistantRows
} from '../src/shared/assistant'
import type { Habit } from '../src/shared/types'

let n = 0
const test = (name: string, fn: () => void) => { fn(); n++; console.log('ok  ', name) }

const today = '2026-10-23'
const rows: AssistantRows = {
  txs: [], goals: [], trades: [], tasks: [], completions: [], entries: [],
  habits: [{
    id: 1, name: 'Daily', notes: '', days: [0, 1, 2, 3, 4, 5, 6], archived: false,
    startDate: '2026-10-01', checkins: [],
    stats: { current: 0, best: 0, rate30: null, total: 0 }, createdAt: '', updatedAt: ''
  } satisfies Habit]
}

test('future range endpoints clamp to today', () => {
  const result = clampRange({ from: '2026-10-01', to: '2026-11-01' }, today)
  assert.deepEqual(result, { ok: true, range: { from: '2026-10-01', to: today } })
})

test('a range wholly in the future is empty', () => {
  assert.deepEqual(clampRange({ from: '2026-10-24', to: '2026-11-01' }, today), { ok: false, kind: 'empty' })
})

test('a far-future endpoint is clamped before the habit loop runs', () => {
  const start = performance.now()
  const clamped = clampRange({ from: today, to: '9999-12-31' }, today)
  assert.deepEqual(clamped, { ok: true, range: { from: today, to: today } })
  if (!clamped.ok) throw new Error('Expected the range to clamp successfully.')
  const result = functionByName('habit_completion_rate')!.run(rows, clamped.range)
  assert.deepEqual(result, { type: 'number', value: 0 })
  assert.ok(performance.now() - start < 200, 'the assistant range calculation should finish in under 200 ms')
})

test('calendar-valid dates reject impossible days', () => {
  assert.equal(isRealDate('2026-02-31'), false)
  const reply = parseAssistantReply('{"function":"tasks_completed","range":{"from":"2026-02-01","to":"2026-02-31"},"question":"q"}')
  assert.equal(reply.ok, false)
})

test('ranges over five years fail with a plain range message', () => {
  const result = clampRange({ from: '2010-01-01', to: today }, today)
  assert.deepEqual(result, { ok: false, kind: 'range' })
  assert.equal(failureText('range'), 'That date range is too long or has not happened yet. Try something under 5 years.')
  assert.equal(MAX_RANGE_DAYS, 1830)
})

console.log(`\n${n} assistant range checks passed`)
