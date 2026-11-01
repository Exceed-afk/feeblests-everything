import assert from 'node:assert/strict'
import { cleanAssistantSettingsPatch } from '../src/shared/assistant'

let n = 0
const test = (name: string, fn: () => void) => { fn(); n++; console.log('ok  ', name) }

test('unsupported provider values and unknown settings are ignored', () => {
  assert.deepEqual(cleanAssistantSettingsPatch({
    provider: 'remote',
    cloudConfirmed: true,
    ignored: 'not an assistant setting'
  }), { cloudConfirmed: true })
})

test('known assistant settings and supported provider values are retained', () => {
  assert.deepEqual(cleanAssistantSettingsPatch({
    provider: 'local',
    localUrl: 'http://localhost:11434/v1',
    model: 'local-model'
  }), {
    provider: 'local',
    localUrl: 'http://localhost:11434/v1',
    model: 'local-model'
  })
})

console.log(`\n${n} assistant settings checks passed`)
