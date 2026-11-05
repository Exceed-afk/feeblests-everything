// Backup file format + CSV, as plain functions with no Electron or database
// code, so they are easy to test. The database side is in src/main/backup.ts.
import { calcPnl } from './trades'
import { round8 } from './math'
import { signedAmount } from './savings'
import { MOODS, type BackupCounts, type Direction, type TaskPriority, type TaskRecurrence, type TaskStatus, type TxKind } from './types'

export const BACKUP_APP = 'feeblests-everything'
export const BACKUP_FORMAT = 1

// Raw rows as stored in the database (camelCase). P&L and balances are NOT in
// here because they are always calculated from these fields.
export interface BackupEntry { id: number; date: string; title: string; body: string; mood: string | null; tags: string[]; createdAt: string; updatedAt: string }
export interface BackupTrade { id: number; date: string; asset: string; direction: Direction; entryPrice: number; exitPrice: number | null; quantity: number; fees: number; notes: string; tags: string[]; closedAt?: string | null; createdAt: string; updatedAt: string }
export interface BackupGoal { id: number; name: string; target: number | null; notes: string; createdAt: string; updatedAt: string }
export interface BackupHabit {
  id: number; name: string; notes: string; days: number[]; archived: boolean; startDate: string; createdAt: string; updatedAt: string
  // The kind of habit. Optional: backups made before habit types existed have
  // no type, and every one of those habits was a plain "check" habit.
  type?: 'check' | 'count' | 'duration'
  // How much is enough, for 'count' and 'duration' habits.
  target?: number | null
  // The label for that number ("sessions", "min", ...).
  unit?: string
  // Manual position and time of day. Optional: backups made before these
  // existed have neither, and an old habit reads as "anytime, position from
  // its creation order".
  sortOrder?: number
  timeOfDay?: 'morning' | 'afternoon' | 'evening' | 'anytime'
  // Reminder time ("HH:MM" or null) and the Logbook link ('' or
  // 'logbook-entry'). Optional: old backups have neither.
  reminderTime?: string | null
  autoCompleteOn?: '' | 'logbook-entry'
}
// The day status is optional: backups made before skipped days existed have no
// status, and every one of those check-ins was a plain "done".
// The value is optional too: it only exists for 'count' and 'duration' habits.
export interface BackupCheckin {
  habitId: number; date: string; createdAt: string
  status?: 'done' | 'skipped'
  value?: number | null
}
export interface BackupTx { id: number; goalId: number; date: string; kind: TxKind; amount: number; note: string; createdAt: string; updatedAt: string }
export interface BackupTask {
  id: number; title: string; notes: string; status: TaskStatus; priority: TaskPriority
  dueDate: string | null; dueTime: string | null
  createdAt: string; completedAt: string | null; deletedAt: string | null
  project: string | null; tags: string[]; position: number
  recurrenceRule: TaskRecurrence | null; recurrenceNext: string | null
}
export interface BackupTaskSubtask { id: number; taskId: number; title: string; done: boolean; sortOrder: number }
export interface BackupTaskCompletion { taskId: number; completedAt: string }

// ---------- Phase 0 additions (optional rows/columns; old files keep working) ----------

// Trash state on any of the five user-facing tables (Phase 0). Optional so a
// file made before soft delete existed still imports; missing = live as ever.
export interface TrashMeta { deletedAt?: string | null; deleteBatchId?: string | null }

export interface BackupLink { id: number; sourceType: string; sourceId: number; targetType: string; targetId: number; relation: string; createdAt: string; deletedAt?: string | null }
export interface BackupTagging { id: number; tagId: number; entityType: string; entityId: number; createdAt: string; updatedAt: string }
export interface BackupTemplate { id: number; kind: string; name: string; payload: unknown; isBuiltin: boolean; createdAt: string; updatedAt: string }

// ---------- Calculator additions (calc_* tables) ----------
export interface BackupCalcHistory {
  id: number
  createdAt: string
  mode: string
  input: string
  result: string
  resultFormat: 'decimal' | 'fraction' | 'scientific' | 'engineering'
  rateSnapshot: string | null
  pinned: boolean
}
export interface BackupCalcVariable {
  name: string
  value: string
  updatedAt: string
}
export interface BackupCalcProgram {
  id: number
  name: string
  source: string
  createdAt: string
  updatedAt: string
}
export interface BackupCalcRateSet {
  id: string
  name: string
  baseCurrency: string
  isActive: boolean
  updatedAt: string
}
export interface BackupCalcRate {
  id: number
  rateSetId: string
  currencyCode: string
  name: string
  rateToBase: string
  note: string
  updatedAt: string
}
export interface BackupCalcRateOverride {
  id: number
  rateSetId: string
  fromCode: string
  toCode: string
  rate: string
  updatedAt: string
}
export interface BackupCalcSetting {
  key: string
  value: string
}

export interface BackupCalculator {
  history: BackupCalcHistory[]
  variables: BackupCalcVariable[]
  programs: BackupCalcProgram[]
  rateSets: BackupCalcRateSet[]
  rates: BackupCalcRate[]
  rateOverrides: BackupCalcRateOverride[]
  settings: BackupCalcSetting[]
}

export interface BackupFile {
  app: typeof BACKUP_APP
  format: number // layout of this file
  schemaVersion: number // database version it was made from
  exportedAt: string
  settings: Record<string, unknown>
  logbook: (BackupEntry & TrashMeta)[]
  trades: (BackupTrade & TrashMeta)[]
  savingsGoals: (BackupGoal & TrashMeta)[]
  savingsTransactions: (BackupTx & TrashMeta)[]
  habits: (BackupHabit & TrashMeta)[] // files made before habits existed have no list; it is read as empty
  habitCheckins: BackupCheckin[]
  tasks: (BackupTask & { updatedAt?: string; deleteBatchId?: string | null })[]
  taskSubtasks: BackupTaskSubtask[]
  taskCompletions?: BackupTaskCompletion[]
  // Phase 0 tables. Optional so older files keep importing; missing = empty.
  links?: BackupLink[]
  tags?: (BackupTag & TrashMeta)[]
  taggings?: BackupTagging[]
  templates?: BackupTemplate[]
  // Calculator tables (Phase 12 / Migration 27). Optional for backward compatibility;
  // older files have no calculator section.
  calculator?: BackupCalculator
}

// One row of the tags table (distinct from per-tag colours in settings).
export interface BackupTag { id: number; name: string; colour?: string | null; createdAt?: string; updatedAt?: string }

export const countsOf = (b: Pick<BackupFile, 'logbook' | 'trades' | 'savingsGoals' | 'savingsTransactions' | 'habits' | 'habitCheckins' | 'tasks' | 'taskSubtasks'>): BackupCounts => ({
  entries: b.logbook.length, trades: b.trades.length, goals: b.savingsGoals.length, transactions: b.savingsTransactions.length,
  habits: b.habits.length, checkins: b.habitCheckins.length, tasks: b.tasks.length, subtasks: b.taskSubtasks.length
})

// The full counts, with the Phase 0 tables. The base counts keep their old
// shape (the Data page and the tests read them); the extras ride along.
export const countsFull = (b: BackupFile): BackupCounts & { links: number; tags: number; taggings: number; templates: number } => ({
  ...countsOf(b),
  links: b.links?.length ?? 0,
  tags: b.tags?.length ?? 0,
  taggings: b.taggings?.length ?? 0,
  templates: b.templates?.length ?? 0
})

// ---------- Checking an imported file ----------
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const isDate = (v: unknown): boolean => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)
const isRealDate = (v: unknown): boolean => {
  if (!isDate(v)) return false
  const [year, month, day] = (v as string).split('-').map(Number)
  const date = new Date(Date.UTC(year, month - 1, day))
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
}
const isTime = (v: unknown): boolean => typeof v === 'string' && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(v)
const isStr = (v: unknown): v is string => typeof v === 'string'
const isInt = (v: unknown): v is number => Number.isInteger(v) && (v as number) > 0
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)
const isStrArray = (v: unknown): boolean => Array.isArray(v) && v.every(isStr)

// Throws an Error with a plain message pointing at the first problem found.
// `maxSchema` is the newest database version this app understands.
export function parseBackup(text: string, maxSchema: number): BackupFile {
  let data: unknown
  try { data = JSON.parse(text.replace(/^/, '')) } catch { throw new Error('This file is not valid JSON.') }
  if (!isObj(data) || data.app !== BACKUP_APP) throw new Error("This is not a Feeblest's Everything backup file.")
  if (data.format !== BACKUP_FORMAT) throw new Error('This backup was made by a different version of the app and cannot be read.')
  if (!isInt(data.schemaVersion) || data.schemaVersion > maxSchema)
    throw new Error('This backup comes from a newer version of the app. Update the app first, then import it.')
  for (const k of ['habits', 'habitCheckins', 'tasks', 'taskSubtasks', 'taskCompletions']) if (data[k] === undefined) data[k] = [] // older backups
  for (const k of ['links', 'tags', 'taggings', 'templates']) if (data[k] === undefined) data[k] = [] // files from before Phase 0
  for (const k of ['logbook', 'trades', 'savingsGoals', 'savingsTransactions', 'habits', 'habitCheckins', 'tasks', 'taskSubtasks', 'taskCompletions'])
    if (!Array.isArray(data[k])) throw new Error(`The backup is missing its "${k}" list.`)
  if (!isObj(data.settings)) throw new Error('The backup is missing its settings.')

  const bad = (what: string, i: number, id: unknown): never => {
    throw new Error(`${what} #${i + 1} (id ${String(id)}) has a missing or invalid field.`)
  }
  const common = (r: Record<string, unknown>) => isInt(r.id) && isStr(r.createdAt) && isStr(r.updatedAt)

  const seen = (rows: { id: number }[], what: string) => {
    const ids = new Set<number>()
    for (const r of rows) {
      if (ids.has(r.id)) throw new Error(`${what} contains the id ${r.id} twice.`)
      ids.add(r.id)
    }
    return ids
  }

  const logbook = data.logbook as Record<string, unknown>[]
  logbook.forEach((r, i) => {
    if (!isObj(r) || !common(r) || !isDate(r.date) || !isStr(r.title) || !isStr(r.body) ||
        !(r.mood === null || (isStr(r.mood) && (MOODS as string[]).includes(r.mood))) || !isStrArray(r.tags)) bad('Logbook entry', i, isObj(r) ? r.id : '?')
  })
  const trades = data.trades as Record<string, unknown>[]
  trades.forEach((r, i) => {
    if (!isObj(r) || !common(r) || !isDate(r.date) || !isStr(r.asset) || !r.asset.trim() ||
        (r.direction !== 'long' && r.direction !== 'short') || !isNum(r.entryPrice) || !(r.entryPrice > 0) ||
        !(r.exitPrice === null || (isNum(r.exitPrice) && r.exitPrice > 0)) || !isNum(r.quantity) || !(r.quantity > 0) ||
        !isNum(r.fees) || r.fees < 0 || !isStr(r.notes) || !isStrArray(r.tags) ||
        !(r.closedAt === undefined || r.closedAt === null || (isStr(r.closedAt) && !Number.isNaN(Date.parse(r.closedAt))))) bad('Trade', i, isObj(r) ? r.id : '?')
  })
  const goals = data.savingsGoals as Record<string, unknown>[]
  goals.forEach((r, i) => {
    if (!isObj(r) || !common(r) || !isStr(r.name) || !(r.target === null || (isNum(r.target) && r.target > 0)) ||
        !isStr(r.notes)) bad('Savings goal', i, isObj(r) ? r.id : '?')
  })
  const txs = data.savingsTransactions as Record<string, unknown>[]
  txs.forEach((r, i) => {
    if (!isObj(r) || !common(r) || !isInt(r.goalId) || !isDate(r.date) || (r.kind !== 'deposit' && r.kind !== 'withdrawal') ||
        !isNum(r.amount) || !(r.amount > 0) || !isStr(r.note)) bad('Savings transaction', i, isObj(r) ? r.id : '?')
  })

  const habits = data.habits as Record<string, unknown>[]
  habits.forEach((r, i) => {
    if (!isObj(r) || !common(r) || !isStr(r.name) || !r.name.trim() || !isStr(r.notes) || typeof r.archived !== 'boolean' ||
        !isDate(r.startDate) || !Array.isArray(r.days) || r.days.length === 0 || new Set(r.days).size !== r.days.length ||
        !r.days.every((d) => Number.isInteger(d) && d >= 0 && d <= 6)) bad('Habit', i, isObj(r) ? r.id : '?')
    // The type is optional (older backups have none, and those are 'check').
    // If it is there it must be one of the three we know.
    if (r.type !== undefined && r.type !== 'check' && r.type !== 'count' && r.type !== 'duration') bad('Habit', i, isObj(r) ? r.id : '?')
    // The target is optional, but if it is there it must be a number of zero or more.
    if (!(r.target === null || r.target === undefined || (isNum(r.target) && r.target >= 0))) bad('Habit', i, isObj(r) ? r.id : '?')
    // The unit is optional, but if it is there it must be text.
    if (!(r.unit === null || r.unit === undefined || isStr(r.unit))) bad('Habit', i, isObj(r) ? r.id : '?')
    // The manual position is optional, but if it is there it must be zero or more.
    if (!(r.sortOrder === undefined || (isNum(r.sortOrder) && r.sortOrder >= 0))) bad('Habit', i, isObj(r) ? r.id : '?')
    // The time of day is optional, but if it is there it must be one of the four.
    if (r.timeOfDay !== undefined && r.timeOfDay !== 'morning' && r.timeOfDay !== 'afternoon' &&
        r.timeOfDay !== 'evening' && r.timeOfDay !== 'anytime') bad('Habit', i, isObj(r) ? r.id : '?')
    // The reminder is optional: null or an HH:MM string (loosely checked here;
    // cleanReminderTime normalises it on import).
    if (!(r.reminderTime === null || r.reminderTime === undefined ||
        (isStr(r.reminderTime) && /^\d{1,2}:\d{2}$/.test(r.reminderTime)))) bad('Habit', i, isObj(r) ? r.id : '?')
    // The Logbook link is optional, but if it is there it must be on or off.
    if (r.autoCompleteOn !== undefined && r.autoCompleteOn !== '' && r.autoCompleteOn !== 'logbook-entry') bad('Habit', i, isObj(r) ? r.id : '?')
  })
  const tasks = data.tasks as Record<string, unknown>[]
  // Tasks have no inserted/updated stamp pair (the table only stores created_at), so they
  // cannot use the shared common() check that logbook, trades, goals and habits do.
  // Backward compatibility: files made before migration 9 may carry sortOrder/recurrence/
  // parentTaskId instead of position/recurrenceRule; the old fields map onto the new ones
  // and the extras (dueTime, deletedAt) default sensibly.
  const numOrDefault = (v: unknown, fallback: number): number => (Number.isInteger(v) || typeof v === 'number' && Number.isFinite(v) ? (v as number) : fallback)
  tasks.forEach((r, i) => {
    if (!isObj(r)) bad('Task', i, '?')
    if (!isInt(r.id) || !isStr(r.createdAt) || !isStr(r.title) || !r.title.trim() || !isStr(r.notes) ||
      !['todo', 'in-progress', 'done'].includes(String(r.status)) || !['low', 'medium', 'high'].includes(String(r.priority)) ||
      !(r.dueDate === null || isRealDate(r.dueDate)) || !(r.dueTime === null || r.dueTime === undefined || isTime(r.dueTime)) ||
      !(r.completedAt === null || isStr(r.completedAt)) ||
      !(r.deletedAt === null || r.deletedAt === undefined || isStr(r.deletedAt)) ||
      !(r.project === null || isStr(r.project)) || !isStrArray(r.tags) ||
      !(r.recurrenceRule === null || r.recurrenceRule === undefined || (isObj(r.recurrenceRule) &&
        ['daily', 'weekly', 'monthly', 'custom'].includes(String(r.recurrenceRule.frequency)) &&
        (r.recurrenceRule.frequency !== 'custom' || (Number.isInteger(r.recurrenceRule.intervalDays) && Number(r.recurrenceRule.intervalDays) > 0)))) ||
      !(r.recurrenceNext === null || r.recurrenceNext === undefined || isRealDate(r.recurrenceNext)))
      bad('Task', i, typeof r.id === 'number' ? r.id : '?')
    // Normalize old-shape files into the current shape so restoreBackup always sees the new columns.
    const legacyRule = isObj(r.recurrence) ? r.recurrence : null
    r.dueTime = r.dueTime ?? null
    r.deletedAt = r.deletedAt ?? null
    r.position = numOrDefault(r.position, numOrDefault(r.sortOrder, typeof r.id === 'number' ? r.id : 0))
    r.recurrenceRule = r.recurrenceRule ?? legacyRule
    r.recurrenceNext = r.recurrenceNext ?? null
    r.sortOrder = undefined
    r.recurrence = undefined
    r.parentTaskId = undefined
  })
  const taskSubtasks = data.taskSubtasks as Record<string, unknown>[]
  taskSubtasks.forEach((r, i) => {
    if (!isObj(r) || !isInt(r.id) || !isInt(r.taskId) || !isStr(r.title) || !r.title.trim() || typeof r.done !== 'boolean' || !Number.isInteger(r.sortOrder))
      bad('Task subtask', i, isObj(r) ? r.id : '?')
  })
  const checkins = data.habitCheckins as Record<string, unknown>[]
  checkins.forEach((r, i) => {
    if (!isObj(r) || !isInt(r.habitId) || !isDate(r.date) || !isStr(r.createdAt)) bad('Habit check-in', i, '?')
    // The status is optional (older backups have none). If it is there it must
    // be one of the two we know.
    if (r.status !== undefined && r.status !== 'done' && r.status !== 'skipped') bad('Habit check-in', i, '?')
    // The logged value is optional, but if it is there it must be a number of zero or more.
    if (!(r.value === null || r.value === undefined || (isNum(r.value) && r.value >= 0))) bad('Habit check-in', i, '?')
  })

  seen(logbook as never, 'The logbook'); seen(trades as never, 'The trades')
  const goalIds = seen(goals as never, 'The savings goals'); seen(txs as never, 'The savings transactions')
  for (const t of txs as unknown as BackupTx[])
    if (!goalIds.has(t.goalId)) throw new Error(`Savings transaction ${t.id} belongs to goal ${t.goalId}, which is not in the file.`)

  const taskIds = seen(tasks as never, 'The tasks')
  seen(taskSubtasks as never, 'The task subtasks')
  for (const s of taskSubtasks as unknown as BackupTaskSubtask[]) if (!taskIds.has(s.taskId)) throw new Error(`Task subtask ${s.id} belongs to task ${s.taskId}, which is not in the file.`)
  for (const completion of data.taskCompletions as Record<string, unknown>[]) {
    if (!isObj(completion) || !isInt(completion.taskId) || !isStr(completion.completedAt))
      bad('Task completion', (data.taskCompletions as unknown[]).indexOf(completion), isObj(completion) ? completion.taskId : '?')
    if (!taskIds.has(completion.taskId as number)) {
      throw new Error(`A task completion belongs to task ${String(completion.taskId)}, which is not in the file.`)
    }
  }

  const habitIds = seen(habits as never, 'The habits')
  const checked = new Set<string>()
  for (const c of checkins as unknown as BackupCheckin[]) {
    if (!habitIds.has(c.habitId)) throw new Error(`A habit check-in belongs to habit ${c.habitId}, which is not in the file.`)
    const key = `${c.habitId}|${c.date}`
    if (checked.has(key)) throw new Error(`Habit ${c.habitId} is checked off twice on ${c.date}.`)
    checked.add(key)
  }

  // Same rule the app enforces when you add, edit or delete: a goal's balance never goes below 0.
  const balances = new Map<number, number>()
  for (const t of txs as unknown as BackupTx[])
    balances.set(t.goalId, round8((balances.get(t.goalId) ?? 0) + signedAmount(t.kind, t.amount)))
  for (const g of goals as unknown as BackupGoal[]) {
    const balance = balances.get(g.id) ?? 0
    if (balance < 0) throw new Error(`Savings goal "${g.name}" would end with a negative balance (${balance}), which the app does not allow.`)
  }

  // Phase 0 tables: links, tags, taggings, templates. Every list is optional;
  // the ids must be unique and every reference must point at a row in THIS file.
  const links = (data.links ?? []) as Record<string, unknown>[]
  const linkable = (v: unknown): boolean => ['logbook', 'trade', 'goal', 'task'].includes(String(v))
  links.forEach((r, i) => {
    if (!isObj(r) || !isInt(r.id) || !isStr(r.sourceType) || !isStr(r.targetType) || !isInt(r.sourceId) || !isInt(r.targetId) ||
        !isStr(r.relation) || !isStr(r.createdAt) ||
        !linkable(r.sourceType) || !linkable(r.targetType) ||
        !(r.deletedAt === undefined || r.deletedAt === null || isStr(r.deletedAt))) bad('Link', i, isObj(r) ? r.id : '?')
  })
  const tags = (data.tags ?? []) as Record<string, unknown>[]
  tags.forEach((r, i) => {
    if (!isObj(r) || !isInt(r.id) || !isStr(r.name) || !r.name.trim() || r.name !== r.name.trim().toLowerCase())
      bad('Tag', i, isObj(r) ? r.id : '?')
    if (!(r.colour === undefined || r.colour === null || isStr(r.colour))) bad('Tag', i, isObj(r) ? r.id : '?')
    if (!(r.deletedAt === undefined || r.deletedAt === null || isStr(r.deletedAt))) bad('Tag', i, isObj(r) ? r.id : '?')
    if (!(r.createdAt === undefined || isStr(r.createdAt)) || !(r.updatedAt === undefined || isStr(r.updatedAt))) bad('Tag', i, isObj(r) ? r.id : '?')
  })
  const taggings = (data.taggings ?? []) as Record<string, unknown>[]
  const tagIds = new Set((tags as unknown as { id: number }[]).map((t) => t.id))
  const entityTables: Record<string, { id: number }[] | undefined> = {
    logbook: logbook as unknown as { id: number }[], trade: trades as unknown as { id: number }[],
    goal: goals as unknown as { id: number }[], task: tasks as unknown as { id: number }[]
  }
  seen(taggings as never, 'The tag sets')
  taggings.forEach((r, i) => {
    if (!isObj(r) || !isInt(r.id) || !isInt(r.tagId) || !isStr(r.entityType) || !isInt(r.entityId) ||
        !isStr(r.createdAt) || !isStr(r.updatedAt)) bad('Tag set', i, isObj(r) ? r.id : '?')
    if (!tagIds.has(r.tagId as number)) throw new Error(`Tag set ${String(r.id)} points at tag ${String(r.tagId)}, which is not in the file.`)
    const rows = entityTables[String(r.entityType)]
    if (!rows) throw new Error(`Tag set ${String(r.id)} points at unknown item kind "${String(r.entityType)}".`)
    if (!rows.some((row) => row.id === r.entityId)) throw new Error(`Tag set ${String(r.id)} points at item ${String(r.entityId)} of kind "${String(r.entityType)}", which is not in the file.`)
  })
  const templates = (data.templates ?? []) as Record<string, unknown>[]
  templates.forEach((r, i) => {
    if (!isObj(r) || !isInt(r.id) || !isStr(r.kind) || !isStr(r.name) || !r.name.trim() ||
        !isObj(r.payload) || typeof r.isBuiltin !== 'boolean' || !isStr(r.createdAt) || !isStr(r.updatedAt))
      bad('Template', i, isObj(r) ? r.id : '?')
  })

  // Calculator tables (calc_*). Optional for backward compatibility.
  // If present, all sections must be valid arrays and references must be consistent.
  if (data.calculator !== undefined) {
    if (!isObj(data.calculator)) throw new Error('The calculator backup section is not an object.')
    const calc = data.calculator as Record<string, unknown>
    const calcSections = ['history', 'variables', 'programs', 'rateSets', 'rates', 'rateOverrides', 'settings']
    for (const sec of calcSections) {
      if (!Array.isArray(calc[sec])) throw new Error(`The calculator backup section is missing its "${sec}" list.`)
    }

    const validFormats = ['decimal', 'fraction', 'scientific', 'engineering']

    const history = calc.history as Record<string, unknown>[]
    seen(history as never, 'Calculator history')
    history.forEach((r, i) => {
      if (!isObj(r) || !isInt(r.id) || !isStr(r.createdAt) || !isStr(r.mode) || !isStr(r.input) ||
          !isStr(r.result) || !validFormats.includes(String(r.resultFormat)) ||
          !(r.rateSnapshot === null || isStr(r.rateSnapshot)) || typeof r.pinned !== 'boolean') {
        bad('Calculator history item', i, isObj(r) ? r.id : '?')
      }
    })

    const variables = calc.variables as Record<string, unknown>[]
    const varNames = new Set<string>()
    variables.forEach((r, i) => {
      if (!isObj(r) || !isStr(r.name) || !r.name.trim() || !isStr(r.value) || !isStr(r.updatedAt)) {
        bad('Calculator variable', i, isObj(r) ? r.name : '?')
      }
      const norm = (r.name as string).trim().toLowerCase()
      if (varNames.has(norm)) throw new Error(`Calculator variables contain the name "${norm}" twice.`)
      varNames.add(norm)
    })

    const programs = calc.programs as Record<string, unknown>[]
    seen(programs as never, 'Calculator programs')
    programs.forEach((r, i) => {
      if (!isObj(r) || !isInt(r.id) || !isStr(r.name) || !r.name.trim() || !isStr(r.source) ||
          !isStr(r.createdAt) || !isStr(r.updatedAt)) {
        bad('Calculator program', i, isObj(r) ? r.id : '?')
      }
    })

    const rateSets = calc.rateSets as Record<string, unknown>[]
    const rateSetIds = new Set<string>()
    rateSets.forEach((r, i) => {
      if (!isObj(r) || !isStr(r.id) || !r.id.trim() || !isStr(r.name) || !r.name.trim() ||
          !isStr(r.baseCurrency) || !r.baseCurrency.trim() || typeof r.isActive !== 'boolean' || !isStr(r.updatedAt)) {
        bad('Calculator rate set', i, isObj(r) ? r.id : '?')
      }
      const id = (r.id as string).trim()
      if (rateSetIds.has(id)) throw new Error(`Calculator rate sets contain the id "${id}" twice.`)
      rateSetIds.add(id)
    })

    const rates = calc.rates as Record<string, unknown>[]
    seen(rates as never, 'Calculator rates')
    const ratePairs = new Set<string>()
    rates.forEach((r, i) => {
      if (!isObj(r) || !isInt(r.id) || !isStr(r.rateSetId) || !isStr(r.currencyCode) || !r.currencyCode.trim() ||
          !isStr(r.name) || !isStr(r.rateToBase) || !isStr(r.note) || !isStr(r.updatedAt)) {
        bad('Calculator rate', i, isObj(r) ? r.id : '?')
      }
      if (!rateSetIds.has(r.rateSetId as string)) {
        throw new Error(`Calculator rate #${i + 1} (id ${String(r.id)}) references rate set "${String(r.rateSetId)}", which is not in the file.`)
      }
      const pair = `${r.rateSetId}|${(r.currencyCode as string).toUpperCase()}`
      if (ratePairs.has(pair)) {
        throw new Error(`Calculator rates contain the currency "${String(r.currencyCode)}" twice for rate set "${String(r.rateSetId)}".`)
      }
      ratePairs.add(pair)
    })

    const overrides = calc.rateOverrides as Record<string, unknown>[]
    seen(overrides as never, 'Calculator rate overrides')
    const overridePairs = new Set<string>()
    overrides.forEach((r, i) => {
      if (!isObj(r) || !isInt(r.id) || !isStr(r.rateSetId) || !isStr(r.fromCode) || !r.fromCode.trim() ||
          !isStr(r.toCode) || !r.toCode.trim() || !isStr(r.rate) || !isStr(r.updatedAt)) {
        bad('Calculator rate override', i, isObj(r) ? r.id : '?')
      }
      if (!rateSetIds.has(r.rateSetId as string)) {
        throw new Error(`Calculator rate override #${i + 1} (id ${String(r.id)}) references rate set "${String(r.rateSetId)}", which is not in the file.`)
      }
      const pair = `${r.rateSetId}|${(r.fromCode as string).toUpperCase()}|${(r.toCode as string).toUpperCase()}`
      if (overridePairs.has(pair)) {
        throw new Error(`Calculator rate overrides contain the pair "${String(r.fromCode)} -> ${String(r.toCode)}" twice for rate set "${String(r.rateSetId)}".`)
      }
      overridePairs.add(pair)
    })

    const settings = calc.settings as Record<string, unknown>[]
    const settingKeys = new Set<string>()
    settings.forEach((r, i) => {
      if (!isObj(r) || !isStr(r.key) || !r.key.trim() || !isStr(r.value)) {
        bad('Calculator setting', i, isObj(r) ? r.key : '?')
      }
      const k = (r.key as string).trim()
      if (settingKeys.has(k)) throw new Error(`Calculator settings contain the key "${k}" twice.`)
      settingKeys.add(k)
    })
  }

  return data as unknown as BackupFile
}

// ---------- Trades as CSV (opens in Excel) ----------
const CSV_COLUMNS = ['id', 'date', 'asset', 'direction', 'entry_price', 'exit_price', 'quantity', 'fees', 'pnl', 'status', 'tags', 'notes']

// Quotes a value when needed. Text starting with = + - @ gets a leading ' so
// Excel cannot run it as a formula.
function cell(v: string | number | null, isText = false): string {
  if (v === null) return ''
  let s = String(v)
  if (isText && /^[=+\-@\t\r]/.test(s)) s = "'" + s
  return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s
}

// UTF-8 BOM first so Excel reads accents correctly; CRLF line endings.
export function tradesToCsv(trades: BackupTrade[]): string {
  const sorted = [...trades].sort((a, b) => a.date.localeCompare(b.date) || a.id - b.id)
  const lines = [CSV_COLUMNS.join(',')]
  for (const t of sorted) {
    lines.push([
      cell(t.id), cell(t.date), cell(t.asset, true), cell(t.direction), cell(t.entryPrice), cell(t.exitPrice),
      cell(t.quantity), cell(t.fees), cell(calcPnl(t)), t.exitPrice === null ? 'open' : 'closed',
      cell(t.tags.join(' '), true), cell(t.notes, true)
    ].join(','))
  }
  return '' + lines.join('\r\n') + '\r\n'
}
