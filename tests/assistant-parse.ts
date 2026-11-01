import assert from 'node:assert/strict'
import { ASSISTANT_SYSTEM_PROMPT, CANNOT_ANSWER_MESSAGE, parseAssistantReply } from '../src/shared/assistant'

let n = 0
const test = (name: string, fn: () => void) => { fn(); n++; console.log('ok  ', name) }

test('the prompt explicitly allows a refusal instead of guessing', () => {
  assert.match(ASSISTANT_SYSTEM_PROMPT, /cannot_answer/)
  assert.match(ASSISTANT_SYSTEM_PROMPT, /Do not guess/)
})

test('cannot_answer parses without model-written question or date data', () => {
  const parsed = parseAssistantReply('{"function":"cannot_answer"}')
  assert.deepEqual(parsed, { ok: true, call: { kind: 'none' } })
})

test('an unknown function name is treated as an unsupported question', () => {
  const parsed = parseAssistantReply('{"function":"invented_function","question":"show me everything"}')
  assert.deepEqual(parsed, { ok: true, call: { kind: 'none' } })
})

test('the local refusal lists the supported capabilities', () => {
  assert.equal(
    CANNOT_ANSWER_MESSAGE,
    "I can't compute that yet. I can answer: savings total, trade P&L, habit completion, tasks completed, mood average, journal entries, biggest losses, biggest wins, most-used tags, P&L by asset."
  )
})

test('a supported function still requires a valid date range', () => {
  const parsed = parseAssistantReply('{"function":"trade_pnl","range":{"from":"2026-10-01","to":"2026-10-31"}}')
  assert.deepEqual(parsed, {
    ok: true,
    call: {
      kind: 'function',
      functionName: 'trade_pnl',
      rangeSpec: { kind: 'between', from: '2026-10-01', to: '2026-10-31' },
      filters: {},
      compare: null,
      question: ''
    }
  })
  assert.equal(parseAssistantReply('{"function":"trade_pnl"}').ok, false)
})

test('a symbolic range kind parses without model-calculated dates', () => {
  assert.deepEqual(
    parseAssistantReply('{"function":"savings_total","range":{"kind":"last_month"}}'),
    { ok: true, call: { kind: 'function', functionName: 'savings_total', rangeSpec: { kind: 'last_month' }, filters: {}, compare: null, question: '' } }
  )
})

test('filter words are parsed but no app label lists are added to the call', () => {
  assert.deepEqual(
    parseAssistantReply('{"function":"trade_pnl","range":{"kind":"this_month"},"filters":{"asset":"XAUUSD","tag":"gold"}}'),
    {
      ok: true,
      call: {
        kind: 'function', functionName: 'trade_pnl', rangeSpec: { kind: 'this_month' },
        filters: { asset: 'XAUUSD', tag: 'gold' }, compare: null, question: ''
      }
    }
  )
})

test('invalid range specs and out-of-bounds day counts are rejected', () => {
  for (const range of [
    { kind: 'unknown' },
    { kind: 'last_n_days', n: 0 },
    { kind: 'last_n_days', n: 99999 },
    { kind: 'last_n_days', n: 1.5 },
    { kind: 'between', from: '2026-02-31', to: '2026-03-01' },
    { kind: 'between', from: '2026-03-02', to: '2026-03-01' }
  ]) {
    assert.equal(parseAssistantReply(JSON.stringify({ function: 'trade_pnl', range })).ok, false)
  }
  assert.equal(parseAssistantReply('{"function":"trade_pnl","range":{"kind":"today"},"filters":{"asset":5}}').ok, false)
})

console.log(`\n${n} assistant parse checks passed`)
