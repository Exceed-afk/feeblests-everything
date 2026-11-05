// The Tasks board: the same filtered tasks as the list, grouped by status. Cards can be dragged
// between columns (which changes status) and within a column (which saves the order).
import { useState } from 'react'
import { CalendarDays, ListChecks, SkipForward } from 'lucide-react'
import type { Task, TaskFilter, TaskPriority, TaskSort, TaskStatus } from '../../../shared/types'
import type { TaskInlinePatch } from '../../../shared/tasks'
import { applyColumnOrder, groupTasksForBoard, sortTasks, taskIsOverdue } from '../../../shared/tasks'
import { formatDate } from '../lib/dates'
import { errMsg } from '../lib/errors'
import { EmptyState } from '../components/EmptyState'

const COLUMNS: { status: TaskStatus; label: string }[] = [
  { status: 'todo', label: 'To do' },
  { status: 'in-progress', label: 'In progress' },
  { status: 'done', label: 'Done' }
]

interface Props {
  tasks: Task[] // every task, in the app's saved order
  filter: TaskFilter // the same filter object the list uses
  today: string
  nowTime: string
  sort: TaskSort
  loaded: boolean
  refresh: () => Promise<void>
  onOptimistic: (tasks: Task[]) => void
  onInline: (task: Task, patch: TaskInlinePatch) => void
  onSkip: (task: Task) => void
  onEdit: (task: Task) => void
  onNew: () => void
  onError: (message: string) => void
}

export function TaskBoard({ tasks, filter, today, nowTime, sort, loaded, refresh, onOptimistic, onInline, onSkip, onEdit, onNew, onError }: Props) {
  const [dragId, setDragId] = useState<number | null>(null)
  const [overColumn, setOverColumn] = useState<TaskStatus | null>(null)
  const [busy, setBusy] = useState(false)
  const grouped = groupTasksForBoard(tasks, filter, today, nowTime)
  const columns = {
    todo: sortTasks(grouped.todo, sort),
    'in-progress': sortTasks(grouped['in-progress'], sort),
    done: sortTasks(grouped.done, sort)
  }

  const move = async (id: number, status: TaskStatus) => {
    if (busy) return
    const task = tasks.find((t) => t.id === id)
    if (!task || task.status === status) return
    const snapshot = tasks
    onOptimistic(tasks.map((item) => item.id === id ? { ...item, status, completedAt: status === 'done' ? new Date().toISOString() : null } : item))
    setBusy(true)
    try { await window.api.tasks.setStatus(id, status); await refresh() }
    catch (e) { onOptimistic(snapshot); onError(errMsg(e)) }
    setBusy(false)
  }

  const dropOnCard = async (target: Task) => {
    const id = dragId
    setDragId(null); setOverColumn(null)
    if (id === null || id === target.id) return
    const source = tasks.find((t) => t.id === id)
    if (!source) return
    if (source.status !== target.status) { await move(id, target.status); return }
    if (sort !== 'manual') return
    const column = columns[source.status]
    const ids = column.map((t) => t.id)
    const from = ids.indexOf(id), to = ids.indexOf(target.id)
    if (from < 0 || to < 0 || from === to) return
    const ordered = [...ids]
    ordered.splice(to, 0, ordered.splice(from, 1)[0])
    const reorderedIds = applyColumnOrder(tasks.map((task) => task.id), ordered)
    const positions = new Map(reorderedIds.map((taskId, index) => [taskId, index]))
    const snapshot = tasks
    onOptimistic(tasks.map((task) => ({ ...task, position: positions.get(task.id) ?? task.position })).sort((a, b) => a.position - b.position))
    setBusy(true)
    try { await window.api.tasks.reorder(reorderedIds); await refresh() }
    catch (e) { onOptimistic(snapshot); onError(errMsg(e)) }
    setBusy(false)
  }

  const dropOnColumn = async (status: TaskStatus) => {
    const id = dragId
    setDragId(null); setOverColumn(null)
    if (id !== null) await move(id, status)
  }

  // Alt + Left/Right moves a focused card between columns, for people not using a mouse.
  const moveByKeyboard = (task: Task, delta: number) => {
    const next = COLUMNS[COLUMNS.findIndex((c) => c.status === task.status) + delta]
    if (next) void move(task.id, next.status)
  }

  const visible = COLUMNS.reduce((total, column) => total + columns[column.status].length, 0)

  return (
    <div className="flex flex-col gap-4">
      {loaded && tasks.length === 0 && <EmptyState icon={ListChecks} title="A clear board is a good place to begin."
        text="Add one small thing you would like to get done."
        action={<button className="btn-primary" onClick={onNew}><ListChecks size={16} /> Create a task</button>} />}
      {loaded && tasks.length > 0 && visible === 0 && <EmptyState title="Nothing in this board view."
        text="Try another view, search term, or clear a filter." />}
      <div className="grid gap-3 md:grid-cols-3">
      {COLUMNS.map(({ status, label }) => {
        const list = columns[status]
        return (
          <section key={status} aria-label={`${label} column`}
            onDragOver={(e) => { e.preventDefault(); if (dragId !== null) setOverColumn(status) }}
            onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOverColumn((current) => (current === status ? null : current)) }}
            onDrop={(e) => { e.preventDefault(); void dropOnColumn(status) }}
            className={`card card-pad-sm flex min-h-[14rem] flex-col gap-2 ${overColumn === status ? 'border-accent ring-1 ring-accent' : ''}`}>
            <header className="flex items-center justify-between">
              <h2 className="text-sm font-semibold">{label}</h2>
              <span className="badge badge-muted">{list.length}</span>
            </header>
            {list.length === 0 && <p className="rounded-lg border border-dashed border-line px-3 py-6 text-center text-xs text-muted">Nothing here</p>}
            {list.map((task) => {
              const due = task.recurrenceNext ?? task.dueDate
              const overdue = taskIsOverdue(task, today, nowTime)
              const doneSubtasks = task.subtasks.filter((s) => s.done).length
              return (
                <article key={task.id} draggable={!busy}
                  onDragStart={(e) => { setDragId(task.id); e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', String(task.id)) }}
                  onDragEnd={() => { setDragId(null); setOverColumn(null) }}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => { e.preventDefault(); e.stopPropagation(); void dropOnCard(task) }}
                  onKeyDown={(e) => {
                    if (e.altKey && e.key === 'ArrowLeft') { e.preventDefault(); moveByKeyboard(task, -1) }
                    if (e.altKey && e.key === 'ArrowRight') { e.preventDefault(); moveByKeyboard(task, 1) }
                  }}
                  aria-label={`${task.title}, ${task.priority} priority${task.dueDate ? `, due ${formatDate(task.dueDate)}` : ''}. Enter to edit, Alt with Left or Right to move between columns.`}
                  className={`card card-pad-sm card-interactive w-full text-left ${dragId === task.id ? 'opacity-60' : ''}`}>
                  <button type="button" className={`block w-full text-left text-sm font-medium ${task.status === 'done' ? 'text-muted line-through' : ''}`}
                    onClick={() => onEdit(task)}>{task.title}</button>
                  <span className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted">
                    <select className="field w-24 py-1 text-xs" aria-label={`Priority for ${task.title}`} value={task.priority}
                      onClick={(e) => e.stopPropagation()} onChange={(e) => onInline(task, { priority: e.target.value as TaskPriority })}>
                      <option value="high">High</option><option value="medium">Medium</option><option value="low">Low</option>
                    </select>
                    {due && <span className={`flex items-center gap-1 ${overdue ? 'text-neg font-medium' : ''}`}><CalendarDays size={12} />{overdue ? 'Overdue · ' : ''}{formatDate(due)}{task.dueTime ? ` · ${task.dueTime}` : ''}</span>}
                  </span>
                  <div className="mt-2 flex flex-wrap items-center gap-2" onClick={(e) => e.stopPropagation()}>
                    <input type="date" className="field w-36 py-1 text-xs" aria-label={`Due date for ${task.title}`}
                      value={task.recurrenceNext ?? task.dueDate ?? ''} onChange={(e) => onInline(task, { dueDate: e.target.value || null })} />
                    <input className="field w-28 py-1 text-xs" aria-label={`Project for ${task.title}`} placeholder="Project"
                      defaultValue={task.project ?? ''} onBlur={(e) => { if (e.target.value !== (task.project ?? '')) onInline(task, { project: e.target.value || null }) }} />
                    {task.recurrenceRule && <button className="btn btn-sm" aria-label={`Skip next occurrence of ${task.title}`}
                      onClick={() => onSkip(task)}><SkipForward size={14} /> Skip</button>}
                    <button className="btn btn-sm" aria-label={`Edit ${task.title}`} onClick={() => onEdit(task)}>Edit</button>
                  </div>
                  {task.subtasks.length > 0 && (
                    <span className="mt-2 block">
                      <span className="flex items-center gap-1 text-xs text-muted"><ListChecks size={12} />{doneSubtasks}/{task.subtasks.length} checklist</span>
                      <span className="mt-1 block h-1 w-full overflow-hidden rounded-full bg-line" role="progressbar"
                        aria-valuemin={0} aria-valuemax={task.subtasks.length} aria-valuenow={doneSubtasks} aria-label="Checklist progress">
                        <span className="block h-full bg-accent" style={{ width: `${(doneSubtasks / task.subtasks.length) * 100}%` }} />
                      </span>
                    </span>
                  )}
                </article>
              )
            })}
          </section>
        )
      })}
      </div>
    </div>
  )
}
