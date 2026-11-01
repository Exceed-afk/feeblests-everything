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
    "I can't compute that yet. I can answer: savings total, trade P&L, habit completion, tasks completed, mood average, journal entries."
  )
})

test('a supported function still requires a valid date range', () => {
  const parsed = parseAssistantReply('{"function":"trade_pnl","range":{"from":"2026-10-01","to":"2026-10-31"}}')
  assert.deepEqual(parsed, {
    ok: true,
    call: {
      kind: 'function',
      functionName: 'trade_pnl',
      range: { from: '2026-10-01', to: '2026-10-31' },
      question: ''
    }
  })
  assert.equal(parseAssistantReply('{"function":"trade_pnl"}').ok, false)
})

console.log(`\n${n} assistant parse checks passed`)
