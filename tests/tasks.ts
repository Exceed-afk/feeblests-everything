import assert from 'node:assert/strict'
import Database from 'better-sqlite3'
import { MIGRATIONS, applyMigrations } from '../src/main/migrations'
import { addTaskMonths, applyColumnOrder, filterTasks, groupTasksForBoard, nextTaskDate, taskInputProblems, taskReview } from '../src/shared/tasks'
import { normalizeSettings } from '../src/shared/appearance'
import { createTask, deleteTask, deleteTasks, setTaskStatus, setTasksStatus, updateTask, listTasks } from '../src/main/tasks'
import { collectBackup, restoreBackup } from '../src/main/backup'
import { parseBackup } from '../src/shared/backup'
import type { Task, TaskRecurrence } from '../src/shared/types'

let n = 0
const test = (name: string, fn: () => void) => { fn(); n++; console.log('ok  ', name) }
const make = (id: number, dueDate: string | null, status: Task['status'] = 'todo'): Task => ({
  id, title: `Task ${id}`, notes: '', status, priority: 'medium', dueDate, createdAt: '2026-10-26T12:00:00.000Z',
  completedAt: null, project: null, tags: [], sortOrder: id, recurrence: null, parentTaskId: null, subtasks: []
})
const recurrence = (frequency: TaskRecurrence['frequency'], intervalDays = 1): TaskRecurrence => ({ frequency, intervalDays })

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
})

test('today view includes due-today active tasks only', () => {
  const tasks = [make(1, '2026-10-26'), make(2, '2026-10-25'), make(3, '2026-10-27'), make(4, '2026-10-26', 'done'), make(5, null)]
  assert.deepEqual(filterTasks(tasks, { view: 'today' }, '2026-10-26').map((t) => t.id), [1])
})
test('overdue view includes earlier due dates and excludes completed tasks', () => {
  const tasks = [make(1, '2026-10-25'), make(2, '2026-10-26'), make(3, '2026-10-20', 'done'), make(4, null)]
  assert.deepEqual(filterTasks(tasks, { view: 'overdue' }, '2026-10-26').map((t) => t.id), [1])
})
test('upcoming view includes future dates, not today, undated or done tasks', () => {
  const tasks = [make(1, '2026-10-27'), make(2, '2026-10-26'), make(3, '2026-10-27', 'done'), make(4, null)]
  assert.deepEqual(filterTasks(tasks, { view: 'upcoming' }, '2026-10-26').map((t) => t.id), [1])
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

test('the saved task layout defaults to the list and accepts only list or board', () => {
  assert.equal(normalizeSettings(null).taskLayout, 'list')
  assert.equal(normalizeSettings({ taskLayout: 'board' }).taskLayout, 'board')
  assert.equal(normalizeSettings({ taskLayout: 'grid' } as never).taskLayout, 'list')
})

test('bulk status and delete change every chosen task in one go', () => {
  const db = new Database(':memory:')
  applyMigrations(db)
  const base = { notes: '', priority: 'low' as const, dueDate: null, project: null, tags: [], recurrence: null, parentTaskId: null, subtasks: [] }
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

test('malformed stored task JSON falls back to safe defaults instead of crashing', () => {
  const db = new Database(':memory:')
  applyMigrations(db)
  db.prepare(`INSERT INTO tasks (title, notes, status, priority, due_date, created_at, completed_at, project, tags, sort_order, recurrence, parent_task_id)
    VALUES ('Broken', '', 'todo', 'medium', '2026-10-26', '2026-10-26T12:00:00.000Z', NULL, NULL, '{bad json', 0, '{"frequency":"weekly"}', NULL)`).run()
  const task = listTasks(db)[0]
  assert.deepEqual(task.tags, [])
  assert.equal(task.recurrence, null)
  db.close()
})

test('recurring task completion creates one next occurrence with an unchecked checklist', () => {
  const db = new Database(':memory:')
  applyMigrations(db)
  const task = createTask(db, { title: 'Water plants', notes: 'Careful', status: 'todo', priority: 'high', dueDate: '2026-10-26', project: 'Home', tags: ['weekly'], recurrence: recurrence('weekly'), parentTaskId: null, subtasks: [{ title: 'Fill can', done: true }] })
  const completed = setTaskStatus(db, task.id, 'done')
  assert.equal(completed.status, 'done')
  const next = listTasks(db).find((item) => item.parentTaskId === task.id)
  assert.ok(next)
  assert.equal(next.dueDate, '2026-11-02')
  assert.equal(next.status, 'todo')
  assert.equal(next.subtasks[0].done, false)
  setTaskStatus(db, task.id, 'done')
  assert.equal(listTasks(db).filter((item) => item.parentTaskId === task.id).length, 1)
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
  const db = new Database(':memory:')
  for (let i = 0; i < 5; i++) db.exec(MIGRATIONS[i])
  db.pragma('user_version = 5')
  db.prepare("INSERT INTO settings (key, value) VALUES ('kept', 'yes')").run()
  db.prepare("INSERT INTO logbook_entries (date,title,created_at,updated_at) VALUES ('2026-10-26','preserved','now','now')").run()
  applyMigrations(db)
  assert.equal(db.pragma('user_version', { simple: true }), 7)
  assert.equal((db.prepare("SELECT title FROM logbook_entries").get() as { title: string }).title, 'preserved')
  assert.equal((db.prepare("SELECT value FROM settings WHERE key='kept'").get() as { value: string }).value, 'yes')
  assert.equal((db.prepare("SELECT COUNT(*) AS n FROM tasks").get() as { n: number }).n, 0)
  const id = createTask(db, { title: 'kept', notes: '', status: 'todo', priority: 'low', dueDate: null, project: null, tags: [], recurrence: null, parentTaskId: null, subtasks: [] }).id
  updateTask(db, id, { title: 'kept updated', notes: '', status: 'todo', priority: 'low', dueDate: null, project: null, tags: [], recurrence: null, parentTaskId: null, subtasks: [] })
  applyMigrations(db)
  assert.equal(db.pragma('user_version', { simple: true }), 7)
  db.close()
})

// ---- recurring-task lifecycle: the contract at the top of src/main/tasks.ts ----

const openTaskDb = () => {
  const db = new Database(':memory:')
  db.pragma('foreign_keys = ON') // the app runs with this on (db.ts); deletion tests rely on it
  applyMigrations(db)
  return db
}
const fullInput = (title: string, rec: TaskRecurrence | null, dueDate: string | null, extra: Partial<Parameters<typeof createTask>[1]> = {}): Parameters<typeof createTask>[1] =>
  ({ title, notes: '', status: 'todo', priority: 'medium' as const, dueDate, project: null, tags: [] as string[], recurrence: rec, parentTaskId: null, subtasks: [], ...extra })
const childrenOf = (db: Database.Database, parentId: number) => listTasks(db).filter((t) => t.parentTaskId === parentId)

test('repeated, rapid and reopen completions create exactly one child occurrence', () => {
  const db = openTaskDb()
  const task = createTask(db, fullInput('Water plants', recurrence('weekly'), '2026-10-26'))
  setTaskStatus(db, task.id, 'done')
  const child = listTasks(db).find((item) => item.parentTaskId === task.id)
  assert.ok(child)
  assert.equal(child.dueDate, '2026-11-02')
  // double click, repeated calls, bulk path with the same id twice, done -> undone -> done:
  // every shape of "completing again" must stay a no-op beyond the status change
  setTaskStatus(db, task.id, 'done')
  setTaskStatus(db, task.id, 'done')
  setTasksStatus(db, [task.id, task.id], 'done')
  setTaskStatus(db, task.id, 'todo')
  setTaskStatus(db, task.id, 'done')
  assert.equal(childrenOf(db, task.id).length, 1)
  assert.equal(childrenOf(db, task.id)[0].id, child.id)
  assert.equal(childrenOf(db, task.id)[0].dueDate, '2026-11-02')
  // the edit form is another completion path; saving it twice never duplicates either
  const saved = fullInput('Water plants', recurrence('weekly'), '2026-10-26', { status: 'done' as const, tags: ['plants'] })
  updateTask(db, task.id, saved)
  updateTask(db, task.id, saved)
  assert.equal(childrenOf(db, task.id).length, 1)
  assert.equal(childrenOf(db, task.id)[0].id, child.id)
  db.close()
})

test('editing a recurring parent after its child exists changes neither that child nor the chain', () => {
  const db = openTaskDb()
  const task = createTask(db, fullInput('Weekly tidy-up', recurrence('weekly'), '2026-10-26'))
  setTaskStatus(db, task.id, 'done')
  const child = listTasks(db).find((item) => item.parentTaskId === task.id)
  assert.ok(child)
  // the parent is edited hard: new title, notes, due date, priority, tags and rule
  updateTask(db, task.id, fullInput('Tidy up', recurrence('monthly'), '2026-10-19', {
    status: 'done' as const, notes: 'edited', priority: 'low' as const, project: 'Work', tags: ['new']
  }))
  const afterEdit = listTasks(db).find((item) => item.id === child.id)
  assert.ok(afterEdit)
  assert.equal(afterEdit.title, 'Weekly tidy-up')
  assert.equal(afterEdit.notes, '')
  assert.equal(afterEdit.dueDate, '2026-11-02')
  assert.deepEqual(afterEdit.recurrence, recurrence('weekly'))
  assert.deepEqual(afterEdit.tags, [])
  // even reopening and re-completing the parent creates no second child
  setTaskStatus(db, task.id, 'todo')
  setTaskStatus(db, task.id, 'done')
  assert.equal(childrenOf(db, task.id).length, 1)
  // completing the child advances the chain on the rule copied at its creation,
  // not on the parent's new monthly rule
  setTaskStatus(db, child.id, 'done')
  const grandchild = listTasks(db).find((item) => item.parentTaskId === child.id)
  assert.ok(grandchild)
  assert.equal(grandchild.dueDate, '2026-11-09')
  // and every row of the chain holds at most its one child: no forks anywhere
  for (const row of listTasks(db)) assert.equal(childrenOf(db, row.id).length <= 1, true)
  db.close()
})

test('deleting the parent unlinks the child, which continues the series on its own rule', () => {
  const db = openTaskDb()
  const task = createTask(db, fullInput('Water plants', recurrence('weekly'), '2026-10-26'))
  setTaskStatus(db, task.id, 'done')
  const child = listTasks(db).find((item) => item.parentTaskId === task.id)
  assert.ok(child)
  deleteTask(db, task.id)
  const kept = listTasks(db).find((item) => item.id === child.id)
  assert.ok(kept)
  assert.equal(kept.parentTaskId, null)
  assert.equal(kept.status, 'todo')
  assert.equal(kept.dueDate, '2026-11-02')
  // the orphaned occurrence is now an ordinary recurring task
  setTaskStatus(db, kept.id, 'done')
  const next = childrenOf(db, kept.id)
  assert.equal(next.length, 1)
  assert.equal(next[0].dueDate, '2026-11-09')
  db.close()
})

test('backup export/import round trips recurrence links and spawns nothing extra on import', () => {
  const source = openTaskDb()
  const task = createTask(source, fullInput('Water plants', recurrence('weekly'), '2026-10-26', { notes: 'Careful', tags: ['plants'], subtasks: [{ title: 'Fill can', done: true }, { title: 'Water', done: false }] }))
  setTaskStatus(source, task.id, 'done')
  const child = listTasks(source).find((item) => item.parentTaskId === task.id)
  assert.ok(child)
  setTaskStatus(source, child.id, 'done')
  const grandchild = listTasks(source).find((item) => item.parentTaskId === child.id)
  assert.ok(grandchild)

  const parsed = parseBackup(JSON.stringify(collectBackup(source)), MIGRATIONS.length)
  const target = openTaskDb()
  // a database with unrelated data is fully replaced, not merged
  void createTask(target, fullInput('Stray', null, null))
  restoreBackup(target, parsed)
  assert.deepEqual(listTasks(target).map((t) => t.id).sort((a, b) => a - b), [task.id, child.id, grandchild.id])
  // original ids are kept (not remapped), so the links point at the very same rows
  const loaded = listTasks(target)
  const restoredChild = loaded.find((t) => t.id === child.id)
  assert.ok(restoredChild)
  assert.equal(restoredChild.parentTaskId, task.id)
  assert.equal(restoredChild.dueDate, '2026-11-02')
  assert.deepEqual(restoredChild.recurrence, recurrence('weekly'))
  const restoredParent = loaded.find((t) => t.id === task.id)
  assert.ok(restoredParent)
  assert.equal(restoredParent.status, 'done')
  assert.deepStrictEqual(restoredChild.subtasks.map((s) => s.title), ['Fill can', 'Water'])
  // importing again is idempotent: same rows, still exactly one child per parent
  restoreBackup(target, parsed)
  assert.deepEqual(listTasks(target).map((t) => t.id).sort((a, b) => a - b), [task.id, child.id, grandchild.id])
  for (const row of listTasks(target)) assert.equal(childrenOf(target, row.id).length <= 1, true)
  // and the restored chain still behaves by the rule, one link per completion
  setTaskStatus(target, grandchild.id, 'done')
  const next = childrenOf(target, grandchild.id)
  assert.equal(next.length, 1)
  assert.equal(next[0].dueDate, '2026-11-16')
  target.close()
})

// ---- task editor input validation (src/shared/tasks.ts) ----

const validTaskInput = {
  title: 'Water plants', notes: '', status: 'todo', priority: 'medium', dueDate: null,
  project: null, tags: [], recurrence: null, parentTaskId: null, subtasks: []
} as unknown as Parameters<typeof taskInputProblems>[0]

test('task input validation returns one exact, visible fix per bad field', () => {
  assert.deepEqual(taskInputProblems(validTaskInput), {})
  const bad = taskInputProblems({ ...validTaskInput, title: '   ', status: 'later', priority: 'urgent', dueDate: '2026-02-30',
    recurrence: { frequency: 'hourly', intervalDays: 1 }, tags: 'work', subtasks: 'kit', parentTaskId: -2 } as never)
  assert.deepEqual(bad, {
    title: 'Give the task a title.',
    status: 'Choose a valid task status.',
    priority: 'Choose a valid task priority.',
    dueDate: 'Due date must be a real calendar date, like 2026-10-25.',
    recurrence: 'Choose a valid recurrence.',
    tags: 'Tags must be a list of tag names.',
    subtasks: 'Subtasks must be a list of checklist items with a title each.',
    parentTaskId: 'Parent task id is invalid.'
  })
})

test('custom recurrence interval bounds are refused with an exact fix', () => {
  const withCustom = (intervalDays: number) =>
    taskInputProblems({ ...validTaskInput, recurrence: { frequency: 'custom', intervalDays } } as unknown as never)
  assert.equal(withCustom(0).recurrence, 'Custom repeat must be between 1 and 3650 days.')
  assert.equal(withCustom(3651).recurrence, 'Custom repeat must be between 1 and 3650 days.')
  assert.deepEqual(withCustom(90), {})
})

test('an impossible due date is refused; a past one stays allowed because overdue tasks are a real view', () => {
  assert.deepEqual(taskInputProblems({ ...validTaskInput, dueDate: '2025-10-25' } as unknown as never), {})
  assert.ok(taskInputProblems({ ...validTaskInput, dueDate: '2026-02-30' } as unknown as never).dueDate)
  assert.ok(taskInputProblems({ ...validTaskInput, dueDate: 'not-a-date' } as unknown as never).dueDate)
})

console.log(`\n${n} task checks passed`)
