import assert from 'node:assert/strict'
import type Database from 'better-sqlite3'
import { openDatabase } from './sqlite'
import { MIGRATIONS, applyMigrations } from '../src/main/migrations'
import { addTaskMonths, applyColumnOrder, filterTasks, groupTasksForBoard, localTaskDay, nextTaskDate, nextTaskDateAfter, pendingTaskReminders, sortTasks, subtaskProgress, taskInputForEdit, taskInputProblems, taskReview } from '../src/shared/tasks'
import { normalizeSettings } from '../src/shared/appearance'
import { clearTrash, createTask, deleteTaskForever, deleteTasks, listCompletedTasks, listDeletedTasks, listTasks, overdueTasks, promoteSubtask, reorderSubtasks, reorderTasks, rescheduleTasks, restoreTask, setSubtaskDone, setTaskStatus, setTasksStatus, skipTaskOccurrence, softDeleteTask, undoTaskStatus, updateTask } from '../src/main/tasks'
import { resolveOccurrences } from '../src/shared/tasks'
import { collectBackup, restoreBackup } from '../src/main/backup'
import { runSearch } from '../src/main/search'
import { parseBackup } from '../src/shared/backup'
import type { Task, TaskRecurrence } from '../src/shared/types'

let n = 0
const test = (name: string, fn: () => void) => { fn(); n++; console.log('ok  ', name) }
const make = (id: number, dueDate: string | null, status: Task['status'] = 'todo'): Task => ({
  id, title: `Task ${id}`, notes: '', status, priority: 'medium', dueDate, dueTime: null, createdAt: '2026-10-26T12:00:00.000Z',
  completedAt: null, deletedAt: null, project: null, tags: [], position: id, recurrenceRule: null, recurrenceNext: null, subtasks: []
})
const recurrence = (frequency: TaskRecurrence['frequency'], intervalDays = 1): TaskRecurrence => ({ frequency, intervalDays })

const openTaskDb = () => {
  const db = openDatabase()
  db.pragma('foreign_keys = ON') // the app runs with this on (db.ts)
  applyMigrations(db)
  return db
}

// 2026-10-26 is a Monday.
test('daily, weekly, custom and monthly recurrence use calendar dates', () => {
  assert.equal(nextTaskDate('2026-10-26', recurrence('daily')), '2026-10-27')
  assert.equal(nextTaskDate('2026-10-26', recurrence('weekly')), '2026-11-02')
  assert.equal(nextTaskDate('2026-10-26', recurrence('custom', 3)), '2026-10-29')
  assert.equal(nextTaskDate('2026-10-26', recurrence('monthly')), '2026-11-26')
  assert.equal(nextTaskDate('2026-10-26', null), null)
})
test('monthly recurrence clamps month ends and respects leap years', () => {
  assert.equal(addTaskMonths('2026-01-31', 1), '2026-02-28')
  assert.equal(addTaskMonths('2028-01-31', 1), '2028-02-29')
  assert.equal(addTaskMonths('2026-12-31', 2), '2027-02-28')
  assert.equal(nextTaskDate('2026-02-28', recurrence('monthly'), '2026-01-31'), '2026-03-31')
})
test('late completion advances past missed periods without losing the monthly anchor', () => {
  assert.equal(nextTaskDateAfter('2026-10-26', recurrence('weekly'), '2026-10-26', '2026-11-20'), '2026-11-23')
  assert.equal(nextTaskDateAfter('2026-02-28', recurrence('monthly'), '2026-01-31', '2026-04-01'), '2026-04-30')
  assert.equal(nextTaskDateAfter('2026-10-26', null, '2026-10-26', '2026-11-20'), null)
})

test('today view includes due-today and undated active tasks, not overdue, future or done ones', () => {
  const tasks = [make(1, '2026-10-26'), make(2, '2026-10-25'), make(3, '2026-10-27'), make(4, '2026-10-26', 'done'), make(5, null)]
  assert.deepEqual(filterTasks(tasks, { view: 'today' }, '2026-10-26').map((t) => t.id), [1, 5])
})
test('overdue view includes earlier due dates and excludes completed tasks', () => {
  const tasks = [make(1, '2026-10-25'), make(2, '2026-10-26'), make(3, '2026-10-20', 'done'), make(4, null)]
  assert.deepEqual(filterTasks(tasks, { view: 'overdue' }, '2026-10-26').map((t) => t.id), [1])
})
test('upcoming view includes future dates within seven days and undated, not today or done tasks', () => {
  const tasks = [make(1, '2026-10-27'), make(2, '2026-10-26'), make(3, '2026-10-27', 'done'), make(4, null)]
  assert.deepEqual(filterTasks(tasks, { view: 'upcoming' }, '2026-10-26').map((t) => t.id), [1, 4])
})

test('Today includes undated tasks; Upcoming is limited to seven days; overdue respects due time', () => {
  const items = [
    { ...make(1, null) },
    { ...make(2, '2026-11-02'), dueTime: '08:59' },
    { ...make(3, '2026-11-02'), dueTime: '09:00' },
    { ...make(4, '2026-11-10') }
  ]
  assert.deepEqual(filterTasks(items, { view: 'today' }, '2026-11-01').map((task) => task.id), [1])
  assert.deepEqual(filterTasks(items, { view: 'overdue' }, '2026-11-02', '09:00').map((task) => task.id), [2])
  assert.deepEqual(filterTasks(items, { view: 'upcoming' }, '2026-11-01').map((task) => task.id), [1, 2, 3])
})

test('overdue boundaries remain correct across midnight', () => {
  const items = [
    { ...make(1, '2026-11-01'), dueTime: '23:59' },
    { ...make(2, '2026-11-02'), dueTime: '00:01' }
  ]
  assert.deepEqual(filterTasks(items, { view: 'overdue' }, '2026-11-02', '00:00').map((task) => task.id), [1])
  assert.deepEqual(filterTasks(items, { view: 'overdue' }, '2026-11-02', '00:02').map((task) => task.id), [1, 2])
})

test('task sorting and subtask progress are stable for ties and empty lists', () => {
  const items = [{ ...make(1, null), priority: 'low' as const }, { ...make(2, '2026-10-25'), priority: 'high' as const }]
  assert.deepEqual(sortTasks(items, 'priority').map((task) => task.id), [2, 1])
  assert.deepEqual(sortTasks(items, 'due-date').map((task) => task.id), [2, 1])
  assert.deepEqual(subtaskProgress([]), { done: 0, total: 0, percent: 0 })
  assert.deepEqual(subtaskProgress([{ done: true }, { done: false }]), { done: 1, total: 2, percent: 50 })
})

test('task reminders fire only at/after due time within the grace period', () => {
  const timed = { ...make(1, '2026-11-01'), dueTime: '09:00' }
  const items = [timed, { ...timed, id: 2, status: 'done' as const }, { ...timed, id: 3, deletedAt: '2026-10-31' }]
  assert.deepEqual(pendingTaskReminders(items, '2026-11-01', '08:59'), [])
  assert.deepEqual(pendingTaskReminders(items, '2026-11-01', '09:05').map((task) => task.id), [1])
  assert.deepEqual(pendingTaskReminders(items, '2026-11-01', '09:11'), [])
})

test('inline rescheduling changes the active recurring date without losing its monthly anchor', () => {
  const task = { ...make(1, '2026-01-31'), recurrenceRule: recurrence('monthly'), recurrenceNext: '2026-03-31' }
  const moved = taskInputForEdit(task, { dueDate: '2026-04-02' })
  assert.equal(moved.dueDate, '2026-01-31')
  assert.equal(moved.recurrenceNext, '2026-04-02')
  const plain = taskInputForEdit(make(2, '2026-11-01'), { dueDate: '2026-11-03' })
  assert.equal(plain.dueDate, '2026-11-03')
  assert.equal(plain.recurrenceNext, null)
})
test('priority, project and tags combine with the chosen view', () => {
  const tasks = [
    { ...make(1, '2026-10-26'), priority: 'high' as const, project: 'Home', tags: ['clean'] },
    { ...make(2, '2026-10-26'), priority: 'low' as const, project: 'Home', tags: ['clean'] }
  ]
  assert.deepEqual(filterTasks(tasks, { view: 'today', priority: 'high', project: 'Home', tag: 'clean' }, '2026-10-26').map((t) => t.id), [1])
})

test('text search matches title, notes, project, tags and checklist lines', () => {
  const tasks: Task[] = [
    { ...make(1, null), title: 'Renew passport' },
    { ...make(2, null), title: 'Groceries', notes: 'Buy oat milk' },
    { ...make(3, null), title: 'Fix bike', project: 'Home' },
    { ...make(4, null), title: 'Plan trip', tags: ['travel'] },
    { ...make(5, null), title: 'Ship release', subtasks: [{ id: 9, taskId: 5, title: 'Write changelog', done: false, sortOrder: 0 }] }
  ]
  const ids = (text: string) => filterTasks(tasks, { view: 'all', text }, '2026-10-26').map((t) => t.id)
  assert.deepEqual(ids('passport'), [1])
  assert.deepEqual(ids('OAT'), [2])
  assert.deepEqual(ids('home'), [3])
  assert.deepEqual(ids('travel'), [4])
  assert.deepEqual(ids('changelog'), [5])
  assert.deepEqual(ids('   '), [1, 2, 3, 4, 5])
})

test('the board splits exactly the tasks the list shows, for every filter', () => {
  const tasks: Task[] = [
    { ...make(1, '2026-10-26'), priority: 'high', project: 'Work', tags: ['urgent'] },
    { ...make(2, '2026-10-27'), status: 'in-progress', project: 'Work', tags: ['urgent'] },
    { ...make(3, '2026-10-25'), project: 'Home', tags: ['clean'] },
    { ...make(4, null, 'done'), project: 'Work' },
    { ...make(5, '2026-10-27') }
  ]
  const filters = [
    { view: 'today' as const }, { view: 'upcoming' as const }, { view: 'all' as const },
    { view: 'all' as const, project: 'Work' }, { view: 'all' as const, priority: 'high' as const },
    { view: 'all' as const, tag: 'urgent' }, { view: 'completed' as const }, { view: 'all' as const, text: 'home' }
  ]
  for (const filter of filters) {
    const columns = groupTasksForBoard(tasks, filter, '2026-10-26')
    const board = [...columns.todo, ...columns['in-progress'], ...columns.done].map((t) => t.id).sort((a, b) => a - b)
    const list = filterTasks(tasks, filter, '2026-10-26').map((t) => t.id).sort((a, b) => a - b)
    assert.deepEqual(board, list, `filters: ${JSON.stringify(filter)}`)
  }
})

test('a column reorder fills only the slots those tasks already held', () => {
  assert.deepEqual(applyColumnOrder([10, 20, 30, 40, 50], [40, 10, 30]), [40, 20, 10, 30, 50])
  assert.deepEqual(applyColumnOrder([1, 2, 3], [3, 1, 2]), [3, 1, 2])
})

test('task layout, sort and saved views normalize persisted settings safely', () => {
  assert.equal(normalizeSettings(null).taskLayout, 'list')
  assert.equal(normalizeSettings({ taskLayout: 'board' }).taskLayout, 'board')
  assert.equal(normalizeSettings({ taskLayout: 'grid' } as never).taskLayout, 'list')
  assert.equal(normalizeSettings(null).taskSort, 'manual')
  assert.equal(normalizeSettings({ taskSort: 'priority' }).taskSort, 'priority')
  assert.equal(normalizeSettings({ taskSort: 'created' } as never).taskSort, 'manual')
  assert.deepEqual(normalizeSettings({ taskSavedViews: [{ id: 'my-view', name: '  Work  ', filter: { view: 'overdue', priority: 'high' } }] }).taskSavedViews,
    [{ id: 'my-view', name: 'Work', filter: { view: 'overdue', text: '', priority: 'high', project: undefined, tag: undefined } }])
  assert.deepEqual(normalizeSettings({ taskSavedViews: [{ id: 'bad space', name: 'bad', filter: {} }] }).taskSavedViews, [])
})

test('bulk status and delete change every chosen task in one go', () => {
  const db = openTaskDb()
  const base = { notes: '', priority: 'low' as const, dueDate: null, dueTime: null, project: null, tags: [], recurrenceRule: null, recurrenceNext: null, subtasks: [] }
  const a = createTask(db, { ...base, title: 'A', status: 'todo' }).id
  const b = createTask(db, { ...base, title: 'B', status: 'todo' }).id
  const c = createTask(db, { ...base, title: 'C', status: 'done' }).id
  setTasksStatus(db, [a, b], 'done')
  assert.deepEqual([a, b, c].map((id) => listTasks(db).find((t) => t.id === id)!.status), ['done', 'done', 'done'])
  setTasksStatus(db, [a, c], 'todo')
  assert.equal(listTasks(db).find((t) => t.id === a)!.completedAt, null)
  assert.equal(listTasks(db).find((t) => t.id === b)!.status, 'done')
  deleteTasks(db, [a, b])
  assert.deepEqual(listTasks(db).map((t) => t.id), [c])
  db.close()
})

test('overdueTasks returns overdue active tasks with local-calendar day counts', () => {
  const db = openTaskDb()
  const overdue = createTask(db, {
    title: 'Overdue', notes: '', status: 'todo', priority: 'medium', dueDate: '2026-10-24', dueTime: null,
    project: null, tags: [], recurrenceRule: null, recurrenceNext: null, subtasks: []
  })
  createTask(db, {
    title: 'Due today', notes: '', status: 'todo', priority: 'medium', dueDate: '2026-10-26', dueTime: null,
    project: null, tags: [], recurrenceRule: null, recurrenceNext: null, subtasks: []
  })
  createTask(db, {
    title: 'Completed', notes: '', status: 'done', priority: 'medium', dueDate: '2026-10-24', dueTime: null,
    project: null, tags: [], recurrenceRule: null, recurrenceNext: null, subtasks: []
  })
  const result = overdueTasks(db, '2026-10-26')
  assert.deepEqual(result, [{ id: overdue.id, title: 'Overdue', daysOverdue: 2 }])
  db.close()
})

test('malformed stored task JSON falls back to safe defaults instead of crashing', () => {
  const db = openTaskDb()
  db.prepare(`INSERT INTO tasks (title, notes, status, priority, due_date, created_at, completed_at, project, tags, position, recurrence_rule)
    VALUES ('Broken', '', 'todo', 'medium', '2026-10-26', '2026-10-26T12:00:00.000Z', NULL, NULL, '{bad json', 0, '{bad recurrence')`).run()
  const task = listTasks(db)[0]
  assert.deepEqual(task.tags, [])
  assert.equal(task.recurrenceRule, null)
  db.close()
})

test('completing a recurring task stays done until due, then opens the same occurrence', () => {
  const db = openTaskDb()
  const created = createTask(db, { title: 'Water plants', notes: 'Careful', status: 'todo', priority: 'high', dueDate: '2026-10-26', dueTime: null, project: 'Home', tags: ['weekly'], recurrenceRule: recurrence('weekly'), recurrenceNext: null, subtasks: [{ title: 'Fill can', done: true }] })
  const completed = setTaskStatus(db, created.id, 'done')
  assert.equal(completed.status, 'done')
  assert.ok(completed.completedAt)
  // Completing stamps the NEXT due date (weekly rule, done on the 26th -> next 2026-11-02).
  assert.equal(completed.recurrenceNext, '2026-11-02')
  // Until that date arrives the task stays done and is not surfaced as due.
  const before = listTasks(db, '2026-10-27').find((t) => t.id === created.id)!
  assert.equal(before.status, 'done')
  assert.equal(before.recurrenceNext, '2026-11-02')
  // The read ON the next due date resolves the occurrence: done -> todo, checklist reset.
  const afterRead = listTasks(db, '2026-11-02').find((t) => t.id === created.id)!
  assert.equal(afterRead.status, 'todo')
  assert.equal(afterRead.completedAt, null)
  assert.equal(afterRead.recurrenceNext, '2026-11-02')
  assert.deepEqual(afterRead.subtasks.map((s) => s.done), [false])
  db.close()
})

test('completed tasks remain visible for their completion day after reopening or recurrence rollover', () => {
  const db = openTaskDb()
  const task = createTask(db, fullInput('Read pages', null, null))
  const finished = setTaskStatus(db, task.id, 'done')
  const completedDay = localTaskDay(finished.completedAt)!
  assert.deepEqual(listCompletedTasks(db, completedDay).map((item) => item.title), ['Read pages'])

  setTaskStatus(db, task.id, 'todo')
  assert.deepEqual(listCompletedTasks(db, completedDay).map((item) => item.title), ['Read pages'])
  assert.equal(listCompletedTasks(db, '1900-01-01').length, 0)

  const recurringTask = createTask(db, fullInput('Daily review', recurrence('daily'), completedDay))
  const occurrence = setTaskStatus(db, recurringTask.id, 'done')
  const occurrenceDay = localTaskDay(occurrence.completedAt)!
  assert.equal(listCompletedTasks(db, occurrenceDay).filter((item) => item.id === recurringTask.id).length, 1)
  listTasks(db, '2999-01-01')
  assert.equal(listCompletedTasks(db, occurrenceDay).filter((item) => item.id === recurringTask.id).length, 1)
  db.close()
})

test('undoing a completion removes only the completion it just recorded', () => {
  const db = openTaskDb()
  const task = createTask(db, fullInput('Undo completion', null, null))
  const completed = setTaskStatus(db, task.id, 'done')
  const completedDay = localTaskDay(completed.completedAt)!
  assert.equal(listCompletedTasks(db, completedDay).length, 1)

  undoTaskStatus(db, task.id, 'todo', null, null)
  assert.equal(listCompletedTasks(db, completedDay).length, 0)
  db.close()
})

test('review task counts use local calendar dates for UTC completion stamps', () => {
  const task = make(1, null, 'done')
  const localDate = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
  const created = new Date(2026, 9, 26, 23, 30)
  const completed = new Date(2026, 9, 27, 1)
  task.createdAt = created.toISOString()
  task.completedAt = completed.toISOString()
  const start = localDate(created), end = localDate(completed)
  assert.deepEqual(taskReview([task], start, start), { created: 1, completed: 0 })
  assert.deepEqual(taskReview([task], start, end), { created: 1, completed: 1 })
})

test('migration advances a populated version-5 database without losing prior rows and is safe to rerun', () => {
  const db = openDatabase()
  for (let i = 0; i < 5; i++) db.exec(MIGRATIONS[i])
  db.pragma('user_version = 5')
  db.prepare("INSERT INTO settings (key, value) VALUES ('kept', 'yes')").run()
  db.prepare("INSERT INTO logbook_entries (date,title,created_at,updated_at) VALUES ('2026-10-26','preserved','now','now')").run()
  applyMigrations(db)
  // The newest version, so adding a migration does not break this test.
  assert.equal(db.pragma('user_version', { simple: true }), MIGRATIONS.length)
  assert.equal((db.prepare("SELECT title FROM logbook_entries").get() as { title: string }).title, 'preserved')
  assert.equal((db.prepare("SELECT value FROM settings WHERE key='kept'").get() as { value: string }).value, 'yes')
  const id = createTask(db, { title: 'kept', notes: '', status: 'todo', priority: 'low', dueDate: null, dueTime: null, project: null, tags: [], recurrenceRule: null, recurrenceNext: null, subtasks: [] }).id
  updateTask(db, id, { title: 'kept updated', notes: '', status: 'todo', priority: 'low', dueDate: null, dueTime: null, project: null, tags: [], recurrenceRule: null, recurrenceNext: null, subtasks: [] })
  applyMigrations(db)
  assert.equal(db.pragma('user_version', { simple: true }), MIGRATIONS.length)
  db.close()
})

// ---- recurring-task lifecycle: the contract at the top of src/main/tasks.ts ----
// Migration 9 removed child-copy recurrence entirely: ONE row owns recurrence_rule +
// recurrence_next, and occurrences are resolved at READ time (resolveOccurrences).

function fullInput(title: string, rec: TaskRecurrence | null, dueDate: string | null, extra: Partial<Parameters<typeof createTask>[1]> = {}): Parameters<typeof createTask>[1] {
  return { title, notes: '', status: 'todo', priority: 'medium', dueDate, dueTime: null, project: null, tags: [], recurrenceRule: rec, recurrenceNext: null, subtasks: [], ...extra }
}

const recurring = (db: Database.Database): ReturnType<typeof createTask> =>
  createTask(db, fullInput('Water plants', recurrence('weekly'), '2026-10-26'))

// Creating a recurring task stores its rule; the series is driven by due date + recurrence rules.
test('creating a recurring task keeps its rule and shows as todo', () => {
  const db = openTaskDb()
  const task = recurring(db)
  assert.deepEqual(task.recurrenceRule, recurrence('weekly'))
  assert.equal(task.recurrenceNext, null)
  assert.deepEqual(resolveOccurrences(listTasks(db), '2026-10-26').find((t) => t.id === task.id)!.status, 'todo')
  db.close()
})

test('repeated completions never create extra rows: one row owns the whole series', () => {
  const db = openTaskDb()
  const task = recurring(db)
  // double click, repeated calls, bulk path with the same id twice, done -> undone -> done:
  // every shape of "completing again" stays one row with no duplicate series
  setTaskStatus(db, task.id, 'done')
  setTaskStatus(db, task.id, 'done')
  setTasksStatus(db, [task.id, task.id], 'done')
  setTaskStatus(db, task.id, 'todo')
  setTaskStatus(db, task.id, 'done')
  assert.equal(listTasks(db).length, 1)
  assert.equal(listTasks(db)[0].status, 'done')
  db.close()
})

test('editing a recurring task keeps its rule; resolveOccurrences drives the whole chain', () => {
  const db = openTaskDb()
  const task = recurring(db)
  setTaskStatus(db, task.id, 'done')
  // edit the row hard: new title, notes, rule and tags
  updateTask(db, task.id, fullInput('Tidy up', recurrence('monthly'), '2026-10-26', {
    status: 'done' as const, notes: 'edited', priority: 'low' as const, project: 'Work', tags: ['new']
  }))
  const loaded = listTasks(db)[0]
  assert.equal(loaded.title, 'Tidy up')
  assert.deepEqual(loaded.recurrenceRule, recurrence('monthly'))
  assert.equal(loaded.status, 'done')
  assert.equal(listTasks(db).length, 1) // still exactly one row
  db.close()
})

test('soft delete hides a task from every view; restore brings it back', () => {
  const db = openTaskDb()
  const task = recurring(db)
  softDeleteTask(db, task.id)
  assert.deepEqual(listTasks(db), []) // gone from the views...
  const deleted = listTasks(db) // ...and restore brings it back
  restoreTask(db, task.id)
  assert.equal(listTasks(db).length, 1)
  assert.equal(listTasks(db)[0].deletedAt, null)
  assert.equal(deleted.length, 0)
  db.close()
})

test('Trash supports restore, permanent deletion and clearing all deleted tasks', () => {
  const db = openTaskDb()
  const restored = createTask(db, fullInput('Restore me', null, null))
  const forever = createTask(db, fullInput('Delete forever', null, null))
  const cleared = createTask(db, fullInput('Clear me', null, null))
  softDeleteTask(db, restored.id)
  softDeleteTask(db, forever.id)
  softDeleteTask(db, cleared.id)
  assert.deepEqual(listDeletedTasks(db).map((task) => task.id).sort((a, b) => a - b), [restored.id, forever.id, cleared.id].sort((a, b) => a - b))
  restoreTask(db, restored.id)
  deleteTaskForever(db, forever.id)
  assert.equal(db.prepare('SELECT id FROM tasks WHERE id = ?').get(forever.id), undefined)
  clearTrash(db)
  assert.deepEqual(listDeletedTasks(db), [])
  assert.equal(listTasks(db).some((task) => task.id === restored.id), true)
  db.close()
})

test('bulk rescheduling validates dates and rolls back if any selected task is missing', () => {
  const db = openTaskDb()
  const a = createTask(db, fullInput('A', null, '2026-10-26')).id
  const b = createTask(db, fullInput('B', null, '2026-10-27')).id
  assert.throws(() => rescheduleTasks(db, [a, 99999], '2026-11-02'), /no longer exists/)
  assert.equal(listTasks(db).find((task) => task.id === a)!.dueDate, '2026-10-26')
  rescheduleTasks(db, [a, b], '2026-11-02', '09:30')
  assert.deepEqual(listTasks(db).map((task) => [task.dueDate, task.dueTime]), [['2026-11-02', '09:30'], ['2026-11-02', '09:30']])
  assert.throws(() => rescheduleTasks(db, [a], '2026-02-30'), /real calendar date/)
  db.close()
})

test('bulk rescheduling moves the active occurrence of a recurring task, not its anchor', () => {
  const db = openTaskDb()
  const task = createTask(db, fullInput('Recurring', recurrence('weekly'), '2026-10-26', { recurrenceNext: '2026-11-02' }))
  rescheduleTasks(db, [task.id], '2026-11-05', '10:00')
  const updated = listTasks(db).find((item) => item.id === task.id)!
  assert.equal(updated.dueDate, '2026-10-26')
  assert.equal(updated.recurrenceNext, '2026-11-05')
  assert.equal(updated.dueTime, '10:00')
  db.close()
})

test('subtask completion, reorder and promotion preserve parent and promoted task data', () => {
  const db = openTaskDb()
  const parent = createTask(db, fullInput('Parent', null, null, {
    subtasks: [{ title: 'First', done: false }, { title: 'Second', done: false }]
  }))
  const [first, second] = parent.subtasks
  setSubtaskDone(db, parent.id, first.id, true)
  reorderSubtasks(db, parent.id, [second.id, first.id])
  const reordered = listTasks(db)[0].subtasks
  assert.deepEqual(reordered.map((item) => item.title), ['Second', 'First'])
  const promoted = promoteSubtask(db, parent.id, second.id)
  assert.equal(promoted.title, 'Second')
  assert.deepEqual(listTasks(db).find((task) => task.id === parent.id)!.subtasks.map((item) => item.title), ['First'])
  db.close()
})

test('universal search finds tasks by title, notes, project and tags', () => {
  const db = openTaskDb()
  createTask(db, fullInput('Renew passport', null, null, { notes: 'Book an appointment', project: 'Travel', tags: ['documents'] }))
  assert.equal(runSearch(db, 'passport').tasks.items[0].title, 'Renew passport')
  assert.equal(runSearch(db, 'appointment').tasks.items[0].title, 'Renew passport')
  assert.equal(runSearch(db, 'travel').tasks.items[0].title, 'Renew passport')
  assert.equal(runSearch(db, '#doc').tasks.items[0].title, 'Renew passport')
  db.close()
})

test('skipping a recurring occurrence advances exactly one scheduled period', () => {
  const db = openTaskDb()
  const task = createTask(db, fullInput('Weekly', recurrence('weekly'), '2026-10-26', {
    subtasks: [{ title: 'Checklist', done: true }]
  }))
  const skipped = skipTaskOccurrence(db, task.id, '2026-10-28')
  assert.equal(skipped.recurrenceNext, '2026-11-02')
  assert.deepEqual(skipped.subtasks.map((subtask) => subtask.done), [false])
  db.close()
})

test('resolveOccurrences opens the due recurring occurrence and resets its checklist', () => {
  const done = (overdue: string | null): Task => ({
    ...make(1, '2026-10-26', 'done'), recurrenceRule: recurrence('weekly'), recurrenceNext: overdue, completedAt: '2026-10-26T12:00:00.000Z',
    subtasks: [{ id: 1, taskId: 1, title: 'Check', done: true, sortOrder: 0 }]
  })
  // not due yet: stays done; due/overdue: flips to todo without advancing its due date
  assert.equal(resolveOccurrences([done('2026-11-10')], '2026-11-02')[0].status, 'done')
  const advanced = resolveOccurrences([done('2026-10-27')], '2026-11-02')[0]
  assert.equal(advanced.status, 'todo')
  assert.equal(advanced.completedAt, null)
  assert.equal(advanced.recurrenceNext, '2026-10-27')
  assert.deepEqual(advanced.subtasks.map((subtask) => subtask.done), [false])
  // no rule = never advanced
  const plain = resolveOccurrences([{ ...make(2, null, 'done') }], '2026-11-02')[0]
  assert.equal(plain.status, 'done')
  // the input list is not mutated
  const original = done('2026-10-27')
  resolveOccurrences([original], '2026-11-02')
  assert.equal(original.status, 'done')
})

test('reorder writes a position per id, in the order given', () => {
  const db = openTaskDb()
  const a = createTask(db, fullInput('A', null, null)).id
  const b = createTask(db, fullInput('B', null, null)).id
  const c = createTask(db, fullInput('C', null, null)).id
  reorderTasks(db, [c, a, b])
  assert.deepEqual(listTasks(db).map((t) => t.id), [c, a, b])
  db.close()
})

// ---- task editor input validation (src/shared/tasks.ts) ----

const validTaskInput = {
  title: 'Water plants', notes: '', status: 'todo', priority: 'medium', dueDate: null, dueTime: null,
  project: null, tags: [], recurrenceRule: null, recurrenceNext: null, subtasks: []
} as unknown as Parameters<typeof taskInputProblems>[0]

test('task input validation returns one exact, visible fix per bad field', () => {
  assert.deepEqual(taskInputProblems(validTaskInput), {})
  const bad = taskInputProblems({ ...validTaskInput, title: '   ', status: 'later', priority: 'urgent', dueDate: '2026-02-30', dueTime: '25:99',
    recurrenceRule: { frequency: 'hourly', intervalDays: 1 }, tags: 'work', subtasks: 'kit' } as never)
  assert.deepEqual(bad, {
    title: 'Give the task a title.',
    status: 'Choose a valid task status.',
    priority: 'Choose a valid task priority.',
    dueDate: 'Due date must be a real calendar date, like 2026-10-25.',
    dueTime: 'Due time must be between 00:00 and 23:59.',
    recurrenceRule: 'Choose a valid recurrence.',
    tags: 'Tags must be a list of tag names.',
    subtasks: 'Subtasks must be a list of checklist items with a title each.'
  })
})

test('custom recurrence interval bounds are refused with an exact fix', () => {
  const withCustom = (intervalDays: number) =>
    taskInputProblems({ ...validTaskInput, recurrenceRule: { frequency: 'custom', intervalDays } } as unknown as never)
  assert.equal(withCustom(0).recurrenceRule, 'Custom repeat must be between 1 and 3650 days.')
  assert.equal(withCustom(3651).recurrenceRule, 'Custom repeat must be between 1 and 3650 days.')
  assert.deepEqual(withCustom(90), {})
})

test('an impossible due date is refused; a past one stays allowed because overdue tasks are a real view', () => {
  assert.deepEqual(taskInputProblems({ ...validTaskInput, dueDate: '2025-10-25' } as unknown as never), {})
  assert.ok(taskInputProblems({ ...validTaskInput, dueDate: '2026-02-30' } as unknown as never).dueDate)
  assert.ok(taskInputProblems({ ...validTaskInput, dueDate: 'not-a-date' } as unknown as never).dueDate)
})

// ---- backup round trip: export -> import keeps every task field (Fix 2 regression test) ----

test('backup export/import round-trips the full migration-9 task schema', () => {
  const source = openTaskDb()
  const plain = createTask(source, fullInput('Plain', null, '2026-10-25', { status: 'todo' as const, priority: 'high' as const }))
  const rec = createTask(source, fullInput('Weekly', recurrence('weekly'), '2026-10-26', { tags: ['plants'], subtasks: [{ title: 'Fill can', done: true }] }))
  const completedRec = setTaskStatus(source, rec.id, 'done') // stamps recurrence_next
  const ghost = createTask(source, fullInput('Trash', null, null))
  softDeleteTask(source, ghost.id) // trash state must survive a restore

  const parsed = parseBackup(JSON.stringify(collectBackup(source)), MIGRATIONS.length)
  const target = openTaskDb()
  void createTask(target, fullInput('Stray', null, null)) // import fully replaces, never merges
  restoreBackup(target, parsed)

  const loaded = listTasks(target)
  assert.deepEqual(loaded.map((t) => t.title).sort(), ['Plain', 'Weekly']) // trash invisible in views
  const restoredPlain = loaded.find((t) => t.id === plain.id)! // original ids preserved
  assert.equal(restoredPlain.dueDate, '2026-10-25')
  assert.equal(restoredPlain.priority, 'high')
  const restoredRec = loaded.find((t) => t.id === rec.id)!
  assert.deepEqual(restoredRec.recurrenceRule, recurrence('weekly'))
  assert.equal(restoredRec.recurrenceNext, '2026-11-02') // the stamped next occurrence survived
  assert.equal(restoredRec.status, 'done')
  assert.deepEqual(listCompletedTasks(target, localTaskDay(completedRec.completedAt)!).map((t) => t.title), ['Weekly'])
  assert.deepEqual(restoredRec.tags, ['plants'])
  assert.deepEqual(restoredRec.subtasks.map((s) => s.title), ['Fill can'])
  // importing twice is idempotent (delete-all then re-insert)
  restoreBackup(target, parsed)
  assert.equal(listTasks(target).length, 2)
  // and the restored occurrence remains due until completed
  setTaskStatus(target, restoredRec.id, 'done')
  const again = listTasks(target, '2026-11-02').find((t) => t.id === rec.id)!
  assert.equal(again.status, 'todo')
  assert.equal(again.recurrenceNext, '2026-11-02')

  const legacyBackup = collectBackup(source) as unknown as Record<string, unknown>
  delete legacyBackup.taskCompletions
  const legacyTarget = openTaskDb()
  restoreBackup(legacyTarget, parseBackup(JSON.stringify(legacyBackup), MIGRATIONS.length))
  assert.deepEqual(listCompletedTasks(legacyTarget, localTaskDay(completedRec.completedAt)!).map((t) => t.title), ['Weekly'])
  legacyTarget.close()
  target.close()
  source.close()
})

test('a restore clears the automation activity so it never mixes machine histories', () => {
  const source = openTaskDb()
  void createTask(source, fullInput('Done deal', null, null))
  // A row in the SOURCE's activity log. (Automations are off by default, so tests seed the
  // activity table directly rather than relying on a rule firing.)
  source.prepare("INSERT INTO automation_events (rule, event, event_key, label, entry_id, created_at) VALUES ('loss-reflection', 'trade-closed', 'trade:1', 'drafted a reflection', NULL, '2026-10-01T00:00:00Z')").run()
  assert.equal((source.prepare('SELECT COUNT(*) AS n FROM automation_events').get() as { n: number }).n, 1)

  // Backups deliberately EXCLUDE automation activity (machine-local, not user data):
  const backup = collectBackup(source) as unknown as Record<string, unknown>
  assert.equal('automationEvents' in backup, false)

  const target = openTaskDb()
  // The target has its OWN unrelated automation history (what a second machine would look like).
  target.prepare("INSERT INTO automation_events (rule, event, event_key, label, entry_id, created_at) VALUES ('other-machine', 'task-completed', 'task:99', 'made elsewhere', NULL, '2020-01-01T00:00:00Z')").run()
  assert.equal((target.prepare('SELECT COUNT(*) AS n FROM automation_events').get() as { n: number }).n, 1)

  // Restoring wipes it: the imported data starts its own history on this machine.
  const parsed = parseBackup(JSON.stringify(backup), MIGRATIONS.length)
  restoreBackup(target, parsed)
  assert.equal((target.prepare('SELECT COUNT(*) AS n FROM automation_events').get() as { n: number }).n, 0)
  target.close()
  source.close()
})

console.log(`\n${n} task checks passed`)
