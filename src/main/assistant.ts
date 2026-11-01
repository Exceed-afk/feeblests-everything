// The AI assistant's main-process side: provider settings, the API key (Electron
// safeStorage only — never plain text), the single HTTP call, and running the
// model's ONE chosen function locally. Read-only by construction: nothing here
// can create, edit or delete user data.
//
// What leaves the computer per question (shown to the user under each answer):
//   - the fixed instruction block (ASSISTANT_SYSTEM_PROMPT, no user data),
//   - one user turn: "Today is <date>. Question: <their question>",
//   - nothing else. No rows, no SQL, no history. The numeric result comes back
//     to the app and never travels to the provider again.
import { safeStorage } from 'electron'
import type Database from 'better-sqlite3'
import {
  ASSISTANT_FUNCTIONS, ASSISTANT_SYSTEM_PROMPT, ASSISTANT_USER_PROMPT, DEFAULT_ASSISTANT,
  assistantQuestionError, assistantReady, assistantSettingsPatchError, CANNOT_ANSWER_MESSAGE, checkEndpoint, clampRange, cleanModelText, failureText,
  functionByName, matchFilters, normalizeAssistantPatch,
  parseAssistantReply, resolveRange,
  type AssistantExchange, type AssistantFunctionInfo, type AssistantKeyStatus, type AssistantProvider, type AssistantRows, type AssistantSettings,
  type AskOutcome
} from '../shared/assistant'
import { listEntries } from './logbook'
import { listTrades } from './trades'
import { listAllTransactions, listGoals } from './savings'
import { listHabits } from './habits'
import { listCompletions, listTasks } from './tasks'
import { deleteSetting, getSettings, setSetting } from './db'
import { isDate } from './util'

const TIMEOUT_MS = 30_000
const KEY_SETTING = 'assistantKeyBlob' // encrypted blob, NOT the key itself
let readableCache: boolean | null = null

// ---------- provider settings (the key lives apart, encrypted) ----------

export function assistantSettings(): AssistantSettings {
  const saved = getSettings() as unknown as Record<string, unknown>
  const a = (saved.assistant ?? {}) as Partial<AssistantSettings>
  return { ...DEFAULT_ASSISTANT, ...a, provider: (a.provider ?? 'off') as AssistantProvider }
}

export function setAssistantSettings(patch: Partial<AssistantSettings>): AssistantSettings {
  const patchError = assistantSettingsPatchError(patch)
  if (patchError) throw new Error(patchError)
  const next = normalizeAssistantPatch(assistantSettings(), patch)
  setSetting('assistant', next)
  return next
}

// ---------- the API key (safeStorage or nothing) ----------

export type KeyStoreResult = { ok: true } | { ok: false; error: string }

// Adjustment 2: refuse to store a key when encryption is unavailable. On Linux a
// "basic_text" backend means the "encryption" is a plain-text obfuscation — refused too.
export function encryptionAvailable(): boolean {
  if (!safeStorage.isEncryptionAvailable()) return false
  if (process.platform === 'linux') {
    const backend = (safeStorage as unknown as { getSelectedStorageBackend?(): string }).getSelectedStorageBackend?.()
    if (backend === 'basic_text') return false
  }
  return true
}

export function keySaved(): boolean {
  const blob = (getSettings() as unknown as Record<string, unknown>)[KEY_SETTING]
  return typeof blob === 'string' && blob.length > 0
}

export function storeKey(plain: string): KeyStoreResult {
  if (!plain.trim()) return { ok: false, error: 'Paste an API key first.' }
  if (!encryptionAvailable()) {
    return { ok: false, error: 'This system cannot encrypt the key (on Linux: no gnome-keyring/KWallet backend is available). The key would be stored in plain text, so it was NOT saved. Run the app in a desktop session with a keyring, or use Local model mode which needs no key.' }
  }
  const blob = safeStorage.encryptString(plain.trim()).toString('base64')
  setSetting(KEY_SETTING, blob)
  readableCache = null
  return { ok: true }
}

export function clearKey(): void {
  deleteSetting(KEY_SETTING)
  readableCache = null
}

const readKey = (): string | null => {
  const blob = (getSettings() as unknown as Record<string, unknown>)[KEY_SETTING]
  if (typeof blob !== 'string' || !blob) return null
  try {
    return safeStorage.decryptString(Buffer.from(blob, 'base64'))
  } catch {
    return null // a blob from another machine/user: unusable, treated as no key
  }
}

// The key NEVER crosses into the renderer: this returns only status booleans.
export function keyStatus(): AssistantKeyStatus {
  const saved = keySaved()
  if (saved && readableCache === null) readableCache = readKey() !== null
  return {
    saved,
    readable: saved && readableCache === true,
    encryptionOk: encryptionAvailable()
  }
}

// ---------- the rows the chosen function may read ----------

const loadRows = (db: Database.Database, today: string, range: { from: string; to: string }): AssistantRows => ({
  txs: listAllTransactions(db),
  goals: listGoals(db),
  trades: listTrades(db),
  habits: listHabits(db, today).habits,
  tasks: listTasks(db, today),
  completions: listCompletions(db, range),
  entries: listEntries(db)
})

// ---------- one question, one function call ----------

type HttpResult = { ok: true; text: string } | { ok: false; kind: 'offline' | 'badkey' | 'timeout' | 'http' | 'model' }

async function callProvider(url: string, key: string | null, model: string, question: string, today: string): Promise<HttpResult> {
  const body = {
    model,
    messages: [
      { role: 'system', content: ASSISTANT_SYSTEM_PROMPT },
      { role: 'user', content: ASSISTANT_USER_PROMPT(question, today) }
    ],
    temperature: 0
  }
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
  try {
    const res = await fetch(`${url.replace(/\/+$/, '')}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(key ? { Authorization: `Bearer ${key}` } : {})
      },
      body: JSON.stringify(body),
      signal: controller.signal,
      redirect: 'error'
    })
    if (res.status === 401 || res.status === 403) return { ok: false, kind: 'badkey' }
    if (!res.ok) return { ok: false, kind: 'http' }
    const data = await res.json() as { choices?: { message?: { content?: unknown } }[] }
    const content = data.choices?.[0]?.message?.content
    if (typeof content !== 'string' || !content.trim()) return { ok: false, kind: 'model' }
    return { ok: true, text: content }
  } catch (e) {
    if (e instanceof Error && e.name === 'AbortError') return { ok: false, kind: 'timeout' }
    return { ok: false, kind: 'offline' }
  } finally {
    clearTimeout(timer)
  }
}

export async function askAssistant(db: Database.Database, question: string, today: string): Promise<AskOutcome> {
  const settings = assistantSettings()
  const masterOn = ((getSettings().intelligence as { features?: { aiAssistant?: boolean } } | undefined)?.features?.aiAssistant) ?? false
  if (!assistantReady(settings, masterOn)) {
    return { ok: false, error: settings.provider === 'cloud' && !settings.cloudConfirmed ? failureText('confirm') : failureText('off') }
  }
  if (!question.trim()) return { ok: false, error: 'Ask something first.' }
  const questionError = assistantQuestionError(question)
  if (questionError) return { ok: false, error: questionError }
  if (!isDate(today)) throw new Error('Date must look like 2026-10-25')

  const endpoint = settings.provider === 'cloud' ? settings.cloudUrl : settings.localUrl
  const endpointCheck = checkEndpoint(endpoint, settings.provider)
  if (!endpointCheck.ok) return { ok: false, error: endpointCheck.error }

  const key = settings.provider === 'cloud' ? readKey() : null
  if (settings.provider === 'cloud' && !key) {
    return { ok: false, error: 'No API key saved yet. Paste it under Intelligence → AI provider (it is stored encrypted, or not at all).' }
  }

  const http = await callProvider(endpoint, key, settings.model, question, today)
  if (!http.ok) return { ok: false, error: failureText(http.kind) }

  const cleaned = cleanModelText(http.text)
  const parsed = parseAssistantReply(cleaned.ok ? cleaned.text : http.text)
  if (!parsed.ok) return { ok: false, error: parsed.error }
  if (parsed.call.kind === 'none') {
    const userPrompt = ASSISTANT_USER_PROMPT(question, today)
    return {
      ok: true,
      exchange: {
        question: question.trim(),
        answer: CANNOT_ANSWER_MESSAGE,
        disclosure: {
          kind: 'cannot_answer',
          question: userPrompt,
          systemPromptChars: ASSISTANT_SYSTEM_PROMPT.length,
          userPromptChars: userPrompt.length
        },
        at: new Date().toISOString()
      }
    }
  }
  const rangeSpec = parsed.call.rangeSpec
  const clamped = clampRange(resolveRange(rangeSpec, today), today, { allowAllTime: rangeSpec.kind === 'all_time' })
  if (!clamped.ok) return { ok: false, error: failureText('range') }

  const fn = functionByName(parsed.call.functionName)
  if (!fn) return { ok: false, error: failureText('model') }

  // The ONE local, read-only run. Nothing here writes: AssistantRows is built from
  // SELECT-only queries, and fn returns a number.
  const range = clamped.range
  const rows = loadRows(db, today, range)
  const filterMatch = matchFilters(rows, fn.name, parsed.call.filters)
  if (!filterMatch.ok) return { ok: false, error: filterMatch.error }
  let result: number
  try {
    result = fn.run(rows, range, today, filterMatch.filters)
  } catch {
    return { ok: false, error: failureText('model') }
  }

  const filterNote = filterMatch.warning ? ` ${filterMatch.warning}` : ''
  const answer =
    `${fn.name.replace(/_/g, ' ')} for ${range.from} to ${range.to}: ${result}` +
    (parsed.call.question && parsed.call.question !== question.trim() ? ` (about: ${parsed.call.question})` : '') +
    filterNote

  const exchange: AssistantExchange = {
    question: question.trim(),
    answer,
    // Adjustment 3: full disclosure of what was sent and what came back.
    disclosure: {
      kind: 'computed',
      question: ASSISTANT_USER_PROMPT(question, today),
      systemPromptChars: ASSISTANT_SYSTEM_PROMPT.length,
      userPromptChars: ASSISTANT_USER_PROMPT(question, today).length,
      functionName: fn.name,
      rangeSpec,
      range,
      filters: filterMatch.disclosure,
      result
    },
    at: new Date().toISOString()
  }
  return { ok: true, exchange }
}

// The function list for the Intelligence page's plain-language table.
export const assistantFunctionList = (): AssistantFunctionInfo[] =>
  ASSISTANT_FUNCTIONS.map(({ name, description, examples, supports }) => ({ name, description, examples, supports }))

export { DEFAULT_ASSISTANT }
