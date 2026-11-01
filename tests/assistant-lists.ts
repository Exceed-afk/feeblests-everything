import assert from 'node:assert/strict'
import {
  functionByName, listEmptyMessage, parseAssistantReply,
  type AssistantResult, type AssistantRows
} from '../src/shared/assistant'
import type { LogEntry, Trade } from '../src/shared/types'

let n = 0
const test = (name: string, fn: () => void) => { fn(); n++; console.log('ok  ', name) }
const range = { from: '2026-10-01', to: '2026-10-31' }
const trade = (id: number, asset: string, pnl: number | null): Trade => ({
  id, date: `2026-10-${String(id).padStart(2, '0')}`, asset, direction: 'long',
  entryPrice: 100, exitPrice: pnl === null ? null : 100 + pnl, quantity: 1, fees: 0,
  notes: '', tags: [], pnl, createdAt: '', updatedAt: ''
})
const entry = (id: number, tags: string[]): LogEntry => ({
  id, date: `2026-10-${String(id).padStart(2, '0')}`, title: '', body: '',
  mood: null, tags, createdAt: '', updatedAt: ''
})
const rows = (overrides: Partial<AssistantRows> = {}): AssistantRows => ({
  txs: [], goals: [], trades: [], habits: [], tasks: [], completions: [], entries: [], ...overrides
})
const listRows = (result: AssistantResult) => {
  assert.equal(result.type, 'list')
  if (result.type !== 'list') throw new Error('Expected a list result.')
  return result.rows
}

test('biggest losses and wins are sorted by P&L and only include closed trades', () => {
  const data = rows({ trades: [
    trade(1, 'XAUUSD', -50), trade(2, 'EURUSD', -20), trade(3, 'GBPUSD', 40),
    trade(4, 'USDJPY', 10), trade(5, 'OPEN', null)
  ] })
  assert.deepEqual(functionByName('biggest_losses')!.run(data, range), {
    type: 'list',
    rows: [
      { label: '2026-10-01 · XAUUSD · long', value: -50 },
      { label: '2026-10-02 · EURUSD · long', value: -20 }
    ]
  })
  assert.deepEqual(functionByName('biggest_wins')!.run(data, range), {
    type: 'list',
    rows: [
      { label: '2026-10-03 · GBPUSD · long', value: 40 },
      { label: '2026-10-04 · USDJPY · long', value: 10 }
    ]
  })
})

test('biggest trade lists default to three and clamp the requested limit to 1..10', () => {
  const data = rows({ trades: Array.from({ length: 12 }, (_, index) => trade(index + 1, `ASSET${index + 1}`, -(index + 1))) })
  const fn = functionByName('biggest_losses')!
  assert.equal(listRows(fn.run(data, range)).length, 3)
  assert.equal(listRows(fn.run(data, range, undefined, undefined, 0)).length, 1)
  assert.equal(listRows(fn.run(data, range, undefined, undefined, 99)).length, 10)

  const parsed = parseAssistantReply('{"function":"biggest_losses","range":{"kind":"this_month"},"limit":99}')
  assert.ok(parsed.ok && parsed.call.kind === 'function')
  assert.equal(parsed.ok && parsed.call.kind === 'function' ? parsed.call.limit : undefined, 10)
})

test('top_tags counts distinct user-entry tags and pnl_by_asset aggregates locally', () => {
  const data = rows({
    entries: [
      entry(1, ['Work', 'work', 'focus']),
      entry(2, ['work', 'health']),
      { ...entry(3, ['automation', 'Work']), title: 'Automation draft' }
    ],
    trades: [trade(1, 'XAUUSD', -50), trade(2, 'XAUUSD', 10), trade(3, 'USDJPY', 40)]
  })
  assert.deepEqual(functionByName('top_tags')!.run(data, range), {
    type: 'list',
    rows: [{ label: 'Work', value: 2 }, { label: 'focus', value: 1 }, { label: 'health', value: 1 }]
  })
  assert.deepEqual(functionByName('pnl_by_asset')!.run(data, range), {
    type: 'list',
    rows: [{ label: 'USDJPY', value: 40 }, { label: 'XAUUSD', value: -40 }]
  })
})

test('empty list results have a clear local message', () => {
  const result = functionByName('biggest_losses')!.run(rows(), range)
  assert.deepEqual(result, { type: 'list', rows: [] })
  assert.equal(listEmptyMessage('biggest losses'), 'No biggest losses found for that date range.')
})

console.log(`\n${n} assistant list checks passed`)
