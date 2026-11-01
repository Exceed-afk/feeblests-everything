import { useEffect, useRef, useState } from 'react'
import { X } from 'lucide-react'
import type { Task, TaskInput, TaskPriority, TaskRecurrence, TaskStatus } from '../../../shared/types'
import { taskInputProblems, TASK_FIELD_ORDER, type TaskField } from '../../../shared/tasks'
import { errMsg } from '../lib/errors'
import { TagInput, addTag } from '../components/TagInput'

interface Props { task: Task | null; onClose: () => void; onSaved: () => void }

// Lines typed as "[x] Buy milk" become done checklist items; blank lines are ignored.
const parseSubtasks = (value: string): { title: string; done: boolean }[] => value
  .split(/\r?\n/)
  .map((line) => line.trim())
  .filter(Boolean)
  .map((line) => {
    const done = /^\s*\[x\]\s*/i.test(line)
    return { title: line.replace(/^\s*\[x\]\s*/i, '').trim(), done }
  })
  .filter((subtask) => subtask.title)

const repeatLabel = (frequency: TaskRecurrence['frequency'], intervalDays: number): string =>
  frequency === 'custom' ? `repeats every ${intervalDays} days` : `repeats ${frequency}`

type FieldElement = HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement

export function TaskEditor({ task, onClose, onSaved }: Props) {
  const [title, setTitle] = useState(task?.title ?? '')
  const [notes, setNotes] = useState(task?.notes ?? '')
  const [dueDate, setDueDate] = useState(task?.recurrenceNext ?? task?.dueDate ?? '')
  const [dueTime, setDueTime] = useState(task?.dueTime ?? '')
  const [priority, setPriority] = useState<TaskPriority>(task?.priority ?? 'medium')
  const [status, setStatus] = useState<TaskStatus>(task?.status ?? 'todo')
  const [project, setProject] = useState(task?.project ?? '')
  const [tags, setTags] = useState<string[]>(task?.tags ?? [])
  const [tagInput, setTagInput] = useState('')
  const [subtasks, setSubtasks] = useState(task?.subtasks.map((s) => `${s.done ? '[x] ' : ''}${s.title}`).join('\n') ?? '')
  const [frequency, setFrequency] = useState<TaskRecurrence['frequency'] | 'none'>(task?.recurrenceRule?.frequency ?? 'none')
  const [interval, setInterval] = useState(String(task?.recurrenceRule?.intervalDays ?? 2))
  // Advanced holds what is usually set once or never, so nothing standard stays hidden behind it
  // either: a task that already has any advanced field opens the section from the start.
  const [advancedOpen, setAdvancedOpen] = useState(() => Boolean(task &&
    (task.recurrenceRule || task.project || task.notes || task.tags.length > 0 || task.subtasks.length > 0)))
  const [busy, setBusy] = useState(false)
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<TaskField, string>>>({})
  const [saveError, setSaveError] = useState('')
  const [focusField, setFocusField] = useState<TaskField | null>(null)
  const fields = useRef<Partial<Record<TaskField, FieldElement | null>>>({})

  const input = (): TaskInput => ({
    title, notes,
    dueDate: task?.recurrenceRule && frequency !== 'none' ? task.dueDate : dueDate || null,
    dueTime: dueTime || null, priority, status, project,
    tags: addTag(tags, tagInput),
    recurrenceRule: frequency === 'none' ? null : {
      frequency, intervalDays: frequency === 'custom' ? Math.max(1, Number(interval) || 1) : 1
    },
    recurrenceNext: frequency === 'none' ? null : dueDate || null,
    subtasks: parseSubtasks(subtasks)
  })

  const save = async () => {
    if (busy) return
    const value = input()
    const problems = taskInputProblems(value)
    const first = TASK_FIELD_ORDER.find((field) => problems[field])
    setFieldErrors(problems)
    setSaveError('')
    if (first) {
      // The failed field may sit inside the collapsed section: open it so the user sees the message.
      if (first === 'recurrenceRule' || first === 'tags' || first === 'subtasks') setAdvancedOpen(true)
      setFocusField(first)
      return
    }
    setBusy(true)
    try {
      if (task) await window.api.tasks.update(task.id, value)
      else await window.api.tasks.create(value)
      onSaved()
    } catch (e) {
      // A rule only the database knows shows right here, where the field messages appear.
      setSaveError(errMsg(e))
      setBusy(false)
    }
  }

  // Escape closes, Ctrl+Enter saves - like every other editor.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
      if (e.key === 'Enter' && e.ctrlKey) { e.preventDefault(); save() }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  // Focus (and so scroll to) the first invalid field after the failed save.
  useEffect(() => {
    if (focusField) {
      fields.current[focusField]?.focus()
      setFocusField(null)
    }
  }, [focusField, advancedOpen])

  // One line summarising everything set while the section is hidden, so nothing set is hidden.
  const advancedSummary = (): string => {
    const parts: string[] = []
    if (frequency !== 'none') parts.push(repeatLabel(frequency, Math.max(1, Number(interval) || 1)))
    if (project.trim()) parts.push(`project ${project.trim()}`)
    const knownTags = addTag(tags, tagInput)
    if (knownTags.length > 0) parts.push(`${knownTags.length} tag${knownTags.length === 1 ? '' : 's'}`)
    const lines = parseSubtasks(subtasks)
    if (lines.length > 0) parts.push(`${lines.length} subtask${lines.length === 1 ? '' : 's'}`)
    if (notes.trim()) parts.push('notes')
    return parts.join(' · ')
  }
  const summaryLine = advancedSummary()

  const clearFieldError = (field: TaskField) => {
    if (fieldErrors[field]) setFieldErrors((current) => ({ ...current, [field]: undefined }))
    if (saveError) setSaveError('')
  }
  const errorText = (field: TaskField) => fieldErrors[field]
  const describedBy = (field: TaskField) => errorText(field) ? `task-${field}-error` : undefined
  const fieldRef = (field: TaskField) => (element: FieldElement | null) => { fields.current[field] = element }
  const fieldError = (field: TaskField) => {
    const message = errorText(field)
    if (!message) return null
    return <p id={`task-${field}-error`} role="alert" className="text-xs text-neg">{message}</p>
  }

  return (
    <div className="scrim fixed inset-0 z-10 flex justify-end" onMouseDown={onClose}>
      <aside role="dialog" aria-modal="true" aria-labelledby="task-editor-title" onMouseDown={(e) => e.stopPropagation()}
        className="flex h-full w-[min(34rem,100%)] flex-col overflow-y-auto border-l border-line bg-panel p-6 shadow-card">
        <div className="flex items-center justify-between">
          <h2 id="task-editor-title" className="text-lg font-semibold">{task ? 'Edit task' : 'New task'}</h2>
          <button type="button" className="btn-icon" onClick={onClose} aria-label="Close task editor"><X size={18} /></button>
        </div>

        {/* flex-1 (not min-h-full): on short tasks the field column grows to pin the
            footer at the bottom; on long tasks it never shrinks below its content, so
            the footer can never be drawn on top of the overflowing section. */}
        <div className="flex flex-1 flex-col gap-4 py-4">
          <label className="flex flex-col text-xs text-muted">Title
            <input id="task-title" className="field mt-1" autoFocus value={title} placeholder="What needs doing?"
              aria-invalid={Boolean(errorText('title'))} aria-describedby={describedBy('title')} ref={fieldRef('title')}
              onChange={(e) => { setTitle(e.target.value); clearFieldError('title') }} />
            {fieldError('title')}
          </label>

          <div className="grid grid-cols-3 gap-3">
            <label className="flex flex-col text-xs text-muted">Due date
              <input id="task-dueDate" type="date" className="field mt-1" value={dueDate}
                aria-invalid={Boolean(errorText('dueDate'))} aria-describedby={describedBy('dueDate')} ref={fieldRef('dueDate')}
                onChange={(e) => { setDueDate(e.target.value); clearFieldError('dueDate') }} />
              {fieldError('dueDate')}
            </label>
            <label className="flex flex-col text-xs text-muted">Due time
              <input id="task-dueTime" type="time" className="field mt-1" value={dueTime}
                aria-invalid={Boolean(errorText('dueTime'))} aria-describedby={describedBy('dueTime')} ref={fieldRef('dueTime')}
                onChange={(e) => { setDueTime(e.target.value); clearFieldError('dueTime') }} />
              {fieldError('dueTime')}
            </label>
            <label className="flex flex-col text-xs text-muted">Priority
              <select id="task-priority" className="field relative z-20 mt-1" value={priority}
                aria-invalid={Boolean(errorText('priority'))} aria-describedby={describedBy('priority')} ref={fieldRef('priority')}
                onChange={(e) => { setPriority(e.target.value as TaskPriority); clearFieldError('priority') }}>
                <option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option>
              </select>
              {fieldError('priority')}
            </label>
          </div>

          <label className="flex flex-col text-xs text-muted">Status
            <select id="task-status" className="field mt-1" value={status}
              aria-invalid={Boolean(errorText('status'))} aria-describedby={describedBy('status')} ref={fieldRef('status')}
              onChange={(e) => { setStatus(e.target.value as TaskStatus); clearFieldError('status') }}>
              <option value="todo">To do</option><option value="in-progress">In progress</option><option value="done">Done</option>
            </select>
            {fieldError('status')}
          </label>

          <div>
            <button type="button" className="btn btn-sm" aria-expanded={advancedOpen} aria-controls="task-advanced"
              onClick={() => setAdvancedOpen(!advancedOpen)}>
              {advancedOpen ? 'Hide details' : 'Advanced'}{!advancedOpen && summaryLine ? `: ${summaryLine}` : ''}
            </button>
          </div>

          {advancedOpen && (
            <div id="task-advanced" className="flex flex-col gap-4 rounded-xl border border-line bg-bg p-4">
              <label className="flex flex-col text-xs text-muted">Project
                <input id="task-project" className="field mt-1" value={project} placeholder="Optional"
                  onChange={(e) => { setProject(e.target.value); setSaveError('') }} />
              </label>

              {/* TagInput captions itself (like the other editors), so no outer label here. */}
              <TagInput tags={tags} onTagsChange={(next) => { setTags(next); clearFieldError('tags') }}
                input={tagInput} suggestions={[]}
                onInputChange={(value) => { setTagInput(value); clearFieldError('tags') }} />
              {fieldError('tags')}

              <label className="flex flex-col text-xs text-muted">Notes
                <textarea id="task-notes" className="field mt-1 min-h-20 resize-y" value={notes}
                  onChange={(e) => { setNotes(e.target.value); setSaveError('') }} />
              </label>

              <label className="flex flex-col text-xs text-muted">Subtasks (one per line; prefix [x] for done)
                <textarea id="task-subtasks" className="field mt-1 min-h-24 resize-y" value={subtasks}
                  placeholder={'Book tickets\n[x] Check dates'}
                  aria-invalid={Boolean(errorText('subtasks'))} aria-describedby={describedBy('subtasks')} ref={fieldRef('subtasks')}
                  onChange={(e) => { setSubtasks(e.target.value); clearFieldError('subtasks') }} />
                {fieldError('subtasks')}
                <p className="mt-1 text-xs text-muted">
                  Every next occurrence of this task starts with the same checklist, unchecked again.
                </p>
              </label>

              <div className="grid grid-cols-[1fr_7rem] gap-3">
                <label className="flex flex-col text-xs text-muted">Repeat
                  <select id="task-recurrence" className="field mt-1" value={frequency}
                    aria-invalid={Boolean(errorText('recurrenceRule'))} aria-describedby={describedBy('recurrenceRule')} ref={fieldRef('recurrenceRule')}
                    onChange={(e) => { setFrequency(e.target.value as typeof frequency); clearFieldError('recurrenceRule') }}>
                    <option value="none">Does not repeat</option><option value="daily">Daily</option><option value="weekly">Weekly</option>
                    <option value="monthly">Monthly</option><option value="custom">Every N days</option>
                  </select>
                </label>
                {frequency === 'custom' && (
                  <label className="flex flex-col text-xs text-muted">Days
                    <input id="task-recurrence-interval" type="number" className="field mt-1" min="1" max="3650" value={interval}
                      aria-invalid={Boolean(errorText('recurrenceRule'))} aria-describedby={describedBy('recurrenceRule')}
                      ref={fieldRef('recurrenceRule')}
                      onChange={(e) => { setInterval(e.target.value); clearFieldError('recurrenceRule') }} />
                  </label>
                )}
              </div>
              {fieldError('recurrenceRule')}
              <p className="text-xs text-muted">
                Completing this task adds one occurrence — same title, notes, tags and checklist, unchecked —
                dated this task's due date advanced by one interval, or today's date when it has none:
                daily = the day after, weekly = the week after, monthly = the same day next month
                (clamped to the month's end), custom = every N days.
              </p>
            </div>
          )}

          {(saveError || Object.values(fieldErrors).some(Boolean)) && (
            <div id="task-form-errors" role="alert" aria-live="polite">
              {saveError && <p className="text-sm text-neg">{saveError}</p>}
            </div>
          )}
        </div>

        <div className="mt-auto flex items-center gap-2">
          <button type="button" className="btn" onClick={onClose} disabled={busy}>Cancel</button>
          <span className="ml-auto text-xs text-muted">Ctrl+Enter to save</span>
          <button type="button" className="btn-primary" onClick={save} disabled={busy}>{busy ? 'Saving…' : 'Save task'}</button>
        </div>
      </aside>
    </div>
  )
}
