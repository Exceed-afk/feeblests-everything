// Export / import. Reads and writes the database only; the file dialogs live
// in index.ts. The file format and its checks are in src/shared/backup.ts.
import type Database from 'better-sqlite3'
import { countsOf, BACKUP_APP, BACKUP_FORMAT, type BackupFile } from '../shared/backup'
import type { BackupCounts } from '../shared/types'
import { MIGRATIONS } from './migrations'

interface R { [k: string]: any } // raw database rows

// Everything the app stores, as one object.
export function collectBackup(db: Database.Database): BackupFile {
  const settings = Object.fromEntries(
    (db.prepare('SELECT key, value FROM settings ORDER BY key').all() as { key: string; value: string }[])
      // The assistant's encrypted key blob stays out of backups: a backup file should
      // never carry credential material, even encrypted. The user re-pastes the key
      // after a restore (see src/main/assistant.ts).
      .filter((r) => r.key !== 'assistantKeyBlob')
      .map((r) => [r.key, JSON.parse(r.value)])
  )
  return {
    app: BACKUP_APP, format: BACKUP_FORMAT, schemaVersion: MIGRATIONS.length, exportedAt: new Date().toISOString(), settings,
    logbook: (db.prepare('SELECT * FROM logbook_entries ORDER BY id').all() as R[]).map((r) => ({
      id: r.id, date: r.date, title: r.title, body: r.body, mood: r.mood, tags: JSON.parse(r.tags),
      createdAt: r.created_at, updatedAt: r.updated_at
    })),
    trades: (db.prepare('SELECT * FROM trades ORDER BY id').all() as R[]).map((r) => ({
      id: r.id, date: r.date, asset: r.asset, direction: r.direction, entryPrice: r.entry_price, exitPrice: r.exit_price,
      quantity: r.quantity, fees: r.fees, notes: r.notes, tags: JSON.parse(r.tags), createdAt: r.created_at, updatedAt: r.updated_at
    })),
    savingsGoals: (db.prepare('SELECT * FROM savings_goals ORDER BY id').all() as R[]).map((r) => ({
      id: r.id, name: r.name, target: r.target, notes: r.notes, createdAt: r.created_at, updatedAt: r.updated_at
    })),
    savingsTransactions: (db.prepare('SELECT * FROM savings_transactions ORDER BY id').all() as R[]).map((r) => ({
      id: r.id, goalId: r.goal_id, date: r.date, kind: r.kind, amount: r.amount, note: r.note,
      createdAt: r.created_at, updatedAt: r.updated_at
    })),
    habits: (db.prepare('SELECT * FROM habits ORDER BY id').all() as R[]).map((r) => ({
      id: r.id, name: r.name, notes: r.notes, days: JSON.parse(r.days), archived: r.archived === 1, startDate: r.start_date,
      createdAt: r.created_at, updatedAt: r.updated_at
    })),
    habitCheckins: (db.prepare('SELECT * FROM habit_checkins ORDER BY habit_id, date').all() as R[]).map((r) => ({
      habitId: r.habit_id, date: r.date, createdAt: r.created_at
    })),
    tasks: (db.prepare('SELECT * FROM tasks ORDER BY id').all() as R[]).map((r) => ({
      id: r.id, title: r.title, notes: r.notes, status: r.status, priority: r.priority, dueDate: r.due_date,
      dueTime: r.due_time, createdAt: r.created_at, completedAt: r.completed_at, deletedAt: r.deleted_at,
      project: r.project, tags: JSON.parse(r.tags), position: r.position,
      recurrenceRule: r.recurrence_rule ? JSON.parse(r.recurrence_rule) : null, recurrenceNext: r.recurrence_next
    })),
    taskSubtasks: (db.prepare('SELECT * FROM task_subtasks ORDER BY task_id, sort_order, id').all() as R[]).map((r) => ({
      id: r.id, taskId: r.task_id, title: r.title, done: r.done === 1, sortOrder: r.sort_order
    }))
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
    // Goals first on the way in, last on the way out (foreign key).
    for (const t of ['task_subtasks', 'tasks', 'habit_checkins', 'habits', 'savings_transactions', 'savings_goals', 'trades', 'logbook_entries', 'automation_events', 'settings']) db.exec(`DELETE FROM ${t}`)

    const setting = db.prepare('INSERT INTO settings (key, value) VALUES (?, ?)')
    for (const [k, v] of Object.entries(b.settings)) setting.run(k, JSON.stringify(v))

    const entry = db.prepare(`INSERT INTO logbook_entries (id, date, title, body, mood, tags, created_at, updated_at)
      VALUES (@id, @date, @title, @body, @mood, @tags, @createdAt, @updatedAt)`)
    for (const e of b.logbook) entry.run({ ...e, tags: JSON.stringify(e.tags) })

    const trade = db.prepare(`INSERT INTO trades (id, date, asset, direction, entry_price, exit_price, quantity, fees, notes, tags, created_at, updated_at)
      VALUES (@id, @date, @asset, @direction, @entryPrice, @exitPrice, @quantity, @fees, @notes, @tags, @createdAt, @updatedAt)`)
    for (const t of b.trades) trade.run({ ...t, tags: JSON.stringify(t.tags) })

    const goal = db.prepare(`INSERT INTO savings_goals (id, name, target, notes, created_at, updated_at)
      VALUES (@id, @name, @target, @notes, @createdAt, @updatedAt)`)
    for (const g of b.savingsGoals) goal.run(g)

    const tx = db.prepare(`INSERT INTO savings_transactions (id, goal_id, date, kind, amount, note, created_at, updated_at)
      VALUES (@id, @goalId, @date, @kind, @amount, @note, @createdAt, @updatedAt)`)
    for (const t of b.savingsTransactions) tx.run(t)

    const habit = db.prepare(`INSERT INTO habits (id, name, notes, days, archived, start_date, created_at, updated_at)
      VALUES (@id, @name, @notes, @days, @archived, @startDate, @createdAt, @updatedAt)`)
    for (const h of b.habits) habit.run({ ...h, days: JSON.stringify(h.days), archived: h.archived ? 1 : 0 })

    const checkin = db.prepare('INSERT INTO habit_checkins (habit_id, date, created_at) VALUES (@habitId, @date, @createdAt)')
    for (const c of b.habitCheckins) checkin.run(c)

    const task = db.prepare(`INSERT INTO tasks (id, title, notes, status, priority, due_date, due_time, created_at, completed_at, deleted_at, project, tags, position, recurrence_rule, recurrence_next)
      VALUES (@id, @title, @notes, @status, @priority, @dueDate, @dueTime, @createdAt, @completedAt, @deletedAt, @project, @tags, @position, @recurrenceRule, @recurrenceNext)`)
    for (const t of b.tasks) task.run({ ...t, tags: JSON.stringify(t.tags), recurrenceRule: t.recurrenceRule ? JSON.stringify(t.recurrenceRule) : null })
    const subtask = db.prepare('INSERT INTO task_subtasks (id, task_id, title, done, sort_order) VALUES (@id, @taskId, @title, @done, @sortOrder)')
    for (const s of b.taskSubtasks) subtask.run({ ...s, done: s.done ? 1 : 0 })
  })()
  return countsOf(b)
}
