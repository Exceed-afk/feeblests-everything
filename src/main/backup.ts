// Export / import. Reads and writes the database only; the file dialogs live
// in index.ts. The file format and its checks are in src/shared/backup.ts.
import type Database from 'better-sqlite3'
import { DEFAULT_ASSISTANT, normalizeAssistantPatch } from '../shared/assistant'
import { cleanReminderTime } from '../shared/habits'
import { countsOf, BACKUP_APP, BACKUP_FORMAT, type BackupFile } from '../shared/backup'
import type { BackupCounts, Direction, TaskPriority, TaskStatus, TxKind } from '../shared/types'
import { MIGRATIONS } from './migrations'
import { rebuild as rebuildSearchIndex } from './searchIndex'

// Raw database rows: one narrow shape per table, so every mapper below is
// checked against the columns it actually reads (better than a single
// anything-goes record, which hides typos like `r.tag_id` vs `r.id`).
interface RawBase { id: number; created_at: string; updated_at: string; deleted_at: string | null; delete_batch_id: string | null }
interface RawLogbook extends RawBase { date: string; title: string; body: string; mood: string | null; tags: string }
interface RawTrade extends RawBase { date: string; asset: string; direction: Direction; entry_price: number; exit_price: number | null; quantity: number; fees: number; notes: string; tags: string; closed_at: string | null }
interface RawGoal extends RawBase { name: string; target: number | null; notes: string }
interface RawTx extends RawBase { goal_id: number; date: string; kind: TxKind; amount: number; note: string }
interface RawHabit extends RawBase { name: string; notes: string; days: string; archived: number; start_date: string; type: 'check' | 'count' | 'duration' | null; target: number | null; unit: string | null; sort_order: number | null; time_of_day: 'morning' | 'afternoon' | 'evening' | 'anytime' | null; reminder_time: string | null; auto_complete_on: '' | 'logbook-entry' | null }
interface RawCheckin { habit_id: number; date: string; created_at: string; status: string | null; value: number | null }
interface RawTask extends RawBase { title: string; notes: string; status: TaskStatus; priority: TaskPriority; due_date: string | null; due_time: string | null; completed_at: string | null; project: string | null; tags: string; position: number; recurrence_rule: string | null; recurrence_next: string | null }
interface RawSubtask { id: number; task_id: number; title: string; done: number; sort_order: number }
interface RawCompletion { task_id: number; completed_at: string }
interface RawLink { id: number; source_type: string; source_id: number; target_type: string; target_id: number; relation: string; created_at: string; deleted_at: string | null }
interface RawTag { id: number; name: string; colour: string | null; created_at: string; updated_at: string; deleted_at: string | null }
interface RawTagging { id: number; tag_id: number; entity_type: string; entity_id: number; created_at: string; updated_at: string }
interface RawTemplate { id: number; kind: string; name: string; payload: string; is_builtin: number; created_at: string; updated_at: string }
interface RawCalcHistory { id: number; created_at: string; mode: string; input: string; result: string; result_format: string; rate_snapshot: string | null; pinned: number }
interface RawCalcVariable { name: string; value: string; updated_at: string }
interface RawCalcProgram { id: number; name: string; source: string; created_at: string; updated_at: string }
interface RawCalcRateSet { id: string; name: string; base_currency: string; is_active: number; updated_at: string }
interface RawCalcRate { id: number; rate_set_id: string; currency_code: string; name: string; rate_to_base: string; note: string; updated_at: string }
interface RawCalcRateOverride { id: number; rate_set_id: string; from_code: string; to_code: string; rate: string; updated_at: string }
interface RawCalcSetting { key: string; value: string }

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

// Everything the app stores, as one object.
export function collectBackup(db: Database.Database): BackupFile {
  const settings = Object.fromEntries(
    (db.prepare('SELECT key, value FROM settings ORDER BY key').all() as { key: string; value: string }[])
      // The assistant's encrypted key blob stays out of backups: a backup file should
      // never carry credential material, even encrypted. The user re-pastes the key
      // after a restore (see src/main/assistant.ts). The templates' last-restore
      // stamp is internal bookkeeping, not a setting the user chose.
      .filter((r) => r.key !== 'assistantKeyBlob' && r.key !== 'templatesResetAt')
      .map((r) => [r.key, JSON.parse(r.value as string)] as const)
  )
  return {
    app: BACKUP_APP, format: BACKUP_FORMAT, schemaVersion: MIGRATIONS.length, exportedAt: new Date().toISOString(), settings,
    logbook: (db.prepare('SELECT * FROM logbook_entries ORDER BY id').all() as RawLogbook[]).map((r) => ({
      id: r.id, date: r.date, title: r.title, body: r.body, mood: r.mood, tags: JSON.parse(r.tags as string),
      createdAt: r.created_at, updatedAt: r.updated_at,
      // Trash state (Phase 0). Live rows carry nothing extra.
      deletedAt: r.deleted_at ?? null, deleteBatchId: r.delete_batch_id ?? null
    })),
    trades: (db.prepare('SELECT * FROM trades ORDER BY id').all() as RawTrade[]).map((r) => ({
      id: r.id, date: r.date, asset: r.asset, direction: r.direction, entryPrice: r.entry_price, exitPrice: r.exit_price,
      quantity: r.quantity, fees: r.fees, notes: r.notes, tags: JSON.parse(r.tags as string), closedAt: r.closed_at ?? null, createdAt: r.created_at, updatedAt: r.updated_at,
      deletedAt: r.deleted_at ?? null, deleteBatchId: r.delete_batch_id ?? null
    })),
    savingsGoals: (db.prepare('SELECT * FROM savings_goals ORDER BY id').all() as RawGoal[]).map((r) => ({
      id: r.id, name: r.name, target: r.target, notes: r.notes, createdAt: r.created_at, updatedAt: r.updated_at,
      deletedAt: r.deleted_at ?? null, deleteBatchId: r.delete_batch_id ?? null
    })),
    savingsTransactions: (db.prepare('SELECT * FROM savings_transactions ORDER BY id').all() as RawTx[]).map((r) => ({
      id: r.id, goalId: r.goal_id, date: r.date, kind: r.kind, amount: r.amount, note: r.note,
      createdAt: r.created_at, updatedAt: r.updated_at,
      deletedAt: r.deleted_at ?? null, deleteBatchId: r.delete_batch_id ?? null
    })),
    habits: (db.prepare('SELECT * FROM habits ORDER BY id').all() as RawHabit[]).map((r) => ({
      id: r.id, name: r.name, notes: r.notes, days: JSON.parse(r.days as string), archived: r.archived === 1, startDate: r.start_date,
      createdAt: r.created_at, updatedAt: r.updated_at,
      // The kind of habit. Old rows (before the column existed) read as 'check'.
      type: r.type ?? 'check',
      // How much is enough, for 'count' and 'duration' habits.
      target: r.target ?? null,
      // The label for that number.
      unit: r.unit ?? '',
      // Manual position and time of day. Old rows (before these existed)
      // read as "no time of day" and keep their creation order.
      sortOrder: r.sort_order ?? 0,
      timeOfDay: r.time_of_day ?? 'anytime',
      // Reminder time and the Logbook link. Old rows read as "no reminder,
      // nothing auto-completes", which is what they meant before.
      reminderTime: r.reminder_time ?? null,
      autoCompleteOn: r.auto_complete_on ?? '',
      deletedAt: r.deleted_at ?? null, deleteBatchId: r.delete_batch_id ?? null
    })),
    habitCheckins: (db.prepare('SELECT * FROM habit_checkins ORDER BY habit_id, date').all() as RawCheckin[]).map((r) => ({
      habitId: r.habit_id, date: r.date, createdAt: r.created_at,
      // 'done' or 'skipped'. Old rows (before the column existed) read as 'done'.
      status: r.status === 'skipped' ? 'skipped' : 'done',
      // How much was logged that day, for 'count' and 'duration' habits.
      value: r.value ?? null
    })),
    tasks: (db.prepare('SELECT * FROM tasks ORDER BY id').all() as RawTask[]).map((r) => ({
      id: r.id, title: r.title, notes: r.notes, status: r.status, priority: r.priority, dueDate: r.due_date,
      dueTime: r.due_time, createdAt: r.created_at, completedAt: r.completed_at, deletedAt: r.deleted_at,
      updatedAt: r.updated_at, deleteBatchId: r.delete_batch_id ?? null,
      project: r.project, tags: JSON.parse(r.tags as string), position: r.position,
      recurrenceRule: r.recurrence_rule ? JSON.parse(r.recurrence_rule as string) : null, recurrenceNext: r.recurrence_next
    })),
    taskSubtasks: (db.prepare('SELECT * FROM task_subtasks ORDER BY task_id, sort_order, id').all() as RawSubtask[]).map((r) => ({
      id: r.id, taskId: r.task_id, title: r.title, done: r.done === 1, sortOrder: r.sort_order
    })),
    taskCompletions: (db.prepare('SELECT task_id, completed_at FROM task_completions ORDER BY completed_at, id').all() as RawCompletion[]).map((r) => ({
      taskId: r.task_id, completedAt: r.completed_at
    })),
    // Phase 0 tables. They carry user decisions (links, tags), so they travel
    // with the backup; the search index does NOT (it is rebuilt on restore).
    links: (db.prepare('SELECT * FROM links ORDER BY id').all() as RawLink[]).map((r) => ({
      id: r.id, sourceType: r.source_type, sourceId: r.source_id, targetType: r.target_type, targetId: r.target_id,
      relation: r.relation, createdAt: r.created_at, deletedAt: r.deleted_at ?? null
    })),
    tags: (db.prepare('SELECT * FROM tags ORDER BY id').all() as RawTag[]).map((r) => ({
      id: r.id, name: r.name, colour: r.colour ?? null, createdAt: r.created_at, updatedAt: r.updated_at,
      deletedAt: r.deleted_at ?? null, deleteBatchId: null
    })),
    taggings: (db.prepare('SELECT * FROM taggings ORDER BY id').all() as RawTagging[]).map((r) => ({
      id: r.id, tagId: r.tag_id, entityType: r.entity_type, entityId: r.entity_id,
      createdAt: r.created_at, updatedAt: r.updated_at
    })),
    templates: (db.prepare('SELECT * FROM templates ORDER BY id').all() as RawTemplate[]).map((r) => ({
      id: r.id, kind: r.kind, name: r.name, payload: JSON.parse(r.payload as string), isBuiltin: r.is_builtin === 1,
      createdAt: r.created_at, updatedAt: r.updated_at
    })),
    calculator: {
      history: (db.prepare('SELECT * FROM calc_history ORDER BY id').all() as RawCalcHistory[]).map((r) => ({
        id: r.id, createdAt: r.created_at, mode: r.mode, input: r.input, result: r.result,
        resultFormat: r.result_format as 'decimal' | 'fraction' | 'scientific' | 'engineering',
        rateSnapshot: r.rate_snapshot ?? null, pinned: r.pinned === 1
      })),
      variables: (db.prepare('SELECT * FROM calc_variables ORDER BY name').all() as RawCalcVariable[]).map((r) => ({
        name: r.name, value: r.value, updatedAt: r.updated_at
      })),
      programs: (db.prepare('SELECT * FROM calc_programs ORDER BY id').all() as RawCalcProgram[]).map((r) => ({
        id: r.id, name: r.name, source: r.source, createdAt: r.created_at, updatedAt: r.updated_at
      })),
      rateSets: (db.prepare('SELECT * FROM calc_rate_sets ORDER BY id').all() as RawCalcRateSet[]).map((r) => ({
        id: r.id, name: r.name, baseCurrency: r.base_currency, isActive: r.is_active === 1, updatedAt: r.updated_at
      })),
      rates: (db.prepare('SELECT * FROM calc_rates ORDER BY id').all() as RawCalcRate[]).map((r) => ({
        id: r.id, rateSetId: r.rate_set_id, currencyCode: r.currency_code, name: r.name,
        rateToBase: r.rate_to_base, note: r.note, updatedAt: r.updated_at
      })),
      rateOverrides: (db.prepare('SELECT * FROM calc_rate_overrides ORDER BY id').all() as RawCalcRateOverride[]).map((r) => ({
        id: r.id, rateSetId: r.rate_set_id, fromCode: r.from_code, toCode: r.to_code, rate: r.rate, updatedAt: r.updated_at
      })),
      settings: (db.prepare('SELECT * FROM calc_settings ORDER BY key').all() as RawCalcSetting[]).map((r) => ({
        key: r.key, value: r.value
      }))
    }
  }
}

export function currentCounts(db: Database.Database): BackupCounts {
  const n = (t: string) => (db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get() as { n: number }).n
  return { entries: n('logbook_entries'), trades: n('trades'), goals: n('savings_goals'), transactions: n('savings_transactions'), habits: n('habits'), checkins: n('habit_checkins'), tasks: n('tasks'), subtasks: n('task_subtasks') }
}

// Replaces ALL data with the (already checked) backup. One transaction: if
// anything fails, nothing changes. Original ids are kept, so savings
// transactions still point at the right goals.
export function restoreBackup(db: Database.Database, b: BackupFile): BackupCounts {
  db.transaction(() => {
    // Tasks may point at other tasks (recurring occurrences). Deferring the checks to commit
    // lets the import use each file's own row order, so restoring can never fail halfway
    // on link order; a broken link is still caught by parseBackup before we get here.
    db.pragma('defer_foreign_keys = ON')
    // Goals first on the way in, last on the way out (foreign key). The
    // Phase 0 tables follow the same shape: taggings before tags (FK).
    // Note: If the backup file does not contain a calculator section (backward compatibility),
    // existing calculator tables are left untouched.
    if (b.calculator !== undefined) {
      for (const t of ['calc_history', 'calc_variables', 'calc_programs', 'calc_rate_overrides', 'calc_rates', 'calc_rate_sets', 'calc_settings']) {
        db.exec(`DELETE FROM ${t}`)
      }
    }
    for (const t of ['task_completions', 'task_subtasks', 'tasks', 'habit_checkins', 'habits', 'savings_transactions', 'savings_goals', 'trades', 'logbook_entries', 'automation_events', 'templates', 'taggings', 'tags', 'links', 'settings']) db.exec(`DELETE FROM ${t}`)

    const savedAssistant = isRecord(b.settings.assistant) ? b.settings.assistant : {}
    const restoredSettings: Record<string, unknown> = {
      ...b.settings,
      assistant: normalizeAssistantPatch(DEFAULT_ASSISTANT, {
        model: savedAssistant.model,
        localUrl: savedAssistant.localUrl
      })
    }
    delete restoredSettings.assistantKeyBlob
    if (isRecord(restoredSettings.intelligence)) {
      const restoredIntelligence = { ...restoredSettings.intelligence }
      delete restoredIntelligence.aiProvider
      restoredSettings.intelligence = restoredIntelligence
    }
    const setting = db.prepare('INSERT INTO settings (key, value) VALUES (?, ?)')
    for (const [k, v] of Object.entries(restoredSettings)) setting.run(k, JSON.stringify(v))

    const entry = db.prepare(`INSERT INTO logbook_entries (id, date, title, body, mood, tags, created_at, updated_at)
      VALUES (@id, @date, @title, @body, @mood, @tags, @createdAt, @updatedAt)`)
    for (const e of b.logbook) entry.run({ ...e, tags: JSON.stringify(e.tags) })

    const trade = db.prepare(`INSERT INTO trades (id, date, asset, direction, entry_price, exit_price, quantity, fees, notes, tags, closed_at, created_at, updated_at)
      VALUES (@id, @date, @asset, @direction, @entryPrice, @exitPrice, @quantity, @fees, @notes, @tags, @closedAt, @createdAt, @updatedAt)`)
    for (const t of b.trades) trade.run({ ...t, tags: JSON.stringify(t.tags), closedAt: t.closedAt ?? null })

    const goal = db.prepare(`INSERT INTO savings_goals (id, name, target, notes, created_at, updated_at)
      VALUES (@id, @name, @target, @notes, @createdAt, @updatedAt)`)
    for (const g of b.savingsGoals) goal.run(g)

    const tx = db.prepare(`INSERT INTO savings_transactions (id, goal_id, date, kind, amount, note, created_at, updated_at)
      VALUES (@id, @goalId, @date, @kind, @amount, @note, @createdAt, @updatedAt)`)
    for (const t of b.savingsTransactions) tx.run(t)

    const habit = db.prepare(`INSERT INTO habits (id, name, notes, days, archived, start_date, created_at, updated_at, type, target, unit, sort_order, time_of_day, reminder_time, auto_complete_on)
      VALUES (@id, @name, @notes, @days, @archived, @startDate, @createdAt, @updatedAt, @type, @target, @unit, @sortOrder, @timeOfDay, @reminderTime, @autoCompleteOn)`)
    // A backup made before habit types existed has no type: those habits were
    // all plain "check" habits, and they keep working exactly as before.
    // The same applies to the position, time of day, reminder and Logbook
    // link: old backups restore with the behaviour they had.
    for (const h of b.habits) {
      habit.run({
        ...h,
        days: JSON.stringify(h.days),
        archived: h.archived ? 1 : 0,
        type: h.type ?? 'check',
        target: h.target ?? null,
        unit: h.unit ?? '',
        sortOrder: h.sortOrder ?? h.id,
        timeOfDay: h.timeOfDay ?? 'anytime',
        reminderTime: cleanReminderTime(h.reminderTime),
        autoCompleteOn: h.autoCompleteOn === 'logbook-entry' ? 'logbook-entry' : ''
      })
    }

    const checkin = db.prepare('INSERT INTO habit_checkins (habit_id, date, created_at, status, value) VALUES (@habitId, @date, @createdAt, @status, @value)')
    // A backup made before skipped days existed has no status: those check-ins
    // were all plain "done" days. The logged value is new in the same way.
    for (const c of b.habitCheckins) {
      checkin.run({ ...c, status: c.status === 'skipped' ? 'skipped' : 'done', value: c.value ?? null })
    }

    const task = db.prepare(`INSERT INTO tasks (id, title, notes, status, priority, due_date, due_time, created_at, completed_at, deleted_at, updated_at, delete_batch_id, project, tags, position, recurrence_rule, recurrence_next)
      VALUES (@id, @title, @notes, @status, @priority, @dueDate, @dueTime, @createdAt, @completedAt, @deletedAt, @updatedAt, @deleteBatchId, @project, @tags, @position, @recurrenceRule, @recurrenceNext)`)
    for (const t of b.tasks) task.run({ ...t, tags: JSON.stringify(t.tags), recurrenceRule: t.recurrenceRule ? JSON.stringify(t.recurrenceRule) : null, updatedAt: t.updatedAt || t.createdAt, deleteBatchId: t.deleteBatchId ?? null })
    const completion = db.prepare('INSERT INTO task_completions (task_id, completed_at) VALUES (?, ?)')
    const inserted = new Set<string>()
    for (const c of b.taskCompletions ?? []) {
      completion.run(c.taskId, c.completedAt)
      inserted.add(`${c.taskId}|${c.completedAt}`)
    }
    for (const t of b.tasks) {
      if (t.status === 'done' && t.completedAt && !inserted.has(`${t.id}|${t.completedAt}`)) {
        completion.run(t.id, t.completedAt)
      }
    }
    const subtask = db.prepare('INSERT INTO task_subtasks (id, task_id, title, done, sort_order) VALUES (@id, @taskId, @title, @done, @sortOrder)')
    for (const s of b.taskSubtasks) subtask.run({ ...s, done: s.done ? 1 : 0 })

    // Phase 0 tables. Optional lists (files from before Phase 0) read as empty.
    const link = db.prepare(`INSERT INTO links (id, source_type, source_id, target_type, target_id, relation, created_at, deleted_at)
      VALUES (@id, @sourceType, @sourceId, @targetType, @targetId, @relation, @createdAt, @deletedAt)`)
    for (const l of b.links ?? []) link.run(l)
    const tag = db.prepare('INSERT INTO tags (id, name, colour, created_at, updated_at) VALUES (@id, @name, @colour, @createdAt, @updatedAt)')
    for (const t of b.tags ?? []) {
      tag.run({
        ...t, colour: t.colour ?? null, createdAt: t.createdAt ?? t.updatedAt, updatedAt: t.updatedAt ?? t.createdAt,
        deletedAt: t.deletedAt ?? null, deleteBatchId: t.deleteBatchId ?? null
      })
    }
    const tagging = db.prepare(`INSERT INTO taggings (id, tag_id, entity_type, entity_id, created_at, updated_at)
      VALUES (@id, @tagId, @entityType, @entityId, @createdAt, @updatedAt)`)
    for (const t of b.taggings ?? []) tagging.run(t)
    const template = db.prepare(`INSERT INTO templates (id, kind, name, payload, is_builtin, created_at, updated_at)
      VALUES (@id, @kind, @name, @payload, @isBuiltin, @createdAt, @updatedAt)`)
    for (const t of b.templates ?? []) template.run({ ...t, isBuiltin: t.isBuiltin ? 1 : 0, payload: JSON.stringify(t.payload) })

    // Calculator tables (calc_*). Only restored if present in the backup.
    // Inserted in FK-safe order: rateSets before rates and rateOverrides.
    if (b.calculator) {
      const calc = b.calculator
      const historyStmt = db.prepare(`INSERT INTO calc_history (id, created_at, mode, input, result, result_format, rate_snapshot, pinned)
        VALUES (@id, @createdAt, @mode, @input, @result, @resultFormat, @rateSnapshot, @pinned)`)
      for (const h of calc.history ?? []) {
        historyStmt.run({ ...h, pinned: h.pinned ? 1 : 0 })
      }

      const varStmt = db.prepare(`INSERT INTO calc_variables (name, value, updated_at)
        VALUES (@name, @value, @updatedAt)`)
      for (const v of calc.variables ?? []) {
        varStmt.run(v)
      }

      const progStmt = db.prepare(`INSERT INTO calc_programs (id, name, source, created_at, updated_at)
        VALUES (@id, @name, @source, @createdAt, @updatedAt)`)
      for (const p of calc.programs ?? []) {
        progStmt.run(p)
      }

      const rateSetStmt = db.prepare(`INSERT INTO calc_rate_sets (id, name, base_currency, is_active, updated_at)
        VALUES (@id, @name, @baseCurrency, @isActive, @updatedAt)`)
      for (const rs of calc.rateSets ?? []) {
        rateSetStmt.run({ ...rs, isActive: rs.isActive ? 1 : 0 })
      }

      const rateStmt = db.prepare(`INSERT INTO calc_rates (id, rate_set_id, currency_code, name, rate_to_base, note, updated_at)
        VALUES (@id, @rateSetId, @currencyCode, @name, @rateToBase, @note, @updatedAt)`)
      for (const r of calc.rates ?? []) {
        rateStmt.run(r)
      }

      const overrideStmt = db.prepare(`INSERT INTO calc_rate_overrides (id, rate_set_id, from_code, to_code, rate, updated_at)
        VALUES (@id, @rateSetId, @fromCode, @toCode, @rate, @updatedAt)`)
      for (const ro of calc.rateOverrides ?? []) {
        overrideStmt.run(ro)
      }

      const settingStmt = db.prepare(`INSERT INTO calc_settings (key, value)
        VALUES (@key, @value)`)
      for (const s of calc.settings ?? []) {
        settingStmt.run(s)
      }
    }
  })()
  // The search index is derived: the restore rebuilds it from the live rows.
  rebuildSearchIndex(db)
  return countsOf(b)
}
