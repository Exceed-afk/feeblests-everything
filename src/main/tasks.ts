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
import { filterTasks, localTaskDay, nextTaskDate, nextTaskDateAfter, resolveOccurrences, TASK_FIELD_ORDER, taskInputProblems } from '../shared/tasks'
import { cleanTags, localDate } from './util'
import { emitAutomation } from './automations'
import type { Task, TaskCompletion, TaskInput, TaskStatus } from '../shared/types'

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

export function overdueTasks(db: Database.Database, today: string): { id: number; title: string; daysOverdue: number }[] {
  return listTasks(db, today)
    .filter((task) => task.status !== 'done' && task.dueDate !== null && task.dueDate < today)
    .map((task) => ({
      id: task.id,
      title: task.title,
      daysOverdue: Math.round((Date.parse(today) - Date.parse(task.dueDate as string)) / 86_400_000)
    }))
}

export function listCompletedTasks(db: Database.Database, date: string): Task[] {
  const rows = db.prepare(`SELECT t.*, c.completed_at AS occurrence_completed_at
    FROM task_completions c JOIN tasks t ON t.id = c.task_id
    WHERE t.deleted_at IS NULL
    ORDER BY c.completed_at DESC, c.id DESC`).all() as (TaskRow & { occurrence_completed_at: string })[]
  const completions = rows.filter((row) => localTaskDay(row.occurrence_completed_at) === date)
  const subtasks = db.prepare('SELECT * FROM task_subtasks ORDER BY sort_order, id').all() as SubtaskRow[]
  return completions.map((row) => toTask({
    ...row, status: 'done', completed_at: row.occurrence_completed_at
  }, subtasks))
}

export function listCompletions(db: Database.Database, range: { from: string; to: string }): TaskCompletion[] {
  const rows = db.prepare(`SELECT c.task_id, c.completed_at
    FROM task_completions c JOIN tasks t ON t.id = c.task_id
    WHERE t.deleted_at IS NULL
    ORDER BY c.completed_at, c.id`).all() as { task_id: number; completed_at: string }[]
  return rows.flatMap((row) => {
    const date = localTaskDay(row.completed_at)
    return date !== null && date >= range.from && date <= range.to
      ? [{ taskId: row.task_id, completedAt: row.completed_at }]
      : []
  })
}

export function listFilteredTasks(db: Database.Database, filter: Parameters<typeof filterTasks>[1], today: string = localDate(), nowTime: string = localTime()): Task[] {
  const source = filter.view === 'trash' ? listDeletedTasks(db) : listTasks(db, today)
  return filterTasks(source, filter, today, nowTime)
}

function localTime(date: Date = new Date()): string {
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
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
    if (task.status === 'done') {
      db.prepare('INSERT INTO task_completions (task_id, completed_at) VALUES (?, ?)').run(id, now)
    }
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
    if (task.status === 'done' && previous.status !== 'done') {
      db.prepare('INSERT INTO task_completions (task_id, completed_at) VALUES (?, ?)').run(id, now)
    }
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

export function deleteTaskForever(db: Database.Database, id: number): void {
  const result = db.prepare('DELETE FROM tasks WHERE id = ? AND deleted_at IS NOT NULL').run(id)
  if (result.changes === 0) throw new Error('Task is not in Trash')
}

export function clearTrash(db: Database.Database): void {
  db.transaction(() => db.prepare('DELETE FROM tasks WHERE deleted_at IS NOT NULL').run())()
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
  if (!Array.isArray(ids) || ids.some((id) => !Number.isInteger(id) || id <= 0) || new Set(ids).size !== ids.length)
    throw new Error('Choose a valid task order')
  db.transaction(() => {
    const active = (db.prepare('SELECT id FROM tasks WHERE deleted_at IS NULL ORDER BY position, id').all() as { id: number }[]).map((row) => row.id)
    const moving = new Set(ids)
    if (ids.some((id) => !active.includes(id))) throw new Error('A task in this order no longer exists')
    let cursor = 0
    const ordered = active.map((id) => moving.has(id) ? ids[cursor++] : id)
    const update = db.prepare('UPDATE tasks SET position = ? WHERE id = ?')
    ordered.forEach((id, index) => update.run(index, id))
  })()
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
  const raw = getTask(db, id)
  const task = resolveOccurrences([raw], localDate())[0]
  if (task.deletedAt !== null) throw new Error('Task is deleted')
  if (raw.status !== task.status) {
    db.transaction(() => {
      db.prepare('UPDATE tasks SET status = ?, completed_at = NULL WHERE id = ?').run(task.status, id)
      db.prepare('UPDATE task_subtasks SET done = 0 WHERE task_id = ?').run(id)
    })()
  }
  if (status !== 'done' || task.status === 'done') {
    db.prepare('UPDATE tasks SET status = ?, completed_at = ? WHERE id = ?').run(status, status === 'done' ? task.completedAt : null, id)
    const updated = getTask(db, id)
    if (status === 'done' && task.status !== 'done') {
      emitAutomation(db, 'task-completed', `task:${id}`, { taskId: id })
    }
    return updated
  }
  const now = new Date().toISOString()
  const today = localDate()
  const anchor = task.dueDate ?? task.recurrenceNext ?? today
  const next = nextTaskDateAfter(task.recurrenceNext ?? task.dueDate ?? today, task.recurrenceRule, anchor, today)
  db.transaction(() => {
    db.prepare("UPDATE tasks SET status = 'done', completed_at = ?, recurrence_next = ? WHERE id = ?")
      .run(now, next, id)
    db.prepare('INSERT INTO task_completions (task_id, completed_at) VALUES (?, ?)').run(id, now)
  })()
  emitAutomation(db, 'task-completed', `task:${id}`, { taskId: id })
  return getTask(db, id)
}

export function undoTaskStatus(db: Database.Database, id: number, status: TaskStatus, completedAt: string | null, recurrenceNext: string | null): void {
  if (!['todo', 'in-progress', 'done'].includes(status)) throw new Error('Choose a valid task status')
  db.transaction(() => {
    const current = db.prepare('SELECT status, completed_at FROM tasks WHERE id = ? AND deleted_at IS NULL').get(id) as { status: TaskStatus; completed_at: string | null } | undefined
    if (!current) throw new Error('Task not found')
    if (current.status === 'done' && status !== 'done' && current.completed_at !== null) {
      db.prepare('DELETE FROM task_completions WHERE task_id = ? AND completed_at = ?').run(id, current.completed_at)
    }
    db.prepare('UPDATE tasks SET status = ?, completed_at = ?, recurrence_next = ? WHERE id = ?')
      .run(status, completedAt, recurrenceNext, id)
  })()
}

export function rescheduleTasks(db: Database.Database, ids: number[], dueDate: string, dueTime: string | null = null): void {
  checkTaskIds(ids)
  const check = taskInputProblems({
    title: 'Task', notes: '', status: 'todo', priority: 'medium', dueDate, dueTime,
    project: null, tags: [], recurrenceRule: null, recurrenceNext: null, subtasks: []
  })
  if (check.dueDate) throw new Error(check.dueDate)
  if (check.dueTime) throw new Error(check.dueTime)
  db.transaction(() => {
    const updateOneOff = db.prepare('UPDATE tasks SET due_date = ?, due_time = ? WHERE id = ? AND deleted_at IS NULL')
    const updateRecurring = db.prepare('UPDATE tasks SET recurrence_next = ?, due_time = ? WHERE id = ? AND deleted_at IS NULL')
    for (const id of ids) {
      const task = db.prepare('SELECT recurrence_rule FROM tasks WHERE id = ? AND deleted_at IS NULL').get(id) as { recurrence_rule: string | null } | undefined
      if (!task) throw new Error('A selected task no longer exists')
      const result = task.recurrence_rule
        ? updateRecurring.run(dueDate, dueTime, id)
        : updateOneOff.run(dueDate, dueTime, id)
      if (result.changes === 0) throw new Error('A selected task no longer exists')
    }
  })()
}

export function setSubtaskDone(db: Database.Database, taskId: number, subtaskId: number, done: boolean): void {
  const result = db.prepare('UPDATE task_subtasks SET done = ? WHERE id = ? AND task_id = ?')
    .run(done ? 1 : 0, subtaskId, taskId)
  if (result.changes === 0) throw new Error('Checklist item not found')
}

export function reorderSubtasks(db: Database.Database, taskId: number, ids: number[]): void {
  const current = (db.prepare('SELECT id FROM task_subtasks WHERE task_id = ? ORDER BY sort_order, id').all(taskId) as { id: number }[]).map((row) => row.id)
  if (ids.length !== current.length || new Set(ids).size !== ids.length || ids.some((id) => !current.includes(id)))
    throw new Error('Choose a valid checklist order')
  const update = db.prepare('UPDATE task_subtasks SET sort_order = ? WHERE id = ? AND task_id = ?')
  db.transaction(() => ids.forEach((id, index) => update.run(index, id, taskId)))()
}

export function promoteSubtask(db: Database.Database, taskId: number, subtaskId: number): Task {
  return db.transaction(() => {
    const row = db.prepare('SELECT title FROM task_subtasks WHERE id = ? AND task_id = ?').get(subtaskId, taskId) as { title: string } | undefined
    if (!row) throw new Error('Checklist item not found')
    const created = createTask(db, {
      title: row.title, notes: '', status: 'todo', priority: 'medium', dueDate: null, dueTime: null,
      project: null, tags: [], recurrenceRule: null, recurrenceNext: null, subtasks: []
    })
    db.prepare('DELETE FROM task_subtasks WHERE id = ? AND task_id = ?').run(subtaskId, taskId)
    return created
  })()
}

export function skipTaskOccurrence(db: Database.Database, id: number, today: string): Task {
  const task = getTask(db, id)
  if (task.deletedAt !== null) throw new Error('Task is deleted')
  if (!task.recurrenceRule) throw new Error('This task does not repeat')
  const next = nextTaskDate(task.recurrenceNext ?? task.dueDate ?? today, task.recurrenceRule, task.dueDate ?? today)
  db.transaction(() => {
    db.prepare("UPDATE tasks SET status = 'todo', completed_at = NULL, recurrence_next = ? WHERE id = ?").run(next, id)
    db.prepare('UPDATE task_subtasks SET done = 0 WHERE task_id = ?').run(id)
  })()
  return getTask(db, id)
}
