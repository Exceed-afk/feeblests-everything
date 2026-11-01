import assert from 'node:assert/strict'
import {
  ASSISTANT_USER_PROMPT, assistantPreviousRequestText, normalizeAssistantFollowUp,
  type AssistantFollowUp
} from '../src/shared/assistant'

let n = 0
const test = (name: string, fn: () => void) => { fn(); n++; console.log('ok  ', name) }
const prior: AssistantFollowUp = {
  functionName: 'savings_total',
  rangeSpec: { kind: 'this_month' },
  filters: { goal: 'Emergency Fund' }
}

test('prompt builder includes only prior function, range and filters when present', () => {
  assert.equal(
    ASSISTANT_USER_PROMPT('And last week?', '2026-10-23', prior),
    'Today is 2026-10-23. Previous request: {"function":"savings_total","range":{"kind":"this_month"},"filters":{"goal":"Emergency Fund"}}. Question: And last week?'
  )
  assert.equal(assistantPreviousRequestText(prior), '{"function":"savings_total","range":{"kind":"this_month"},"filters":{"goal":"Emergency Fund"}}')
})

test('first turns and a cleared conversation do not include previous context', () => {
  let previousRequest: AssistantFollowUp | null = null
  assert.equal(ASSISTANT_USER_PROMPT('How much did I save this month?', '2026-10-23', previousRequest),
    'Today is 2026-10-23. Question: How much did I save this month?')
  previousRequest = prior
  previousRequest = null
  assert.equal(ASSISTANT_USER_PROMPT('Start fresh', '2026-10-23', previousRequest),
    'Today is 2026-10-23. Question: Start fresh')
})

test('follow-up validation strips extra fields and rejects malformed context', () => {
  assert.deepEqual(normalizeAssistantFollowUp({ ...prior, result: { type: 'number', value: 999 } }), prior)
  assert.equal(normalizeAssistantFollowUp({ ...prior, functionName: 'unknown' }), null)
  assert.equal(normalizeAssistantFollowUp({ ...prior, rangeSpec: { kind: 'between', from: '2026-02-31', to: '2026-03-01' } }), null)
  assert.equal(normalizeAssistantFollowUp({ ...prior, filters: { goal: 5 } }), null)
})

console.log(`\n${n} assistant follow-up checks passed`)
