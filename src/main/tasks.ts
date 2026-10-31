// Task database queries; the renderer accesses these only through the preload API.

/*
 * RECURRING TASKS �� the contract this file implements:
 *
 * - One row per task owns the recurrence rule (`recurrenceRule`) and the next due
 *   date (`recurrenceNext`). Instances are resolved at read time by resolveOccurrences
 *   (src/shared/tasks.ts); no child rows are ever created.
 * - Completing a recurring task marks it done. On the next read, resolveOccurrences
 *   advances recurrenceNext to the following date and returns the task to 'todo',
 *   so the series continues without copying rows.
 * - Soft delete: deleting a task sets deletedAt instead of removing the row. Deleted
 *   tasks are excluded from every view. restore/clearTrash manage the trash.
 * - Manual sort position: `position` (a float) replaces sort_order. Moving one card
 *   never touches its neighbours �� only the moved row's position changes.
 */

import type Database from 'better-sqlite3'
import { filterTasks, nextTaskDate, resolveOccurrences, TASK_FIELD_ORDER, taskInputProblems } from '../shared/tasks'
import { cleanTags, localDate } from './util'
import { emitAutomation } from './automations'
import type { Task, TaskInput, TaskStatus } from '../shared/types'

interface TaskRow extends TaskRowBase {
  due_date: string | null
  due_time: string | null
  created_at: string
  completed_at: string | null
  deleted_at: string | null
  project: string | null
  tags: string
  position: number
  recurrence_rule: string | null
  recurrence_next: string | null
}
interface SubtaskRow { id: number; task_id: number; title: string; done: number; sort_order: number }

interface TaskRowBase {
  id: number; title: string; notes: string; status: TaskStatus; priority: Task['priority']
}

function parseTags(value: string | null): string[] {
  if (!value) return []
  try {
    const parsed = JSON.parse(value) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed.filter((item): item is string => typeof item === 'string').map((item) => item.trim()).filter(Boolean)
  } catch {
    return []
  }
}

function parseRecurrenceRule(value: string | null): Task['recurrenceRule'] {
  if (!value) return null
  try {
    const parsed = JSON.parse(value) as Partial<NonNullable<Task['recurrenceRule']>>
    if (!parsed || typeof parsed !== 'object') return null
    const frequency = parsed.frequency
    const intervalDays = parsed.intervalDays
    if (!['daily', 'weekly', 'monthly', 'custom'].includes(frequency ?? '') || !Number.isInteger(intervalDays) || intervalDays! < 1) return null
    return { frequency: frequency as NonNullable<Task['recurrenceRule']>['frequency'], intervalDays: intervalDays! }
  } catch {
    return null
  }
}

const toTask = (r: TaskRow, subtasks: SubtaskRow[]): Task => ({
  id: r.id, title: r.title, notes: r.notes, status: r.status, priority: r.priority,
  dueDate: r.due_date, dueTime: r.due_time,
  createdAt: r.created_at, completedAt: r.completed_at, deletedAt: r.deleted_at,
  project: r.project, tags: parseTags(r.tags), position: r.position,
  recurrenceRule: parseRecurrenceRule(r.recurrence_rule), recurrenceNext: r.recurrence_next,
  subtasks: subtasks.filter((s) => s.task_id === r.id).map((s) => ({ id: s.id, taskId: s.task_id, title: s.title, done: s.done === 1, sortOrder: s.sort_order }))
})

export function listTasks(db: Database.Database, today: string = localDate()): Task[] {
  const rows = db.prepare("SELECT * FROM tasks WHERE deleted_at IS NULL ORDER BY position, due_date IS NULL, due_date, id").all() as TaskRow[]
  const subtasks = db.prepare('SELECT * FROM task_subtasks ORDER BY sort_order, id').all() as SubtaskRow[]
  const tasks = rows.map((row) => toTask(row, subtasks))
  return resolveOccurrences(tasks, today)
}

export function listFilteredTasks(db: Database.Database, filter: Parameters<typeof filterTasks>[1], today: string = localDate()): Task[] {
  return filterTasks(listTasks(db, today), filter, today)
}

export function listDeletedTasks(db: Database.Database): Task[] {
  const rows = db.prepare("SELECT * FROM tasks WHERE deleted_at IS NOT NULL ORDER BY deleted_at DESC, id").all() as TaskRow[]
  const subtasks = db.prepare('SELECT * FROM task_subtasks ORDER BY sort_order, id').all() as SubtaskRow[]
  return rows.map((row) => toTask(row, subtasks))
}

function normalize(input: TaskInput) {
  const problems = taskInputProblems(input)
  const firstProblem = TASK_FIELD_ORDER.find((field) => problems[field])
  if (firstProblem) throw new Error(problems[firstProblem]!)
  const title = input.title.trim()
  const subtasks = input.subtasks.map((s) => ({ title: s.title.trim(), done: Boolean(s.done) })).filter((s) => s.title)
  return {
    title, notes: input.notes, status: input.status, priority: input.priority, dueDate: input.dueDate,
    dueTime: input.dueTime ?? null, project: input.project?.trim() || null, tags: cleanTags(input.tags), position: 0, subtasks,
    recurrenceRule: input.recurrenceRule, recurrenceNext: input.recurrenceNext ?? null
  }
}

function nextPosition(db: Database.Database, status: TaskStatus): number {
  const row = db.prepare("SELECT COALESCE(MAX(position), -1) + 1 AS n FROM tasks WHERE status = ? AND deleted_at IS NULL").get(status) as { n: number }
  return row.n
}

function getTask(db: Database.Database, id: number): Task {
  const row = db.prepare('SELECT * FROM tasks WHERE id = ?').get(id) as TaskRow | undefined
  if (!row) throw new Error('Task not found')
  const subtasks = db.prepare('SELECT * FROM task_subtasks WHERE task_id = ? ORDER BY sort_order, id').all(id) as SubtaskRow[]
  return toTask(row, subtasks)
}

function replaceSubtasks(db: Database.Database, taskId: number, values: { title: string; done: boolean }[]): void {
  db.prepare('DELETE FROM task_subtasks WHERE task_id = ?').run(taskId)
  const insert = db.prepare('INSERT INTO task_subtasks (task_id, title, done, sort_order) VALUES (?, ?, ?, ?)')
  values.forEach((item, index) => insert.run(taskId, item.title, item.done ? 1 : 0, index))
}

export function createTask(db: Database.Database, input: TaskInput): Task {
  const task = normalize(input)
  const now = new Date().toISOString()
  const position = nextPosition(db, task.status)
  const run = db.transaction(() => {
    const result = db.prepare(`INSERT INTO tasks
      (title, notes, status, priority, due_date, due_time, created_at, completed_at, deleted_at, project, tags, position, recurrence_rule, recurrence_next)
      VALUES (@title, @notes, @status, @priority, @dueDate, @dueTime, @createdAt, @completedAt, NULL, @project, @tags, @position, @recurrenceRule, @recurrenceNext)`)
      .run({ ...task, dueDate: task.dueDate, dueTime: task.dueTime, createdAt: now, completedAt: task.status === 'done' ? now : null,
        tags: JSON.stringify(task.tags), position, recurrenceRule: task.recurrenceRule ? JSON.stringify(task.recurrenceRule) : null,
        recurrenceNext: task.recurrenceNext })
    const id = Number(result.lastInsertRowid)
    replaceSubtasks(db, id, task.subtasks)
    return id
  })
  return getTask(db, run())
}

export function updateTask(db: Database.Database, id: number, input: TaskInput): Task {
  const task = normalize(input)
  const previous = db.prepare('SELECT status, completed_at, deleted_at, position FROM tasks WHERE id = ?').get(id) as { status: TaskStatus; completed_at: string | null; deleted_at: string | null; position: number } | undefined
  if (!previous) throw new Error('Task not found')
  if (previous.deleted_at !== null) throw new Error('Task is deleted')
  const now = new Date().toISOString()
  db.transaction(() => {
    db.prepare(`UPDATE tasks SET title=@title, notes=@notes, status=@status, priority=@priority, due_date=@dueDate,
      due_time=@dueTime, project=@project, tags=@tags, position=@position, recurrence_rule=@recurrenceRule, recurrence_next=@recurrenceNext,
      completed_at=@completedAt WHERE id=@id`)
      .run({ ...task, id, dueTime: task.dueTime, tags: JSON.stringify(task.tags), position: previous.position ?? task.position,
        recurrenceRule: task.recurrenceRule ? JSON.stringify(task.recurrenceRule) : null,
        recurrenceNext: task.recurrenceNext,
        completedAt: task.status === 'done' ? (previous.status === 'done' ? previous.completed_at : now) : null })
    replaceSubtasks(db, id, task.subtasks)
  })()
  return getTask(db, id)
}

export function softDeleteTask(db: Database.Database, id: number): void {
  const row = db.prepare('SELECT deleted_at FROM tasks WHERE id = ?').get(id) as { deleted_at: string | null } | undefined
  if (!row) throw new Error('Task not found')
  if (row.deleted_at !== null) return // already deleted
  const now = new Date().toISOString()
  db.prepare('UPDATE tasks SET deleted_at = ? WHERE id = ?').run(now, id)
}

export function restoreTask(db: Database.Database, id: number): void {
  const row = db.prepare('SELECT deleted_at FROM tasks WHERE id = ?').get(id) as { deleted_at: string | null } | undefined
  if (!row) throw new Error('Task not found')
  if (row.deleted_at === null) return // not deleted
  db.prepare('UPDATE tasks SET deleted_at = NULL WHERE id = ?').run(id)
}

export function clearTrash(db: Database.Database): void {
  db.prepare('DELETE FROM tasks WHERE deleted_at IS NOT NULL').run()
}

export function deleteTask(db: Database.Database, id: number): void {
  softDeleteTask(db, id)
}

export function deleteTasks(db: Database.Database, ids: number[]): void {
  checkTaskIds(ids)
  db.transaction(() => ids.forEach((id) => softDeleteTask(db, id)))()
}

export function reorderPosition(db: Database.Database, id: number, newPosition: number): void {
  const row = db.prepare('SELECT id, position FROM tasks WHERE deleted_at IS NULL ORDER BY position').all() as { id: number; position: number }[]
  // Move the target to newPosition, shifting others as needed.
  const target = row.find((r) => r.id === id)
  if (!target) throw new Error('Task not found')
  const ordered = row.filter((r) => r.id !== id)
  ordered.splice(Math.min(Math.max(newPosition, 0), ordered.length), 0, target)
  const update = db.prepare('UPDATE tasks SET position = ? WHERE id = ?')
  db.transaction(() => ordered.forEach((r, index) => update.run(index, r.id)))()
}

export function reorderTasks(db: Database.Database, ids: number[]): void {
  const update = db.prepare('UPDATE tasks SET position = ? WHERE id = ?')
  db.transaction(() => ids.forEach((id, index) => update.run(index, id)))()
}

function checkTaskIds(ids: number[]): void {
  if (!Array.isArray(ids) || ids.length === 0 || ids.some((id) => !Number.isInteger(id) || id <= 0)) throw new Error('Choose one or more tasks')
}

export function setTasksStatus(db: Database.Database, ids: number[], status: TaskStatus): void {
  checkTaskIds(ids)
  if (!['todo', 'in-progress', 'done'].includes(status)) throw new Error('Choose a valid task status')
  db.transaction(() => ids.forEach((id) => setTaskStatus(db, id, status)))()
}

export function setTaskStatus(db: Database.Database, id: number, status: TaskStatus): Task {
  if (!['todo', 'in-progress', 'done'].includes(status)) throw new Error('Choose a valid task status')
  const task = getTask(db, id)
  if (task.deletedAt !== null) throw new Error('Task is deleted')
  if (status !== 'done' || task.status === 'done') {
    db.prepare('UPDATE tasks SET status = ?, completed_at = ? WHERE id = ?').run(status, status === 'done' ? task.completedAt : null, id)
    const updated = getTask(db, id)
    if (status === 'done' && task.status !== 'done') {
      void emitAutomation(db, 'task-completed', `task:${id}`, { taskId: id })
    }
    return updated
  }
  const now = new Date().toISOString()
  db.transaction(() => {
    db.prepare("UPDATE tasks SET status = 'done', completed_at = ?, recurrence_next = ? WHERE id = ?")
      .run(now, nextTaskDate(task.recurrenceNext ?? task.dueDate ?? '', task.recurrenceRule), id)
  })()
  void emitAutomation(db, 'task-completed', `task:${id}`, { taskId: id })
  return getTask(db, id)
}

