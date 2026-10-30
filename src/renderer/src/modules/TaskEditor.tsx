import { useState } from 'react'
import { X } from 'lucide-react'
import type { Task, TaskInput, TaskPriority, TaskRecurrence, TaskStatus } from '../../../shared/types'
import { errMsg } from '../lib/errors'

interface Props { task: Task | null; onClose: () => void; onSaved: () => void }

const normalizeTags = (value: string): string[] => [...new Set(value.split(/[\s,]+/)
  .map((tag) => tag.trim().replace(/^#+/, '').toLowerCase())
  .filter(Boolean))]

const normalizeSubtasks = (value: string): { title: string; done: boolean }[] => value
  .split(/\r?\n/)
  .map((line) => line.trim())
  .filter(Boolean)
  .map((line) => {
    const done = /^\s*\[x\]\s*/i.test(line)
    return { title: line.replace(/^\s*\[x\]\s*/i, '').trim(), done }
  })
  .filter((subtask) => subtask.title)

export function TaskEditor({ task, onClose, onSaved }: Props) {
  const [title, setTitle] = useState(task?.title ?? '')
  const [notes, setNotes] = useState(task?.notes ?? '')
  const [dueDate, setDueDate] = useState(task?.dueDate ?? '')
  const [priority, setPriority] = useState<TaskPriority>(task?.priority ?? 'medium')
  const [status, setStatus] = useState<TaskStatus>(task?.status ?? 'todo')
  const [project, setProject] = useState(task?.project ?? '')
  const [tags, setTags] = useState(task?.tags.join(', ') ?? '')
  const [subtasks, setSubtasks] = useState(task?.subtasks.map((s) => `${s.done ? '[x] ' : ''}${s.title}`).join('\n') ?? '')
  const [frequency, setFrequency] = useState<TaskRecurrence['frequency'] | 'none'>(task?.recurrence?.frequency ?? 'none')
  const [interval, setInterval] = useState(String(task?.recurrence?.intervalDays ?? 2))
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const save = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!title.trim() || busy) return
    const recurrence: TaskRecurrence | null = frequency === 'none' ? null : {
      frequency, intervalDays: frequency === 'custom' ? Math.max(1, Number(interval) || 1) : 1
    }
    const input: TaskInput = {
      title, notes, dueDate: dueDate || null, priority, status, project, tags: normalizeTags(tags), recurrence,
      parentTaskId: task?.parentTaskId ?? null,
      subtasks: normalizeSubtasks(subtasks)
    }
    setBusy(true)
    try {
      if (task) await window.api.tasks.update(task.id, input)
      else await window.api.tasks.create(input)
      onSaved()
    } catch (e) { setError(errMsg(e)); setBusy(false) }
  }

  return (
    <div className="fixed inset-0 z-10 flex justify-end bg-bg/70" onMouseDown={onClose}>
      <aside role="dialog" aria-modal="true" aria-labelledby="task-editor-title" onMouseDown={(e) => e.stopPropagation()}
        className="flex h-full w-[min(34rem,100%)] flex-col overflow-y-auto border-l border-line bg-panel p-6 shadow-card">
        <form className="flex min-h-full flex-col gap-4" onSubmit={save}>
          <div className="flex items-center justify-between">
            <h2 id="task-editor-title" className="text-lg font-semibold">{task ? 'Edit task' : 'New task'}</h2>
            <button type="button" className="btn-icon" onClick={onClose} aria-label="Close task editor"><X size={18} /></button>
          </div>
          <label className="flex flex-col text-xs text-muted">Title
            <input className="field mt-1" required autoFocus value={title} onChange={(e) => setTitle(e.target.value)} placeholder="What needs doing?" />
          </label>
          <label className="flex flex-col text-xs text-muted">Notes
            <textarea className="field mt-1 min-h-20 resize-y" value={notes} onChange={(e) => setNotes(e.target.value)} />
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="flex flex-col text-xs text-muted">Due date
              <input type="date" className="field mt-1" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
            </label>
            <label className="flex flex-col text-xs text-muted">Priority
              <select className="field mt-1" value={priority} onChange={(e) => setPriority(e.target.value as TaskPriority)}>
                <option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option>
              </select>
            </label>
            <label className="flex flex-col text-xs text-muted">Status
              <select className="field mt-1" value={status} onChange={(e) => setStatus(e.target.value as TaskStatus)}>
                <option value="todo">To do</option><option value="in-progress">In progress</option><option value="done">Done</option>
              </select>
            </label>
            <label className="flex flex-col text-xs text-muted">Project
              <input className="field mt-1" value={project} onChange={(e) => setProject(e.target.value)} placeholder="Optional" />
            </label>
          </div>
          <label className="flex flex-col text-xs text-muted">Tags (comma or space separated)
            <input className="field mt-1" value={tags} onChange={(e) => setTags(e.target.value)} placeholder="work, errands" />
          </label>
          <label className="flex flex-col text-xs text-muted">Subtasks (one per line; prefix [x] for done)
            <textarea className="field mt-1 min-h-24 resize-y" value={subtasks} onChange={(e) => setSubtasks(e.target.value)} placeholder={'Book tickets\n[x] Check dates'} />
          </label>
          <div className="grid grid-cols-[1fr_7rem] gap-3">
            <label className="flex flex-col text-xs text-muted">Repeat
              <select className="field mt-1" value={frequency} onChange={(e) => setFrequency(e.target.value as typeof frequency)}>
                <option value="none">Does not repeat</option><option value="daily">Daily</option><option value="weekly">Weekly</option>
                <option value="monthly">Monthly</option><option value="custom">Every N days</option>
              </select>
            </label>
            {frequency === 'custom' && <label className="flex flex-col text-xs text-muted">Days
              <input type="number" className="field mt-1" min="1" max="3650" value={interval} onChange={(e) => setInterval(e.target.value)} />
            </label>}
          </div>
          {error && <p role="alert" className="text-sm text-neg">{error}</p>}
          <div className="mt-auto flex justify-end gap-2 pt-3">
            <button type="button" className="btn" onClick={onClose} disabled={busy}>Cancel</button>
            <button className="btn-primary" type="submit" disabled={busy || !title.trim()}>{busy ? 'Saving…' : 'Save task'}</button>
          </div>
        </form>
      </aside>
    </div>
  )
}
