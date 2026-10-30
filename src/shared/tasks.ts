// Task rules as plain functions, with calendar dates kept as YYYY-MM-DD text.
import type { Task, TaskDashboard, TaskFilter, TaskStatus, TaskView } from './types'

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

export function nextTaskDate(date: string, recurrence: Task['recurrence']): string | null {
  if (!recurrence) return null
  if (recurrence.frequency === 'daily') return addTaskDays(date, 1)
  if (recurrence.frequency === 'weekly') return addTaskDays(date, 7)
  if (recurrence.frequency === 'monthly') return addTaskMonths(date, 1)
  return addTaskDays(date, recurrence.intervalDays)
}

export function taskMatchesView(task: Task, view: TaskView, today: string): boolean {
  if (view === 'completed') return task.status === 'done'
  if (task.status === 'done') return false
  if (view === 'today') return task.dueDate === today
  if (view === 'upcoming') return task.dueDate !== null && task.dueDate > today
  if (view === 'overdue') return task.dueDate !== null && task.dueDate < today
  return true
}

export function taskReview(tasks: Task[], start: string, end: string): { created: number; completed: number } {
  const onDay = (value: string | null): boolean => {
    if (!value) return false
    const date = value.length === 10 ? value : localDay(value)
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

export function filterTasks(tasks: Task[], filter: TaskFilter, today: string): Task[] {
  return tasks.filter((task) => taskMatchesView(task, filter.view ?? 'all', today)
    && (!filter.priority || task.priority === filter.priority)
    && (!filter.project || task.project === filter.project)
    && (!filter.tag || task.tags.includes(filter.tag))
    && taskMatchesText(task, filter.text ?? ''))
}

// The board shows the same filtered tasks as the list, split into its three status columns.
// Keeping the split here means both views are checked against one function, not two copies of the rules.
export function groupTasksForBoard(tasks: Task[], filter: TaskFilter, today: string): Record<TaskStatus, Task[]> {
  const visible = filterTasks(tasks, filter, today)
  return {
    'todo': visible.filter((task) => task.status === 'todo'),
    'in-progress': visible.filter((task) => task.status === 'in-progress'),
    'done': visible.filter((task) => task.status === 'done')
  }
}

// Puts `orderedIds` into the slots those tasks already occupy, leaving every other task where it was.
// Used when a column is reordered: the saved order is global, so untouched columns keep their places.
export function applyColumnOrder(taskIds: number[], orderedIds: number[]): number[] {
  const moving = new Set(orderedIds)
  const queue = [...orderedIds]
  return taskIds.map((id) => (moving.has(id) ? queue.shift()! : id))
}

function localDay(isoTimestamp: string | null): string | null {
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
  const active = tasks.filter((task) => task.status !== 'done')
  return {
    dueToday: active.filter((task) => task.dueDate === today).length,
    overdue: active.filter((task) => task.dueDate !== null && task.dueDate < today).length,
    completedThisWeek: tasks.filter((task) => {
      const day = localDay(task.completedAt)
      return task.status === 'done' && day !== null && day >= weekStart && day <= weekEnd
    }).length
  }
}
