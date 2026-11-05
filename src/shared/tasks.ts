// Task rules as plain functions, with calendar dates kept as YYYY-MM-DD text.
import type { Task, TaskDashboard, TaskFilter, TaskInput, TaskPriority, TaskSort, TaskStatus, TaskView } from './types'

const DAY_MS = 86_400_000
const toUtc = (iso: string): number => {
  const [y, m, d] = iso.split('-').map(Number)
  return Date.UTC(y, m - 1, d)
}
const fromUtc = (n: number): string => new Date(n).toISOString().slice(0, 10)

export function addTaskDays(date: string, days: number): string {
  return fromUtc(toUtc(date) + days * DAY_MS)
}

// Calendar-month arithmetic clamps to the last valid day (Jan 31 -> Feb 28/29).
export function addTaskMonths(date: string, months: number): string {
  const [year, month, day] = date.split('-').map(Number)
  const first = new Date(Date.UTC(year, month - 1 + months, 1))
  const last = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate()
  first.setUTCDate(Math.min(day, last))
  return first.toISOString().slice(0, 10)
}

export function nextTaskDate(date: string, recurrence: Task['recurrenceRule'], anchorDate = date): string | null {
  if (!recurrence) return null
  if (recurrence.frequency === 'daily') return addTaskDays(date, 1)
  if (recurrence.frequency === 'weekly') return addTaskDays(date, 7)
  if (recurrence.frequency === 'monthly') {
    const [anchorYear, anchorMonth] = anchorDate.split('-').map(Number)
    const [year, month] = date.split('-').map(Number)
    const monthOffset = (year - anchorYear) * 12 + month - anchorMonth + 1
    return addTaskMonths(anchorDate, Math.max(1, monthOffset))
  }
  return addTaskDays(date, recurrence.intervalDays)
}

export function nextTaskDateAfter(date: string, recurrence: Task['recurrenceRule'], anchorDate: string, today: string): string | null {
  let next = nextTaskDate(date, recurrence, anchorDate)
  while (next !== null && next <= today && recurrence !== null) next = nextTaskDate(next, recurrence, anchorDate)
  return next
}

export function taskMatchesView(task: Task, view: TaskView, today: string, nowTime = '00:00'): boolean {
  if (view === 'trash') return task.deletedAt !== null
  if (task.deletedAt !== null) return false
  if (view === 'completed') return task.status === 'done'
  if (task.status === 'done') return false
  const due = task.recurrenceNext ?? task.dueDate
  if (view === 'today') return due === null || due === today
  if (view === 'upcoming') return due === null || (due > today && due <= addTaskDays(today, 7))
  if (view === 'overdue') return due !== null && (due < today || (due === today && task.dueTime !== null && task.dueTime < nowTime))
  return true
}

export function taskReview(tasks: Task[], start: string, end: string): { created: number; completed: number } {
  const onDay = (value: string | null): boolean => {
    if (!value) return false
    const date = value.length === 10 ? value : localTaskDay(value)
    return date !== null && date >= start && date <= end
  }
  return {
    created: tasks.filter((task) => onDay(task.createdAt)).length,
    completed: tasks.filter((task) => task.status === 'done' && onDay(task.completedAt)).length
  }
}

// Free-text search over everything a task shows: title, notes, project, tags and checklist lines.
export function taskMatchesText(task: Task, text: string): boolean {
  const needle = text.trim().toLowerCase()
  if (!needle) return true
  return [task.title, task.notes, task.project ?? '', ...task.tags, ...task.subtasks.map((subtask) => subtask.title)]
    .some((value) => value.toLowerCase().includes(needle))
}

export function filterTasks(tasks: Task[], filter: TaskFilter, today: string, nowTime = '00:00'): Task[] {
  return tasks.filter((task) => taskMatchesView(task, filter.view ?? 'all', today, nowTime)
    && (!filter.priority || task.priority === filter.priority)
    && (!filter.project || task.project === filter.project)
    && (!filter.tag || task.tags.includes(filter.tag))
    && taskMatchesText(task, filter.text ?? ''))
}

// Resolve recurring-task instances at read time. A task with a recurrenceRule and a
// recurrenceNext on or before today is treated as due now; when its status is 'done'
// the occurrence is advanced to the next date and the task returns to 'todo'.
// Returns a new array; the original task objects are not mutated.
export function resolveOccurrences(tasks: Task[], today: string): Task[] {
  return tasks.map((task) => {
    if (!task.recurrenceRule || task.recurrenceNext === null || task.recurrenceNext > today) return task
    if (task.status === 'done') {
      return {
        ...task, status: 'todo', completedAt: null,
        subtasks: task.subtasks.map((subtask) => ({ ...subtask, done: false }))
      }
    }
    return task
  })
}

// The one overdue rule, shared by the list rows and the board cards: a task is
// overdue when its (active) due day has passed, or it is due today with a time
// that has already gone. Done tasks are never overdue.
export function taskIsOverdue(task: Task, today: string, nowTime: string): boolean {
  if (task.status === 'done') return false
  const due = task.recurrenceNext ?? task.dueDate
  return due !== null && (due < today || (due === today && task.dueTime !== null && task.dueTime < nowTime))
}

// The board shows the same filtered tasks as the list, split into its three status columns.
// Keeping the split here means both views are checked against one function, not two copies of the rules.
export function groupTasksForBoard(tasks: Task[], filter: TaskFilter, today: string, nowTime = '00:00'): Record<TaskStatus, Task[]> {
  const visible = filterTasks(tasks, filter, today, nowTime)
  return {
    'todo': visible.filter((task) => task.status === 'todo'),
    'in-progress': visible.filter((task) => task.status === 'in-progress'),
    'done': visible.filter((task) => task.status === 'done')
  }
}

export function sortTasks(tasks: Task[], sort: TaskSort): Task[] {
  const priority: Record<TaskPriority, number> = { high: 0, medium: 1, low: 2 }
  return [...tasks].sort((a, b) => {
    if (sort === 'due-date') {
      const dueA = a.recurrenceNext ?? a.dueDate
      const dueB = b.recurrenceNext ?? b.dueDate
      if (dueA === null && dueB !== null) return 1
      if (dueA !== null && dueB === null) return -1
      if (dueA !== dueB) return (dueA ?? '').localeCompare(dueB ?? '')
    } else if (sort === 'priority' && priority[a.priority] !== priority[b.priority]) {
      return priority[a.priority] - priority[b.priority]
    }
    return a.position - b.position || a.id - b.id
  })
}

export function subtaskProgress(subtasks: Pick<Task['subtasks'][number], 'done'>[]): { done: number; total: number; percent: number } {
  const done = subtasks.filter((item) => item.done).length
  return { done, total: subtasks.length, percent: subtasks.length === 0 ? 0 : Math.round(done / subtasks.length * 100) }
}

export function pendingTaskReminders(tasks: Task[], today: string, nowTime: string, graceMinutes = 10): Task[] {
  const now = Number(nowTime.slice(0, 2)) * 60 + Number(nowTime.slice(3, 5))
  return tasks.filter((task) => {
    const due = task.recurrenceNext ?? task.dueDate
    if (task.deletedAt !== null || task.status === 'done' || due !== today || task.dueTime === null) return false
    const dueMinutes = Number(task.dueTime.slice(0, 2)) * 60 + Number(task.dueTime.slice(3, 5))
    const sinceDue = now - dueMinutes
    return sinceDue >= 0 && sinceDue <= graceMinutes
  })
}

export type TaskInlinePatch = Partial<Omit<TaskInput, 'subtasks'>>

export function taskInputForEdit(task: Task, patch: TaskInlinePatch = {}): TaskInput {
  const input: TaskInput = {
    title: task.title, notes: task.notes, status: task.status, priority: task.priority,
    dueDate: task.dueDate, dueTime: task.dueTime, project: task.project, tags: task.tags,
    recurrenceRule: task.recurrenceRule, recurrenceNext: task.recurrenceNext,
    subtasks: task.subtasks.map(({ title, done }) => ({ title, done })),
    ...patch
  }
  if ('dueDate' in patch) {
    if (task.recurrenceRule) {
      input.dueDate = task.dueDate
      input.recurrenceNext = patch.dueDate ?? null
    } else {
      input.recurrenceNext = null
    }
  }
  return {
    ...input
  }
}

// Puts `orderedIds` into the slots those tasks already occupy, leaving every other task where it was.
// Used when a column is reordered: the saved order is global, so untouched columns keep their places.
export function applyColumnOrder(taskIds: number[], orderedIds: number[]): number[] {
  const moving = new Set(orderedIds)
  const queue = [...orderedIds]
  return taskIds.map((id) => (moving.has(id) ? queue.shift()! : id))
}

export function localTaskDay(isoTimestamp: string | null): string | null {
  if (!isoTimestamp) return null
  const date = new Date(isoTimestamp)
  if (Number.isNaN(date.getTime())) return null
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

export function taskWeekStart(date: string): string {
  const day = (new Date(toUtc(date)).getUTCDay() + 6) % 7
  return addTaskDays(date, -day)
}

export function taskDashboard(tasks: Task[], today: string): TaskDashboard {
  const weekStart = taskWeekStart(today)
  const weekEnd = addTaskDays(weekStart, 6)
  const active = tasks.filter((task) => task.status !== 'done' && task.deletedAt === null)
  return {
    dueToday: active.filter((task) => {
      const due = task.recurrenceNext ?? task.dueDate
      return due !== null && due === today
    }).length,
    overdue: active.filter((task) => {
      const due = task.recurrenceNext ?? task.dueDate
      return due !== null && due < today
    }).length,
    completedThisWeek: tasks.filter((task) => {
      const day = localTaskDay(task.completedAt)
      return task.status === 'done' && task.deletedAt === null && day !== null && day >= weekStart && day <= weekEnd
    }).length
  }
}

// ---------- Task input validation ----------
// One plain, actionable message per bad field (empty object = fine). The task editor shows
// each message next to its field, and the main process throws the first one, so the UI and
// the database layer run identical rules from this one function. Past due dates stay allowed:
// an overdue task is a real state here (the Overdue view).
export type TaskField = 'title' | 'status' | 'priority' | 'dueDate' | 'dueTime' | 'recurrenceRule' | 'tags' | 'subtasks'
// The order messages surface in; the first bad field is the one the editor focuses.
export const TASK_FIELD_ORDER: TaskField[] = ['title', 'status', 'priority', 'dueDate', 'dueTime', 'recurrenceRule', 'tags', 'subtasks']

export function taskInputProblems(input: TaskInput): Partial<Record<TaskField, string>> {
  const problems: Partial<Record<TaskField, string>> = {}
  if (typeof input.title !== 'string' || !input.title.trim()) problems.title = 'Give the task a title.'
  if (!['todo', 'in-progress', 'done'].includes(String(input.status))) problems.status = 'Choose a valid task status.'
  if (!['low', 'medium', 'high'].includes(String(input.priority))) problems.priority = 'Choose a valid task priority.'
  if (input.dueDate !== null) {
    const [year, month, day] = typeof input.dueDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(input.dueDate)
      ? input.dueDate.split('-').map(Number) : [NaN, NaN, NaN]
    const date = new Date(year, month - 1, day)
    if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day)
      problems.dueDate = 'Due date must be a real calendar date, like 2026-10-25.'
  }
  const dueTime = input.dueTime
  if (dueTime !== null && dueTime !== undefined && dueTime !== '') {
    if (!/^\d{2}:\d{2}$/.test(dueTime))
      problems.dueTime = 'Due time must be HH:MM, like 14:00.'
    else {
      const [h, m] = dueTime.split(':').map(Number)
      if (h < 0 || h > 23 || m < 0 || m > 59)
        problems.dueTime = 'Due time must be between 00:00 and 23:59.'
    }
  }

  const recurrenceRule = input.recurrenceRule
  if (recurrenceRule !== null && recurrenceRule !== undefined) {
    if (typeof recurrenceRule !== 'object' || !['daily', 'weekly', 'monthly', 'custom'].includes(String(recurrenceRule.frequency)))
      problems.recurrenceRule = 'Choose a valid recurrence.'
    else if (recurrenceRule.frequency === 'custom' &&
      (!Number.isInteger(recurrenceRule.intervalDays) || recurrenceRule.intervalDays < 1 || recurrenceRule.intervalDays > 3650))
      problems.recurrenceRule = 'Custom repeat must be between 1 and 3650 days.'
  }
  if (!Array.isArray(input.tags) || !(input.tags as unknown[]).every((tag: unknown) => typeof tag === 'string'))
    problems.tags = 'Tags must be a list of tag names.'
  if (!Array.isArray(input.subtasks) ||
    !(input.subtasks as unknown[]).every((subtask: unknown) =>
      subtask !== null && typeof subtask === 'object' && typeof (subtask as { title: unknown }).title === 'string'))
    problems.subtasks = 'Subtasks must be a list of checklist items with a title each.'

  return problems
}
