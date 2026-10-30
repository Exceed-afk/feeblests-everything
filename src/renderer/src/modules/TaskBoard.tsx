// The Tasks board: the same filtered tasks as the list, grouped by status. Cards can be dragged
// between columns (which changes status) and within a column (which saves the order).
import { useState } from 'react'
import { CalendarDays, ListChecks } from 'lucide-react'
import type { Task, TaskFilter, TaskStatus } from '../../../shared/types'
import { applyColumnOrder, groupTasksForBoard } from '../../../shared/tasks'
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
  loaded: boolean
  refresh: () => Promise<void>
  onEdit: (task: Task) => void
  onNew: () => void
  onError: (message: string) => void
}

export function TaskBoard({ tasks, filter, today, loaded, refresh, onEdit, onNew, onError }: Props) {
  const [dragId, setDragId] = useState<number | null>(null)
  const [overColumn, setOverColumn] = useState<TaskStatus | null>(null)
  const [busy, setBusy] = useState(false)
  const columns = groupTasksForBoard(tasks, filter, today)

  const move = async (id: number, status: TaskStatus) => {
    if (busy) return
    const task = tasks.find((t) => t.id === id)
    if (!task || task.status === status) return
    setBusy(true)
    try { await window.api.tasks.setStatus(id, status); await refresh() }
    catch (e) { onError(errMsg(e)) }
    setBusy(false)
  }

  const dropOnCard = async (target: Task) => {
    const id = dragId
    setDragId(null); setOverColumn(null)
    if (id === null || id === target.id) return
    const source = tasks.find((t) => t.id === id)
    if (!source) return
    if (source.status !== target.status) { await move(id, target.status); return }
    const column = columns[source.status]
    const ids = column.map((t) => t.id)
    const from = ids.indexOf(id), to = ids.indexOf(target.id)
    if (from < 0 || to < 0 || from === to) return
    const ordered = [...ids]
    ordered.splice(to, 0, ordered.splice(from, 1)[0])
    setBusy(true)
    try { await window.api.tasks.reorder(applyColumnOrder(tasks.map((t) => t.id), ordered)); await refresh() }
    catch (e) { onError(errMsg(e)) }
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

  if (loaded && tasks.length === 0) {
    return <EmptyState icon={ListChecks} title="A clear board is a good place to begin."
      text="Add one small thing you would like to get done."
      action={<button className="btn-primary" onClick={onNew}><ListChecks size={16} /> Create a task</button>} />
  }

  const visible = COLUMNS.reduce((total, column) => total + columns[column.status].length, 0)
  if (loaded && visible === 0) {
    return <EmptyState title="No tasks match these filters." text="Try another view, search term, or clear a filter." />
  }

  return (
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
              const overdue = task.dueDate !== null && task.dueDate < today && task.status !== 'done'
              const doneSubtasks = task.subtasks.filter((s) => s.done).length
              return (
                <button key={task.id} type="button" draggable={!busy}
                  onDragStart={(e) => { setDragId(task.id); e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', String(task.id)) }}
                  onDragEnd={() => { setDragId(null); setOverColumn(null) }}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => { e.preventDefault(); e.stopPropagation(); void dropOnCard(task) }}
                  onClick={() => onEdit(task)}
                  onKeyDown={(e) => {
                    if (e.altKey && e.key === 'ArrowLeft') { e.preventDefault(); moveByKeyboard(task, -1) }
                    if (e.altKey && e.key === 'ArrowRight') { e.preventDefault(); moveByKeyboard(task, 1) }
                  }}
                  aria-label={`${task.title}, ${task.priority} priority${task.dueDate ? `, due ${formatDate(task.dueDate)}` : ''}. Enter to edit, Alt with Left or Right to move between columns.`}
                  className={`card card-pad-sm card-interactive w-full text-left ${dragId === task.id ? 'opacity-60' : ''}`}>
                  <span className={`block text-sm font-medium ${task.status === 'done' ? 'text-muted line-through' : ''}`}>{task.title}</span>
                  <span className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted">
                    <span className={`badge badge-${task.priority === 'high' ? 'neg' : 'muted'}`}>{task.priority}</span>
                    {task.dueDate && <span className={`flex items-center gap-1 ${overdue ? 'text-neg font-medium' : ''}`}><CalendarDays size={12} />{overdue ? 'Overdue · ' : ''}{formatDate(task.dueDate)}</span>}
                  </span>
                  {task.subtasks.length > 0 && (
                    <span className="mt-2 block">
                      <span className="flex items-center gap-1 text-xs text-muted"><ListChecks size={12} />{doneSubtasks}/{task.subtasks.length} checklist</span>
                      <span className="mt-1 block h-1 w-full overflow-hidden rounded-full bg-line" role="progressbar"
                        aria-valuemin={0} aria-valuemax={task.subtasks.length} aria-valuenow={doneSubtasks} aria-label="Checklist progress">
                        <span className="block h-full bg-accent" style={{ width: `${(doneSubtasks / task.subtasks.length) * 100}%` }} />
                      </span>
                    </span>
                  )}
                </button>
              )
            })}
          </section>
        )
      })}
    </div>
  )
}
