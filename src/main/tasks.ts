// Task database queries; the renderer accesses these only through the preload API.

/*
 * RECURRING TASKS — the contract this file implements (mirrored in README.md
 * under "Recurring tasks", confirmed with the maintainer so nothing here is a guess).
 *
 * - Rule source: the row being completed. A child occurrence copies its parent's whole
 *   `recurrence` rule ({ frequency, intervalDays }) when it is created and keeps that copy;
 *   nothing ever re-reads the parent to decide a later date.
 * - Creation: completing a row (setTaskStatus to 'done', or updateTask moving a not-done row
 *   to 'done') creates ONE child occurrence in the same transaction — same title, notes,
 *   priority, project, tags and subtasks (subtasks reset to unchecked) — dated the completed
 *   row's due date advanced by one interval, or today's local date when it has no due date:
 *   daily +1 day, weekly +7, monthly +1 month (clamped to month end), custom +N days.
 * - One child, ever: a row never gains a second child. Completing again in ANY way (double
 *   click, repeated setStatus calls, done -> undone -> done, the edit form, bulk status) creates
 *   nothing. Enforced twice in the data layer: createRecurringOccurrence returns early if a
 *   child of this row already exists, inside the same transaction as the completion, and
 *   migration 7 adds a UNIQUE index on parent_task_id so a second link is impossible at the
 *   schema level too (an import or a stray write fails loudly instead of duplicating).
 * - Chains: a child is an ordinary row and may do exactly what any row may do: when completed,
 *   if it has no child yet, it spawns exactly one successor from its own copied rule. So a
 *   series is a straight line — one row per completion — never a fork, and it advances only
 *   at the moment an occurrence is completed. Nothing is generated in the background or ahead
 *   of time.
 * - End conditions: none exist. TaskRecurrence holds no end date and no occurrence count, so
 *   a series runs as long as its occurrences keep being completed. Adding those limits would
 *   be a schema + UI change and is deliberately outside this contract today.
 * - Editing: an edit touches the row itself and rows created later, nothing else. A child that
 *   already exists keeps every field it was created with (title, notes, tags, rule, due date);
 *   editing or un-recurring a parent that already spawned changes no future occurrence,
 *   because that parent can never spawn again while its child lives.
 * - Deleting: deleting a parent unlinks the child (parent_task_id -> NULL via the FK) and
 *   keeps it, so the series continues independently on the child's copied rule; subtasks
 *   cascade with their task.
 */

import type Database from 'better-sqlite3'
import { filterTasks, nextTaskDate, TASK_FIELD_ORDER, taskInputProblems } from '../shared/tasks'
import { cleanTags, localDate } from './util'
import { emitAutomation } from './automations'
import type { Task, TaskInput, TaskStatus } from '../shared/types'

interface TaskRow extends TaskRowBase {
  due_date: string | null
  created_at: string
  completed_at: string | null
  project: string | null
  tags: string
  sort_order: number
  recurrence: string | null
  parent_task_id: number | null
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

function parseRecurrence(value: string | null): Task['recurrence'] {
  if (!value) return null
  try {
    const parsed = JSON.parse(value) as Partial<NonNullable<Task['recurrence']>>
    if (!parsed || typeof parsed !== 'object') return null
    const frequency = parsed.frequency
    const intervalDays = parsed.intervalDays
    if (!['daily', 'weekly', 'monthly', 'custom'].includes(frequency ?? '') || !Number.isInteger(intervalDays) || intervalDays! < 1) return null
    return { frequency: frequency as NonNullable<Task['recurrence']>['frequency'], intervalDays: intervalDays! }
  } catch {
    return null
  }
}

const toTask = (r: TaskRow, subtasks: SubtaskRow[]): Task => ({
  id: r.id, title: r.title, notes: r.notes, status: r.status, priority: r.priority,
  dueDate: r.due_date, createdAt: r.created_at, completedAt: r.completed_at, project: r.project,
  tags: parseTags(r.tags), sortOrder: r.sort_order, recurrence: parseRecurrence(r.recurrence),
  parentTaskId: r.parent_task_id,
  subtasks: subtasks.filter((s) => s.task_id === r.id).map((s) => ({ id: s.id, taskId: s.task_id, title: s.title, done: s.done === 1, sortOrder: s.sort_order }))
})

export function listTasks(db: Database.Database, today: string = localDate()): Task[] {
  const rows = db.prepare('SELECT * FROM tasks ORDER BY status = \'done\', sort_order, due_date IS NULL, due_date, id').all() as TaskRow[]
  const subtasks = db.prepare('SELECT * FROM task_subtasks ORDER BY sort_order, id').all() as SubtaskRow[]
  return rows.map((row) => toTask(row, subtasks))
}

export function listFilteredTasks(db: Database.Database, filter: Parameters<typeof filterTasks>[1], today: string = localDate()): Task[] {
  return filterTasks(listTasks(db, today), filter, today)
}

function normalize(input: TaskInput) {
  const problems = taskInputProblems(input)
  const firstProblem = TASK_FIELD_ORDER.find((field) => problems[field])
  if (firstProblem) throw new Error(problems[firstProblem]!)
  const title = input.title.trim()
  const subtasks = input.subtasks.map((s) => ({ title: s.title.trim(), done: Boolean(s.done) })).filter((s) => s.title)
  return {
    title, notes: input.notes, status: input.status, priority: input.priority, dueDate: input.dueDate,
    project: input.project?.trim() || null, tags: cleanTags(input.tags), subtasks,
    recurrence: input.recurrence, parentTaskId: input.parentTaskId
  }
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

function createRecurringOccurrence(db: Database.Database, task: Task, now: string): void {
  if (!task.recurrence) return
  if (db.prepare('SELECT 1 FROM tasks WHERE parent_task_id = ? LIMIT 1').get(task.id)) return
  const dueDate = nextTaskDate(task.dueDate ?? localDate(), task.recurrence)
  if (!dueDate) return
  const order = (db.prepare("SELECT COALESCE(MAX(sort_order), -1) + 1 AS n FROM tasks WHERE status = 'todo'").get() as { n: number }).n
  const result = db.prepare(`INSERT INTO tasks (title, notes, status, priority, due_date, created_at, completed_at, project, tags, sort_order, recurrence, parent_task_id)
    VALUES (?, ?, 'todo', ?, ?, ?, NULL, ?, ?, ?, ?, ?)`)
    .run(task.title, task.notes, task.priority, dueDate, now, task.project, JSON.stringify(task.tags), order,
      JSON.stringify(task.recurrence), task.id)
  const insert = db.prepare('INSERT INTO task_subtasks (task_id, title, done, sort_order) VALUES (?, ?, 0, ?)')
  task.subtasks.forEach((subtask, index) => insert.run(Number(result.lastInsertRowid), subtask.title, index))
}

export function createTask(db: Database.Database, input: TaskInput): Task {
  const task = normalize(input)
  const now = new Date().toISOString()
  const order = (db.prepare('SELECT COALESCE(MAX(sort_order), -1) + 1 AS n FROM tasks WHERE status = ?').get(task.status) as { n: number }).n
  const run = db.transaction(() => {
    const result = db.prepare(`INSERT INTO tasks
      (title, notes, status, priority, due_date, created_at, completed_at, project, tags, sort_order, recurrence, parent_task_id)
      VALUES (@title, @notes, @status, @priority, @dueDate, @createdAt, @completedAt, @project, @tags, @sortOrder, @recurrence, @parentTaskId)`)
      .run({ ...task, dueDate: task.dueDate, createdAt: now, completedAt: task.status === 'done' ? now : null,
        tags: JSON.stringify(task.tags), sortOrder: order, recurrence: task.recurrence ? JSON.stringify(task.recurrence) : null })
    const id = Number(result.lastInsertRowid)
    replaceSubtasks(db, id, task.subtasks)
    return id
  })
  return getTask(db, run())
}

export function updateTask(db: Database.Database, id: number, input: TaskInput): Task {
  const task = normalize(input)
  const previous = db.prepare('SELECT status, completed_at FROM tasks WHERE id = ?').get(id) as { status: TaskStatus; completed_at: string | null } | undefined
  if (!previous) throw new Error('Task not found')
  const now = new Date().toISOString()
  db.transaction(() => {
    db.prepare(`UPDATE tasks SET title=@title, notes=@notes, status=@status, priority=@priority, due_date=@dueDate,
      project=@project, tags=@tags, recurrence=@recurrence, parent_task_id=@parentTaskId,
      completed_at=@completedAt WHERE id=@id`)
      .run({ ...task, id, tags: JSON.stringify(task.tags), recurrence: task.recurrence ? JSON.stringify(task.recurrence) : null,
        completedAt: task.status === 'done' ? (previous.status === 'done' ? previous.completed_at : now) : null })
    replaceSubtasks(db, id, task.subtasks)
    if (previous.status !== 'done' && task.status === 'done') {
      createRecurringOccurrence(db, {
        ...task, id, createdAt: '', completedAt: now, sortOrder: 0,
        subtasks: task.subtasks.map((subtask, index) => ({ ...subtask, id: 0, taskId: id, sortOrder: index }))
      }, now)
    }
  })()
  return getTask(db, id)
}

export function deleteTask(db: Database.Database, id: number): void {
  db.prepare('DELETE FROM tasks WHERE id = ?').run(id)
}

export function reorderTasks(db: Database.Database, ids: number[]): void {
  const update = db.prepare('UPDATE tasks SET sort_order = ? WHERE id = ?')
  db.transaction(() => ids.forEach((id, order) => update.run(order, id)))()
}

function checkTaskIds(ids: number[]): void {
  if (!Array.isArray(ids) || ids.length === 0 || ids.some((id) => !Number.isInteger(id) || id <= 0)) throw new Error('Choose one or more tasks')
}

export function setTasksStatus(db: Database.Database, ids: number[], status: TaskStatus): void {
  checkTaskIds(ids)
  if (!['todo', 'in-progress', 'done'].includes(status)) throw new Error('Choose a valid task status')
  db.transaction(() => ids.forEach((id) => setTaskStatus(db, id, status)))()
}

export function deleteTasks(db: Database.Database, ids: number[]): void {
  checkTaskIds(ids)
  db.transaction(() => ids.forEach((id) => deleteTask(db, id)))()
}

export function setTaskStatus(db: Database.Database, id: number, status: TaskStatus): Task {
  if (!['todo', 'in-progress', 'done'].includes(status)) throw new Error('Choose a valid task status')
  const task = getTask(db, id)
  if (status !== 'done' || task.status === 'done') {
    db.prepare('UPDATE tasks SET status = ?, completed_at = ? WHERE id = ?').run(status, status === 'done' ? task.completedAt : null, id)
    const updated = getTask(db, id)
    // Task completed (automation event) — only on the todo/in-progress -> done move, never on repeats.
    if (status === 'done' && task.status !== 'done') {
      void emitAutomation(db, 'task-completed', `task:${id}`, { taskId: id })
    }
    return updated
  }
  const now = new Date().toISOString()
  db.transaction(() => {
    db.prepare("UPDATE tasks SET status = 'done', completed_at = ? WHERE id = ?").run(now, id)
    createRecurringOccurrence(db, {
      ...task,
      subtasks: task.subtasks.map((subtask, index) => ({ ...subtask, done: false, sortOrder: index }))
    }, now)
  })()
  void emitAutomation(db, 'task-completed', `task:${id}`, { taskId: id })
  return getTask(db, id)
}
