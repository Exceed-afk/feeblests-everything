import assert from 'node:assert/strict'
import {
  clampRange, functionByName, parseAssistantReply, resolveRange, type DateRange
} from '../src/shared/assistant'
import type { Habit } from '../src/shared/types'

let n = 0
const test = (name: string, fn: () => void) => { fn(); n++; console.log('ok  ', name) }

const cases: { today: string; expected: Record<string, DateRange> }[] = [
  {
    today: '2024-02-29',
    expected: {
      today: { from: '2024-02-29', to: '2024-02-29' },
      yesterday: { from: '2024-02-28', to: '2024-02-28' },
      this_week: { from: '2024-02-26', to: '2024-03-03' },
      last_week: { from: '2024-02-19', to: '2024-02-25' },
      this_month: { from: '2024-02-01', to: '2024-02-29' },
      last_month: { from: '2024-01-01', to: '2024-01-31' },
      this_year: { from: '2024-01-01', to: '2024-12-31' },
      all_time: { from: '1970-01-01', to: '2024-02-29' },
      last_n_days: { from: '2024-02-27', to: '2024-02-29' }
    }
  },
  {
    today: '2024-12-31',
    expected: {
      today: { from: '2024-12-31', to: '2024-12-31' },
      yesterday: { from: '2024-12-30', to: '2024-12-30' },
      this_week: { from: '2024-12-30', to: '2025-01-05' },
      last_week: { from: '2024-12-23', to: '2024-12-29' },
      this_month: { from: '2024-12-01', to: '2024-12-31' },
      last_month: { from: '2024-11-01', to: '2024-11-30' },
      this_year: { from: '2024-01-01', to: '2024-12-31' },
      all_time: { from: '1970-01-01', to: '2024-12-31' },
      last_n_days: { from: '2024-12-29', to: '2024-12-31' }
    }
  },
  {
    today: '2026-11-01',
    expected: {
      today: { from: '2026-11-01', to: '2026-11-01' },
      yesterday: { from: '2026-10-31', to: '2026-10-31' },
      this_week: { from: '2026-10-26', to: '2026-11-01' },
      last_week: { from: '2026-10-19', to: '2026-10-25' },
      this_month: { from: '2026-11-01', to: '2026-11-30' },
      last_month: { from: '2026-10-01', to: '2026-10-31' },
      this_year: { from: '2026-01-01', to: '2026-12-31' },
      all_time: { from: '1970-01-01', to: '2026-11-01' },
      last_n_days: { from: '2026-10-30', to: '2026-11-01' }
    }
  },
  {
    today: '2026-10-26',
    expected: {
      today: { from: '2026-10-26', to: '2026-10-26' },
      yesterday: { from: '2026-10-25', to: '2026-10-25' },
      this_week: { from: '2026-10-26', to: '2026-11-01' },
      last_week: { from: '2026-10-19', to: '2026-10-25' },
      this_month: { from: '2026-10-01', to: '2026-10-31' },
      last_month: { from: '2026-09-01', to: '2026-09-30' },
      this_year: { from: '2026-01-01', to: '2026-12-31' },
      all_time: { from: '1970-01-01', to: '2026-10-26' },
      last_n_days: { from: '2026-10-24', to: '2026-10-26' }
    }
  }
]

for (const { today, expected } of cases) {
  test(`all range kinds resolve correctly on ${today}`, () => {
    for (const kind of [
      'today', 'yesterday', 'this_week', 'last_week', 'this_month', 'last_month', 'this_year', 'all_time'
    ] as const) {
      assert.deepEqual(resolveRange({ kind }, today), expected[kind], kind)
    }
    assert.deepEqual(resolveRange({ kind: 'last_n_days', n: 3 }, today), expected.last_n_days)
    assert.deepEqual(
      resolveRange({ kind: 'between', from: '2026-01-03', to: '2026-01-10' }, today),
      { from: '2026-01-03', to: '2026-01-10' }
    )
  })
}

test('all-time resolves to the fixed epoch and is the only permitted extended range', () => {
  const today = '2026-11-01'
  const allTime = resolveRange({ kind: 'all_time' }, today)
  assert.deepEqual(clampRange(allTime, today, { allowAllTime: true }), { ok: true, range: allTime })
  assert.deepEqual(clampRange({ from: '2010-01-01', to: today }, today, { allowAllTime: true }), { ok: false, kind: 'range' })
})

test('all-time habit calculations begin at the habit tracking start date', () => {
  const today = '2026-10-23'
  const habit: Habit = {
    id: 1, name: 'Daily', notes: '', days: [0, 1, 2, 3, 4, 5, 6], archived: false,
    startDate: '2026-10-01', checkins: ['2026-10-22'],
    stats: { current: 0, best: 0, rate30: null, total: 0 }, createdAt: '', updatedAt: ''
  }
  const range = resolveRange({ kind: 'all_time' }, today)
  const result = functionByName('habit_completion_rate')!.run({
    txs: [], trades: [], habits: [habit], tasks: [], completions: [], entries: []
  }, range, today)
  assert.equal(result, 4.54545455)
})

test('last_n_days rejects zero, out-of-range and non-integer values', () => {
  for (const n of [0, 99999, 1.5]) {
    const parsed = parseAssistantReply(JSON.stringify({
      function: 'savings_total',
      range: { kind: 'last_n_days', n }
    }))
    assert.equal(parsed.ok, false, `n=${n}`)
  }
  assert.throws(() => resolveRange({ kind: 'last_n_days', n: 0 }, '2026-11-01'), RangeError)
})

test('the previous date range shape remains valid as an explicit between range', () => {
  const parsed = parseAssistantReply(
    '{"function":"savings_total","range":{"from":"2026-10-01","to":"2026-10-31"}}'
  )
  assert.deepEqual(parsed, {
    ok: true,
    call: {
      kind: 'function',
      functionName: 'savings_total',
      rangeSpec: { kind: 'between', from: '2026-10-01', to: '2026-10-31' },
      question: ''
    }
  })
})

console.log(`\n${n} assistant range resolution checks passed`)
