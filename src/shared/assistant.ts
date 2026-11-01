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
import { addDays, habitRateInRange, weekdayOf } from './habits'
import { localTaskDay } from './tasks'
import type { Habit, LogEntry, Mood, SavingsGoal, SavingsTx, Task, TaskCompletion, Trade } from './types'

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
    goals: SavingsGoal[]
    trades: Trade[]
    habits: Habit[]
    tasks: Task[]
    completions: TaskCompletion[]
    entries: LogEntry[]
}

export interface DateRange { from: string; to: string } // "YYYY-MM-DD", inclusive

export const MAX_RANGE_DAYS = 1830
const ALL_TIME_START_DATE = '1970-01-01'

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

export function clampRange(
    range: DateRange,
    today: string,
    options: { allowAllTime?: boolean } = {}
): ClampRangeResult {
    const to = range.to > today ? today : range.to
    if (range.from > to) return { ok: false, kind: 'empty' }
    const spanDays = (Date.parse(`${to}T00:00:00.000Z`) - Date.parse(`${range.from}T00:00:00.000Z`)) / 86_400_000 + 1
    const isAllowedAllTime = options.allowAllTime === true && range.from === ALL_TIME_START_DATE && range.to === today
    if (spanDays > MAX_RANGE_DAYS && !isAllowedAllTime) return { ok: false, kind: 'range' }
    return { ok: true, range: { from: range.from, to } }
}

export interface AssistantFunctionDef {
    name: string
    label: string
    description: string // goes into the prompt
    examples: string[]
    supports: FilterName[]
    run: (rows: AssistantRows, range: DateRange, today?: string, filters?: ResolvedAssistantFilters) => number
}

export interface AssistantFunctionInfo {
    name: string
    description: string
    examples: string[]
    supports: FilterName[]
}

export type FilterName = 'asset' | 'direction' | 'tag' | 'goal' | 'project' | 'habit'
export type AssistantFilters = Partial<Record<FilterName, string>>
export type ResolvedAssistantFilters = Partial<Record<FilterName, string | number>>

export interface FilterDisclosure {
    sent: AssistantFilters
    matched: ResolvedAssistantFilters
    ignored: FilterName[]
}

export type FilterMatchResult =
    | { ok: true; filters: ResolvedAssistantFilters; disclosure: FilterDisclosure; warning: string | null }
    | { ok: false; error: string }

const FILTER_NAMES: FilterName[] = ['asset', 'direction', 'tag', 'goal', 'project', 'habit']
const normalizedLabel = (label: string): string => label.trim().toLocaleLowerCase()

const matchLabel = (label: string, candidates: string[]): string | null =>
    candidates.find((candidate) => normalizedLabel(candidate) === normalizedLabel(label)) ?? null

const filterNotFound = (name: FilterName, value: string): string => {
    const article = /^[aeiou]/i.test(name) ? 'an' : 'a'
    return `I couldn't find ${article} ${name} called "${value}".`
}

export function matchFilters(
    rows: AssistantRows,
    functionName: string,
    filters: AssistantFilters = {}
): FilterMatchResult {
    const fn = functionByName(functionName)
    if (!fn) return { ok: false, error: 'That assistant function is not supported.' }

    const matched: ResolvedAssistantFilters = {}
    const displayMatched: ResolvedAssistantFilters = {}
    const ignored: FilterName[] = []
    for (const [rawName, rawValue] of Object.entries(filters)) {
        if (!FILTER_NAMES.includes(rawName as FilterName) || typeof rawValue !== 'string' || !rawValue.trim()) {
            return { ok: false, error: 'That filter is not valid.' }
        }
        const name = rawName as FilterName
        const value = rawValue.trim()
        if (!fn.supports.includes(name)) {
            ignored.push(name)
            continue
        }

        if (name === 'direction') {
            const direction = value.trim().toLowerCase()
            if (direction !== 'long' && direction !== 'short') {
                return { ok: false, error: filterNotFound(name, value) }
            }
            matched.direction = direction
            displayMatched.direction = direction
            continue
        }

        let candidates: string[]
        switch (name) {
            case 'asset':
                candidates = [...new Set(rows.trades.map((trade) => trade.asset))]
                break
            case 'tag':
                candidates = [...new Set(
                    functionName === 'trade_pnl' ? rows.trades.flatMap((trade) => trade.tags)
                        : functionName === 'tasks_completed' ? rows.tasks.flatMap((task) => task.tags)
                            : rows.entries.flatMap((entry) => entry.tags)
                )]
                break
            case 'goal':
                candidates = rows.goals.map((goal) => goal.name)
                break
            case 'project':
                candidates = [...new Set(rows.tasks.flatMap((task) => task.project ? [task.project] : []))]
                break
            case 'habit':
                candidates = rows.habits.map((habit) => habit.name)
                break
        }
        const found = matchLabel(value, candidates)
        if (!found) return { ok: false, error: filterNotFound(name, value) }
        displayMatched[name] = found
        if (name === 'goal') {
            const goal = rows.goals.find((item) => item.name === found)
            if (!goal) return { ok: false, error: filterNotFound(name, value) }
            matched.goal = goal.id
        } else if (name === 'habit') {
            const habit = rows.habits.find((item) => item.name === found)
            if (!habit) return { ok: false, error: filterNotFound(name, value) }
            matched.habit = habit.id
        } else matched[name] = found
    }

    const warning = ignored.length > 0
        ? `Note: I ignored unsupported filters: ${ignored.join(', ')}.`
        : null
    return {
        ok: true,
        filters: matched,
        disclosure: { sent: { ...filters }, matched: displayMatched, ignored },
        warning
    }
}

const inRange = (date: string, r: DateRange): boolean => date >= r.from && date <= r.to

const moodScores = (entries: LogEntry[], r: DateRange): number[] =>
    entries.filter((e) => !isAutomationEntry(e) && e.mood !== null && e.mood in MOOD_SCORE && inRange(e.date, r))
        .map((e) => MOOD_SCORE[e.mood as Mood])

const completedOn = (completion: TaskCompletion, r: DateRange): boolean => {
    const date = localTaskDay(completion.completedAt)
    return date !== null && inRange(date, r)
}

// The table. Adding a function = one entry here; the prompt is built from it automatically.
export const ASSISTANT_FUNCTIONS: AssistantFunctionDef[] = [
    {
        name: 'savings_total',
        label: 'savings total',
        description: 'Net savings (deposits minus withdrawals) for a date range.',
        examples: ['How much did I save last month?'],
        supports: ['goal'],
        run: (rows, r, _today, filters) => round8(rows.txs
            .filter((t) => inRange(t.date, r) && (filters?.goal === undefined || t.goalId === filters.goal))
            .reduce((a, t) => a + signedAmount(t.kind, t.amount), 0))
    },
    {
        name: 'trade_pnl',
        label: 'trade P&L',
        description: 'Total profit and loss of trades dated in a date range (a trade counts on its entry date; open trades are not counted).',
        examples: ['What was my total trade P&L this month?'],
        supports: ['asset', 'direction', 'tag'],
        run: (rows, r, _today, filters) => round8(rows.trades
            .filter((t) => t.pnl !== null && inRange(t.date, r) &&
                (filters?.asset === undefined || t.asset === filters.asset) &&
                (filters?.direction === undefined || t.direction === filters.direction) &&
                (filters?.tag === undefined || t.tags.some((tag) => normalizedLabel(tag) === normalizedLabel(String(filters.tag))))
            )
            .reduce((a, t) => a + (t.pnl as number), 0))
    },
    {
        name: 'habit_completion_rate',
        label: 'habit completion',
        description: 'Percentage of scheduled habit days checked off in a date range; 0 when nothing was scheduled.',
        examples: ['What was my habit completion rate this week?'],
        supports: ['habit'],
        run: (rows, r, today = r.to, filters) => {
            const selectedHabits = rows.habits.filter((habit) =>
                filters?.habit === undefined || habit.id === filters.habit
            )
            const totals = selectedHabits.reduce((sum, habit) => {
                const rate = habitRateInRange(habit, r.from, r.to, today)
                return { done: sum.done + rate.done, due: sum.due + rate.due }
            }, { done: 0, due: 0 })
            return totals.due === 0 ? 0 : round8((totals.done / totals.due) * 100)
        }
    },
    {
        name: 'tasks_completed',
        label: 'tasks completed',
        description: 'How many tasks were completed in a date range.',
        examples: ['How many tasks did I complete this week?'],
        supports: ['project', 'tag'],
        run: (rows, r, _today, filters) => {
            if (filters?.project === undefined && filters?.tag === undefined) {
                return rows.completions.filter((completion) => completedOn(completion, r)).length
            }
            const tasksById = new Map(rows.tasks.map((task) => [task.id, task]))
            return rows.completions.filter((completion) => {
                const task = tasksById.get(completion.taskId)
                return task !== undefined && completedOn(completion, r) &&
                    (filters?.project === undefined || task.project === filters.project) &&
                    (filters?.tag === undefined || task.tags.some((tag) => normalizedLabel(tag) === normalizedLabel(String(filters.tag))))
            }).length
        }
    },
    {
        name: 'mood_average',
        label: 'mood average',
        description: 'Average mood (1 rough to 5 great) of journal entries dated in a date range; 0 when none were logged.',
        examples: ["What's my mood average over the last 30 days?"],
        supports: ['tag'],
        run: (rows, r, _today, filters) => {
            const entries = filters?.tag === undefined ? rows.entries
                : rows.entries.filter((entry) => entry.tags.some((tag) =>
                    normalizedLabel(tag) === normalizedLabel(String(filters.tag))))
            const m = moodScores(entries, r)
            return m.length === 0 ? 0 : round8(m.reduce((a, b) => a + b, 0) / m.length)
        }
    },
    {
        name: 'journal_entries',
        label: 'journal entries',
        description: 'How many journal entries were written in a date range.',
        examples: ['How many journal entries did I write this month?'],
        supports: ['tag'],
        run: (rows, r, _today, filters) => rows.entries.filter((e) => !isAutomationEntry(e) && inRange(e.date, r) &&
            (filters?.tag === undefined || e.tags.some((tag) =>
                normalizedLabel(tag) === normalizedLabel(String(filters.tag)))))
            .length
    }
]

export const functionByName = (name: string): AssistantFunctionDef | undefined =>
    ASSISTANT_FUNCTIONS.find((f) => f.name === name)

// ---------- the prompt (what actually leaves, per question) ----------

export const ASSISTANT_SYSTEM_PROMPT =
    'You answer questions about the user\'s personal logbook, savings, trades, habits and tasks. ' +
    'You cannot see any raw data. Reply with ONLY one JSON object, no prose, in this exact shape: ' +
    '{"function":"<name>","range":{"kind":"<range kind>"},"question":"<the user\'s question, repeated back>"}; ' +
    'use range kinds today, yesterday, this_week, last_week, this_month, last_month, this_year, all_time, ' +
    'or {"kind":"last_n_days","n":1..1830}, or {"kind":"between","from":"YYYY-MM-DD","to":"YYYY-MM-DD"}. ' +
    'Add a filters object only when useful, copying relevant words from the question without guessing, such as {"filters":{"asset":"XAUUSD"}}. ' +
    'Add "compare":"previous" only when the user asks for a comparison; otherwise use "compare":null. ' +
    ASSISTANT_FUNCTIONS.map((f) => `${f.name} supports filters: ${f.supports.join(', ') || 'none'}.`).join(' ') + ' ' +
    'For unsupported questions, reply with {"function":"cannot_answer"}. ' +
    'Choose "function" from this list:\n' +
    ASSISTANT_FUNCTIONS.map((f) => `- ${f.name}: ${f.description}`).join('\n') +
    '\nChoose the range kind that matches the user\'s words; do not calculate dates for symbolic ranges. ' +
    'The range must be a contiguous span of calendar days that answers the question. ' +
    'Do not guess or use the closest function when none fits. Never invent a function name.'

export const ASSISTANT_USER_PROMPT = (question: string, today: string): string =>
    `Today is ${today}. Question: ${question.trim()}`

// ---------- parsing the reply (the model's ONE function call) ----------

export type AssistantCall =
    | { kind: 'function'; functionName: string; rangeSpec: RangeSpec; filters: AssistantFilters; compare: 'previous' | null; question: string }
    | { kind: 'none' }

export type RangeSpec =
    | { kind: 'today' | 'yesterday' | 'this_week' | 'last_week' | 'this_month' | 'last_month' | 'this_year' | 'all_time' }
    | { kind: 'last_n_days'; n: number }
    | { kind: 'between'; from: string; to: string }

const RANGE_KINDS = new Set([
    'today', 'yesterday', 'this_week', 'last_week', 'this_month', 'last_month',
    'this_year', 'all_time', 'last_n_days', 'between'
])

function parseRangeSpec(value: unknown): RangeSpec | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null
    const range = value as Record<string, unknown>
    if (range.kind === undefined) {
        const from = range.from, to = range.to
        if (typeof from !== 'string' || typeof to !== 'string' || !isRealDate(from) || !isRealDate(to) || from > to) {
            return null
        }
        return { kind: 'between', from, to }
    }
    if (typeof range.kind !== 'string' || !RANGE_KINDS.has(range.kind)) return null
    if (range.kind === 'last_n_days') {
        return typeof range.n === 'number' && Number.isInteger(range.n) && range.n >= 1 && range.n <= MAX_RANGE_DAYS
            ? { kind: 'last_n_days', n: range.n }
            : null
    }
    if (range.kind === 'between') {
        const { from, to } = range
        return typeof from === 'string' && typeof to === 'string' && isRealDate(from) && isRealDate(to) && from <= to
            ? { kind: 'between', from, to }
            : null
    }
    return { kind: range.kind as Exclude<RangeSpec['kind'], 'last_n_days' | 'between'> }
}

export function parseAssistantReply(raw: string): { ok: true; call: AssistantCall } | { ok: false; error: string } {
    const text = raw.trim()
    const start = text.indexOf('{')
    const end = text.lastIndexOf('}')
    if (start < 0 || end <= start) return { ok: false, error: failureText('model') }
    let obj: unknown
    try { obj = JSON.parse(text.slice(start, end + 1)) } catch { return { ok: false, error: failureText('model') } }
    const o = obj as { function?: unknown; range?: unknown; filters?: unknown; compare?: unknown; question?: unknown }
    if (typeof o.function !== 'string') return { ok: false, error: failureText('model') }
    if (o.function === 'cannot_answer' || !functionByName(o.function)) return { ok: true, call: { kind: 'none' } }
    const rangeSpec = parseRangeSpec(o.range)
    if (!rangeSpec) return { ok: false, error: failureText('model') }
    let filters: AssistantFilters = {}
    if (o.filters !== undefined) {
        if (!o.filters || typeof o.filters !== 'object' || Array.isArray(o.filters)) return { ok: false, error: failureText('model') }
        const parsedFilters: AssistantFilters = {}
        for (const [name, value] of Object.entries(o.filters)) {
            if (!FILTER_NAMES.includes(name as FilterName) || typeof value !== 'string' || !value.trim()) {
                return { ok: false, error: failureText('model') }
            }
            parsedFilters[name as FilterName] = value.trim()
        }
        filters = parsedFilters
    }
    const compare = o.compare === undefined || o.compare === null
        ? null
        : o.compare === 'previous' ? 'previous' : undefined
    if (compare === undefined) return { ok: false, error: failureText('model') }
    const question = typeof o.question === 'string' && o.question.trim() ? o.question.trim() : ''
    return { ok: true, call: { kind: 'function', functionName: o.function, rangeSpec, filters, compare, question } }
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
export const lastMonthRange = (today: string): DateRange => {
    const previousMonthEnd = addDays(monthRange(today).from, -1)
    return monthRange(previousMonthEnd)
}
export const thisYearRange = (today: string): DateRange => {
    const year = today.slice(0, 4)
    return { from: `${year}-01-01`, to: `${year}-12-31` }
}

export function previousRange(range: DateRange): DateRange {
    const spanDays = (Date.parse(`${range.to}T00:00:00.000Z`) - Date.parse(`${range.from}T00:00:00.000Z`)) / 86_400_000 + 1
    const to = addDays(range.from, -1)
    return { from: addDays(to, -(spanDays - 1)), to }
}

export function comparisonChange(current: number, previous: number): {
    change: number
    percent: number | null
    direction: 'up' | 'down' | 'unchanged'
} {
    const change = round8(current - previous)
    return {
        change,
        percent: previous === 0 ? null : round8((change / Math.abs(previous)) * 100),
        direction: change > 0 ? 'up' : change < 0 ? 'down' : 'unchanged'
    }
}

export function resolveRange(spec: RangeSpec, today: string): DateRange {
    switch (spec.kind) {
        case 'today': return { from: today, to: today }
        case 'yesterday': {
            const yesterday = addDays(today, -1)
            return { from: yesterday, to: yesterday }
        }
        case 'this_week': return weekRange(today)
        case 'last_week': return lastWeekRange(today)
        case 'this_month': return monthRange(today)
        case 'last_month': return lastMonthRange(today)
        case 'this_year': return thisYearRange(today)
        case 'all_time': return { from: ALL_TIME_START_DATE, to: today }
        case 'last_n_days':
            if (!Number.isInteger(spec.n) || spec.n < 1 || spec.n > MAX_RANGE_DAYS) {
                throw new RangeError(`last_n_days must be an integer from 1 to ${MAX_RANGE_DAYS}.`)
            }
            return lastNDays(today, spec.n)
        case 'between':
            if (!isRealDate(spec.from) || !isRealDate(spec.to) || spec.from > spec.to) {
                throw new RangeError('between requires two ordered, real calendar dates.')
            }
            return { from: spec.from, to: spec.to }
    }
}

// ---------- what the renderer is told about one turn (adjustment 3) ----------

interface AssistantDisclosureBase {
    question: string // exactly what was sent as the user turn
    systemPromptChars: number // size of the fixed instructions block
    userPromptChars: number // size of the user turn
}

export type AssistantDisclosure =
    | (AssistantDisclosureBase & {
    kind: 'computed'
    functionName: string
    rangeSpec: RangeSpec
    range: DateRange
    filters: FilterDisclosure
    result: number
    compare: 'previous' | null
    previousRange: DateRange | null
    previousResult: number | null
    })
    | (AssistantDisclosureBase & { kind: 'cannot_answer' })

export const CANNOT_ANSWER_MESSAGE =
    `I can't compute that yet. I can answer: ${ASSISTANT_FUNCTIONS.map((f) => f.label).join(', ')}.`

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
