// The AI assistant's shared rules: the fixed read-only function table, how the model is
// asked to pick one, and the validation of what each provider mode may be pointed at.
// Pure: no Electron, no database, no fetch. The main process (src/main/assistant.ts) owns
// the API key, the HTTP call and the actual data lookups; this file holds the contract
// both sides agree on, and everything the tests can check without any of that.
//
// Privacy contract (step 6):
//  - Off means OFF: nothing is built, nothing is sent, no HTTP request exists.
//  - The model never sees rows, SQL or the database. It answers with ONE function call;
//    the app runs it locally on the shared data layer and shows the user exactly what
//    was sent (question, function, arguments, numeric result) under the reply.
//  - Local mode may only point at loopback; cloud mode must be https (loopback exempt).
import { round8 } from './math'
import { signedAmount } from './savings'
import { isAutomationEntry } from './automations'
import { MOOD_SCORE } from './types'
import { addDays, weekdayOf } from './habits'
import type { Habit, LogEntry, Mood, SavingsTx, Task, Trade } from './types'

// ---------- provider modes ----------

export type AssistantProvider = 'off' | 'local' | 'cloud'

export interface AssistantSettings {
    provider: AssistantProvider
    localUrl: string
    cloudUrl: string
    model: string
    cloudConfirmed: boolean // the explicit "I understand data leaves the computer" step
}

export interface AssistantKeyStatus {
    saved: boolean
    readable: boolean
    encryptionOk: boolean
}

export function keyStateLabel(status: AssistantKeyStatus): 'none' | 'ok' | 'unreadable' {
  if (!status.saved) return 'none'
  return status.readable ? 'ok' : 'unreadable'
}

export const DEFAULT_ASSISTANT: AssistantSettings = {
    provider: 'off',
    localUrl: 'http://localhost:11434/v1',
    cloudUrl: 'https://api.openai.com/v1',
    model: 'gpt-4o-mini',
    cloudConfirmed: false
}

export const MAX_ASSISTANT_URL_LENGTH = 300
export const MAX_ASSISTANT_MODEL_LENGTH = 100
export const MAX_ASSISTANT_QUESTION_LENGTH = 500

const isProvider = (value: unknown): value is AssistantProvider =>
  value === 'off' || value === 'local' || value === 'cloud'

const comparableCloudUrl = (value: string): string => value.trim().replace(/\/+$/, '')

export function assistantSettingsPatchError(patch: unknown): string | null {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) return null
  const values = patch as Record<string, unknown>
  if (
    (typeof values.localUrl === 'string' && values.localUrl.length > MAX_ASSISTANT_URL_LENGTH) ||
    (typeof values.cloudUrl === 'string' && values.cloudUrl.length > MAX_ASSISTANT_URL_LENGTH)
  ) return `Provider addresses must be ${MAX_ASSISTANT_URL_LENGTH} characters or fewer.`
  if (typeof values.model === 'string' && values.model.length > MAX_ASSISTANT_MODEL_LENGTH) {
    return `Model names must be ${MAX_ASSISTANT_MODEL_LENGTH} characters or fewer.`
  }
  return null
}

export function normalizeAssistantPatch(current: AssistantSettings, patch: unknown): AssistantSettings {
    const currentCloudUrl = typeof current.cloudUrl === 'string' ? current.cloudUrl : ''
    const next: AssistantSettings = {
      provider: isProvider(current.provider) ? current.provider : DEFAULT_ASSISTANT.provider,
      localUrl: typeof current.localUrl === 'string' && current.localUrl.length <= MAX_ASSISTANT_URL_LENGTH
        ? current.localUrl : DEFAULT_ASSISTANT.localUrl,
      cloudUrl: typeof current.cloudUrl === 'string' && current.cloudUrl.length <= MAX_ASSISTANT_URL_LENGTH
        ? current.cloudUrl : DEFAULT_ASSISTANT.cloudUrl,
      model: typeof current.model === 'string' && current.model.length <= MAX_ASSISTANT_MODEL_LENGTH
        ? current.model : DEFAULT_ASSISTANT.model,
      cloudConfirmed: typeof current.cloudConfirmed === 'boolean' ? current.cloudConfirmed : false
    }
    let cloudUrlChanged = comparableCloudUrl(next.cloudUrl) !== comparableCloudUrl(currentCloudUrl)

    if (!patch || typeof patch !== 'object' || Array.isArray(patch)) {
      if (cloudUrlChanged) next.cloudConfirmed = false
      return next
    }
    const values = patch as Record<string, unknown>
    if (values.provider === 'off' || values.provider === 'local' || values.provider === 'cloud') {
      next.provider = values.provider
    }
    if (typeof values.localUrl === 'string' && values.localUrl.length <= MAX_ASSISTANT_URL_LENGTH) {
      next.localUrl = values.localUrl
    }
    if (typeof values.cloudUrl === 'string' && values.cloudUrl.length <= MAX_ASSISTANT_URL_LENGTH) {
      cloudUrlChanged = comparableCloudUrl(next.cloudUrl) !== comparableCloudUrl(values.cloudUrl)
      next.cloudUrl = values.cloudUrl
    }
    if (typeof values.model === 'string' && values.model.length <= MAX_ASSISTANT_MODEL_LENGTH) {
      next.model = values.model
    }
    if (typeof values.cloudConfirmed === 'boolean') {
      next.cloudConfirmed = values.cloudConfirmed
    }
    if (cloudUrlChanged) next.cloudConfirmed = false
    return next
}

export function assistantQuestionError(question: string): string | null {
  return question.length > MAX_ASSISTANT_QUESTION_LENGTH
    ? `A question must be ${MAX_ASSISTANT_QUESTION_LENGTH} characters or fewer.`
    : null
}

export const CLOUD_CONFIRM_PHRASE = 'I understand'

// The intelligence.features.aiAssistant master toggle must ALSO be on; these are the
// provider details. The renderer treats the assistant as usable only when both agree.
export const assistantReady = (s: AssistantSettings, masterOn: boolean): boolean =>
    masterOn && s.provider !== 'off' && (s.provider === 'local' || s.cloudConfirmed)

// ---------- endpoint validation ----------

const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]', '::1'])

export function checkEndpoint(url: string, provider: AssistantProvider): { ok: true } | { ok: false; error: string } {
    if (provider === 'off') return { ok: false, error: failureText('off') }
    const trimmed = (url ?? '').trim()
    if (!trimmed) return { ok: false, error: 'Enter the provider address first.' }
    let parsed: URL
    try { parsed = new URL(trimmed) } catch { return { ok: false, error: 'That address does not look like a URL (example: http://localhost:11434/v1).' } }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        return { ok: false, error: 'The address must start with http:// or https://.' }
    }
    const host = parsed.hostname.toLowerCase()
    const isLocal = LOOPBACK.has(host)
    if (provider === 'local') {
        if (!isLocal) return { ok: false, error: 'Local model mode may only point at localhost, 127.0.0.1 or [::1] — anything else would send your data to another machine. Use Cloud mode for that.' }
        return { ok: true }
    }
    // cloud
    if (parsed.protocol !== 'https:') {
        if (isLocal) return { ok: false, error: 'Cloud mode needs an https address. For a local server, use Local model mode instead.' }
        return { ok: false, error: 'Cloud mode requires https, so the key and your questions travel encrypted.' }
    }
    return { ok: true }
}

export function defaultUrl(provider: AssistantProvider): string {
    return provider === 'cloud' ? DEFAULT_ASSISTANT.cloudUrl : DEFAULT_ASSISTANT.localUrl
}

// ---------- read-only data functions (the fixed table) ----------
// Each function takes rows + a range and returns ONE number. The model picks one of
// these by name; the app runs it locally on rows it already has in memory.

export interface AssistantRows {
    txs: SavingsTx[]
    trades: Trade[]
    habits: Habit[]
    tasks: Task[]
    entries: LogEntry[]
}

export interface DateRange { from: string; to: string } // "YYYY-MM-DD", inclusive

export const MAX_RANGE_DAYS = 1830

export function isRealDate(value: string): boolean {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
    const [year, month, day] = value.split('-').map(Number)
    const utcYear = year < 100 ? year + 400 : year
    const date = new Date(Date.UTC(utcYear, month - 1, day))
    return date.getUTCFullYear() === utcYear && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
}

export type ClampRangeResult =
    | { ok: true; range: DateRange }
    | { ok: false; kind: 'empty' | 'range' }

export function clampRange(range: DateRange, today: string): ClampRangeResult {
    const to = range.to > today ? today : range.to
    if (range.from > to) return { ok: false, kind: 'empty' }
    const spanDays = (Date.parse(`${to}T00:00:00.000Z`) - Date.parse(`${range.from}T00:00:00.000Z`)) / 86_400_000 + 1
    if (spanDays > MAX_RANGE_DAYS) return { ok: false, kind: 'range' }
    return { ok: true, range: { from: range.from, to } }
}

export interface AssistantFunctionDef {
    name: string
    description: string // goes into the prompt
    run: (rows: AssistantRows, range: DateRange) => number
}

const inRange = (date: string, r: DateRange): boolean => date >= r.from && date <= r.to

const moodScores = (entries: LogEntry[], r: DateRange): number[] =>
    entries.filter((e) => !isAutomationEntry(e) && e.mood !== null && e.mood in MOOD_SCORE && inRange(e.date, r))
        .map((e) => MOOD_SCORE[e.mood as Mood])

// Habit scheduled days in the range: iterate the RANGE's days (not just the check-ins),
// so a scheduled-but-unchecked day counts against the rate. A check-in on a rest day is
// neither done nor scheduled. Days before the habit existed are not missed.
const habitScheduledDays = (habits: Habit[], r: DateRange): { done: number; scheduled: number } => {
    let done = 0, scheduled = 0
    for (const h of habits) {
        if (h.archived) continue
        if (h.startDate > r.to) continue // did not exist yet in this window
        const checked = new Set(h.checkins)
        const from = r.from < h.startDate ? h.startDate : r.from
        for (let d = from; d <= r.to; d = addDays(d, 1)) {
            if (!h.days.includes(weekdayOf(d))) continue
            scheduled++
            if (checked.has(d)) done++
        }
    }
    return { done, scheduled }
}

const completedOn = (t: Task, r: DateRange): boolean => {
    if (t.status !== 'done' || !t.completedAt) return false
    const d = new Date(t.completedAt)
    if (Number.isNaN(d.getTime())) return false
    const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    return inRange(iso, r)
}

// The table. Adding a function = one entry here; the prompt is built from it automatically.
export const ASSISTANT_FUNCTIONS: AssistantFunctionDef[] = [
    {
        name: 'savings_total',
        description: 'Net savings (deposits minus withdrawals) for a date range.',
        run: (rows, r) => round8(rows.txs.filter((t) => inRange(t.date, r)).reduce((a, t) => a + signedAmount(t.kind, t.amount), 0))
    },
    {
        name: 'trade_pnl',
        description: 'Total profit and loss of trades dated in a date range (a trade counts on its entry date; open trades are not counted).',
        run: (rows, r) => round8(rows.trades.filter((t) => t.pnl !== null && inRange(t.date, r)).reduce((a, t) => a + (t.pnl as number), 0))
    },
    {
        name: 'habit_completion_rate',
        description: 'Percentage of scheduled habit days checked off in a date range; 0 when nothing was scheduled.',
        run: (rows, r) => {
            const { done, scheduled } = habitScheduledDays(rows.habits, r)
            return scheduled === 0 ? 0 : round8((done / scheduled) * 100)
        }
    },
    {
        name: 'tasks_completed',
        description: 'How many tasks were completed in a date range.',
        run: (rows, r) => rows.tasks.filter((t) => completedOn(t, r)).length
    },
    {
        name: 'mood_average',
        description: 'Average mood (1 rough to 5 great) of journal entries dated in a date range; 0 when none were logged.',
        run: (rows, r) => {
            const m = moodScores(rows.entries, r)
            return m.length === 0 ? 0 : round8(m.reduce((a, b) => a + b, 0) / m.length)
        }
    },
    {
        name: 'journal_entries',
        description: 'How many journal entries were written in a date range.',
        run: (rows, r) => rows.entries.filter((e) => !isAutomationEntry(e) && inRange(e.date, r)).length
    }
]

export const functionByName = (name: string): AssistantFunctionDef | undefined =>
    ASSISTANT_FUNCTIONS.find((f) => f.name === name)

// ---------- the prompt (what actually leaves, per question) ----------

export const ASSISTANT_SYSTEM_PROMPT =
    'You answer questions about the user\'s personal logbook, savings, trades, habits and tasks. ' +
    'You cannot see any raw data. Reply with ONLY one JSON object, no prose, in this exact shape: ' +
    '{"function":"<name>","range":{"from":"YYYY-MM-DD","to":"YYYY-MM-DD"},"question":"<the user\'s question, repeated back>"} ' +
    'Choose "function" from this list:\n' +
    ASSISTANT_FUNCTIONS.map((f) => `- ${f.name}: ${f.description}`).join('\n') +
    '\nThe range must be a contiguous span of calendar days that answers the question. ' +
    'If no function fits exactly, use the closest one. Never invent a function name.'

export const ASSISTANT_USER_PROMPT = (question: string, today: string): string =>
    `Today is ${today}. Question: ${question.trim()}`

// ---------- parsing the reply (the model's ONE function call) ----------

export interface AssistantCall { functionName: string; range: DateRange; question: string }

export function parseAssistantReply(raw: string): { ok: true; call: AssistantCall } | { ok: false; error: string } {
    const text = raw.trim()
    const start = text.indexOf('{')
    const end = text.lastIndexOf('}')
    if (start < 0 || end <= start) return { ok: false, error: failureText('model') }
    let obj: unknown
    try { obj = JSON.parse(text.slice(start, end + 1)) } catch { return { ok: false, error: failureText('model') } }
    const o = obj as { function?: unknown; range?: unknown; question?: unknown }
    if (typeof o.function !== 'string' || !functionByName(o.function)) return { ok: false, error: failureText('model') }
    const r = (o.range ?? {}) as { from?: unknown; to?: unknown }
    const iso = (v: unknown): string | null =>
        typeof v === 'string' && isRealDate(v) ? v : null
    const from = iso(r.from), to = iso(r.to)
    if (!from || !to || from > to) return { ok: false, error: failureText('model') }
    const question = typeof o.question === 'string' && o.question.trim() ? o.question.trim() : ''
    return { ok: true, call: { functionName: o.function, range: { from, to }, question } }
}

// Cleans a model answer: drops reasoning blocks and keeps the JSON object the
// parser needs. Some local models wrap replies in  or prose.
export function cleanModelText(raw: string): { ok: true; text: string } | { ok: false; error: string } {
    let clean = raw.replace(/[\s\S]*?<\/think>/gi, '').trim()
    if (!clean) clean = raw.replace(/[\s\S]*/i, '').trim() // an unclosed block
    clean = clean.trim()
    // Keep only from the first '{' to the last '}' when prose surrounds the JSON.
    const start = clean.indexOf('{'), end = clean.lastIndexOf('}')
    if (start >= 0 && end > start) clean = clean.slice(start, end + 1)
    if (!clean) return { ok: false, error: failureText('model') }
    return { ok: true, text: clean }
}

// ---------- range helpers (local dates, UTC-safe) ----------

export const weekRange = (today: string): DateRange => {
    const start = addDays(today, -weekdayOf(today))
    return { from: start, to: addDays(start, 6) }
}
export const monthRange = (today: string): DateRange => {
    const [y, m] = today.split('-').map(Number)
    const last = new Date(Date.UTC(y, m, 0)).getUTCDate()
    const to = `${y}-${String(m).padStart(2, '0')}-${String(last).padStart(2, '0')}`
    return { from: `${y}-${String(m).padStart(2, '0')}-01`, to }
}
export const lastWeekRange = (today: string): DateRange => {
    const w = weekRange(today)
    return { from: addDays(w.from, -7), to: addDays(w.from, -1) }
}
export const lastNDays = (today: string, n: number): DateRange => ({ from: addDays(today, -(n - 1)), to: today })

// ---------- what the renderer is told about one turn (adjustment 3) ----------

export interface AssistantDisclosure {
    question: string // exactly what was sent as the user turn
    systemPromptChars: number // size of the fixed instructions block
    userPromptChars: number // size of the user turn
    functionName: string
    range: DateRange
    result: number
}

export interface AssistantExchange {
    question: string
    answer: string
    disclosure: AssistantDisclosure
    at: string
}

export type AskOutcome =
    | { ok: true; exchange: AssistantExchange }
    | { ok: false; error: string }

// ---------- plain failure words (never contain the key or raw payloads) ----------

export type FailureKind = 'off' | 'confirm' | 'offline' | 'badkey' | 'timeout' | 'http' | 'model' | 'range'

export function failureText(kind: FailureKind): string {
    switch (kind) {
        case 'off': return 'The assistant is off. Choose a provider under Intelligence → AI provider first.'
        case 'confirm': return 'Cloud mode needs your explicit confirmation first, because it sends data over the internet. Confirm it under Intelligence → AI provider.'
        case 'offline': return 'Could not reach the model. For a local model, check that the server is running and the address matches.'
        case 'badkey': return 'The provider rejected the API key. Paste it again on the Intelligence page — keys are stored encrypted and never shown back.'
        case 'timeout': return 'The model took too long to answer. Try a shorter question, or check the server is not still loading.'
        case 'http': return 'The provider returned an error. Check the model name on the Intelligence page.'
        case 'model': return 'The model answered in a shape this app cannot use. Try rephrasing the question.'
        case 'range': return 'That date range is too long or has not happened yet. Try something under 5 years.'
    }
}
