import { useCallback, useEffect, useRef, useState } from 'react'
import { CalendarDays, Check, CheckSquare, Circle, GripVertical, LayoutGrid, List, Plus, Repeat2, RotateCcw, Search, SkipForward, Trash2, Undo2 } from 'lucide-react'
import type { Task, TaskInput, TaskLayout, TaskPriority, TaskSort, TaskView } from '../../../shared/types'
import type { ModuleProps } from '../lib/navigation'
import { useSettings, updateSettings } from '../lib/settingsStore'
import { useTaskFilters } from '../lib/useTaskFilters'
import { today, localTime, formatDate } from '../lib/dates'
import { errMsg } from '../lib/errors'
import { parseQuickAdd } from '../../../shared/quickAdd'
import { addTaskDays, applyColumnOrder, filterTasks, taskInputForEdit, taskIsOverdue, type TaskInlinePatch } from '../../../shared/tasks'
import { saveProposal } from '../lib/quickAddSave'
import { PageHeader } from '../components/PageHeader'
import { EmptyState } from '../components/EmptyState'
import { TaskEditor } from './TaskEditor'
import { TaskBoard } from './TaskBoard'

const VIEWS: { id: TaskView; label: string }[] = [
  { id: 'today', label: 'Today' }, { id: 'upcoming', label: 'Upcoming' }, { id: 'overdue', label: 'Overdue' },
  { id: 'all', label: 'All' }, { id: 'completed', label: 'Completed' }, { id: 'trash', label: 'Trash' }
]

const LAYOUTS: { id: TaskLayout; label: string; icon: typeof List }[] = [
  { id: 'list', label: 'List', icon: List },
  { id: 'board', label: 'Board', icon: LayoutGrid }
]

type BulkAction = 'done' | 'todo' | 'delete'

interface UndoToast { message: string; run: () => Promise<void> }

export function Tasks({ target, onTargetHandled }: ModuleProps) {
  const settings = useSettings()
  const layout = settings.taskLayout
  const [day, setDay] = useState(today)
  const [clock, setClock] = useState(localTime)
  const [tasks, setTasks] = useState<Task[]>([])
  const [trashTasks, setTrashTasks] = useState<Task[]>([])
  const [completedTasks, setCompletedTasks] = useState<Task[]>([])
  const [completedDay, setCompletedDay] = useState(today)
  const [trashCount, setTrashCount] = useState(0)
  const [loaded, setLoaded] = useState(false)
  const [quick, setQuick] = useState('')
  const [editing, setEditing] = useState<Task | 'new' | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState<number | null>(null)
  const [dragId, setDragId] = useState<number | null>(null)
  const [dragSubtask, setDragSubtask] = useState<{ taskId: number; id: number } | null>(null)
  const [selectMode, setSelectMode] = useState(false)
  const [selected, setSelected] = useState<Set<number>>(() => new Set())
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [bulkBusy, setBulkBusy] = useState(false)
  const [undoToast, setUndoToast] = useState<UndoToast | null>(null)
  const [clearTrashConfirm, setClearTrashConfirm] = useState(false)
  const [bulkDate, setBulkDate] = useState('')
  const lastSelected = useRef<number | null>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  // Both views take their tasks from this one hook, so the filters and the result never differ.
  const filters = useTaskFilters(tasks, day, clock, settings.taskSort, trashTasks, completedTasks)
  const { view, setView, text, priority, project, tag, filter, filtered, displayedTasks, projects, tags, filtering } = filters
  const refresh = useCallback(async () => {
    try {
      const [active, trash, completed] = await Promise.all([
        window.api.tasks.list(), window.api.tasks.trash(), window.api.tasks.completed(completedDay)
      ])
      setTrashCount(trash.length)
      setTasks(active)
      setTrashTasks(trash)
      setCompletedTasks(completed)
      setLoaded(true); setError('')
    }
    catch (e) { setError(errMsg(e)); setLoaded(true) }
  }, [completedDay])
  useEffect(() => { void refresh() }, [refresh, view])

  useEffect(() => {
    const unsubscribe = window.api.capture.onDataChanged(() => { void refresh() })
    const onFocus = () => { setDay(today()); setClock(localTime()); void refresh() }
    window.addEventListener('focus', onFocus)
    const timer = setInterval(() => { setDay(today()); setClock(localTime()) }, 60_000)
    return () => { unsubscribe(); window.removeEventListener('focus', onFocus); clearInterval(timer) }
  }, [refresh])

  useEffect(() => {
    const create = () => setEditing('new')
    const goToday = () => setView('today')
    const goBoard = () => updateSettings({ taskLayout: 'board' })
    const goTrash = () => setView('trash')
    window.addEventListener('tasks:new', create)
    window.addEventListener('tasks:today', goToday)
    window.addEventListener('tasks:board', goBoard)
    window.addEventListener('tasks:trash', goTrash)
    return () => {
      window.removeEventListener('tasks:new', create); window.removeEventListener('tasks:today', goToday)
      window.removeEventListener('tasks:board', goBoard)
      window.removeEventListener('tasks:trash', goTrash)
    }
  }, [setView])

  useEffect(() => {
    if (target?.module === 'tasks') {
      setEditing(target.task)
      onTargetHandled()
    }
  }, [target, onTargetHandled])

  // A selection only means something inside the list it was made in, so changing what is shown starts fresh.
  useEffect(() => { setSelected(new Set()); setConfirmDelete(false) }, [view, text, priority, project, tag])

  // The board has no selection toolbar: leaving it drops any selection made in the list.
  useEffect(() => { if (layout === 'board' && selectMode) { setSelectMode(false); setSelected(new Set()); setConfirmDelete(false) } }, [layout, selectMode])

  const add = async (title = quick) => {
    if (!title.trim()) return
    try {
      const parsed = parseQuickAdd(`task ${title.trim()}`, { today: day })
      if (parsed.ok && parsed.parse.proposal.kind === 'task' &&
        (parsed.parse.proposal.dueDate || parsed.parse.proposal.dueTime || parsed.parse.proposal.project || parsed.parse.proposal.tags.length > 0 || parsed.parse.proposal.priority !== 'medium' || parsed.parse.proposal.recurrence)) {
        await saveProposal(parsed.parse.proposal, { goals: [], habits: [], defaultTaskDueDate: view === 'today' ? day : null })
      } else {
        await window.api.tasks.create({ title: title.trim(), notes: '', status: 'todo', priority: 'medium', dueDate: view === 'today' ? day : null, dueTime: null,
          project: '', tags: [], subtasks: [], recurrenceRule: null, recurrenceNext: null })
      }
      setQuick(''); setEditing(null); await refresh()
    } catch (e) { setError(errMsg(e)) }
  }

  const allSelected = filtered.length > 0 && filtered.every((t) => selected.has(t.id))

  const toggle = useCallback(async (id: number) => {
    if (busy !== null) return
    const task = tasks.find((t) => t.id === id)
    if (!task) return
    const snapshot = task
    const nextStatus = task.status === 'done' ? 'todo' : 'done'
    setTasks((current) => current.map((item) => item.id === id
      ? { ...item, status: nextStatus, completedAt: nextStatus === 'done' ? new Date().toISOString() : null }
      : item))
    setBusy(id)
    try {
      const updated = await window.api.tasks.setStatus(id, nextStatus)
      setTasks((current) => current.map((item) => item.id === id ? updated : item))
      if (nextStatus === 'done') {
        setUndoToast({ message: 'Task completed', run: async () => {
          await window.api.tasks.undoStatus(id, snapshot.status, snapshot.completedAt, snapshot.recurrenceNext)
          await refresh()
        } })
      }
      setSelected((prev) => { const next = new Set(prev); next.delete(id); return next })
    } catch (e) { setTasks((current) => current.map((item) => item.id === id ? snapshot : item)); setError(errMsg(e)) }
    setBusy(null)
  }, [busy, refresh, tasks])

  const toggleSelect = useCallback((id: number, shift = false) => {
    setConfirmDelete(false)
    setSelected((prev) => {
      const next = new Set(prev)
      if (shift && lastSelected.current !== null) {
        const from = filtered.findIndex((task) => task.id === lastSelected.current)
        const to = filtered.findIndex((task) => task.id === id)
        if (from >= 0 && to >= 0) filtered.slice(Math.min(from, to), Math.max(from, to) + 1).forEach((task) => next.add(task.id))
      } else if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
    lastSelected.current = id
  }, [filtered])

  const selectAll = () => {
    setConfirmDelete(false)
    setSelected(allSelected ? new Set() : new Set(filtered.map((t) => t.id)))
  }

  const leaveSelectMode = () => { setSelectMode(false); setSelected(new Set()); setConfirmDelete(false) }

  const removeTask = async (task: Task) => {
    setTasks((current) => current.filter((item) => item.id !== task.id))
    try {
      await window.api.tasks.remove(task.id)
      setUndoToast({ message: 'Task moved to Trash', run: async () => { await window.api.tasks.restore(task.id); await refresh() } })
      await refresh()
    } catch (e) {
      setTasks((current) => [...current, task].sort((a, b) => a.position - b.position))
      setError(errMsg(e))
    }
  }

  const updateInline = async (task: Task, patch: TaskInlinePatch) => {
    const snapshot = task
    const input = taskInputForEdit(task, patch)
    setTasks((current) => current.map((item) => item.id === task.id ? { ...item, ...patch } : item))
    try {
      const updated = await window.api.tasks.update(task.id, input)
      setTasks((current) => current.map((item) => item.id === task.id ? updated : item))
    } catch (e) {
      setTasks((current) => current.map((item) => item.id === task.id ? snapshot : item))
      setError(errMsg(e))
    }
  }

  const reschedule = async (date: string, time: string | null = null) => {
    const ids = [...selected]
    if (ids.length === 0 || bulkBusy) return
    const snapshot = tasks
    setBulkBusy(true)
    setTasks((current) => current.map((task) => ids.includes(task.id) ? { ...task, dueDate: date, dueTime: time } : task))
    try {
      await window.api.tasks.rescheduleMany(ids, date, time)
      setUndoToast({ message: `Rescheduled ${ids.length} task${ids.length === 1 ? '' : 's'}`, run: async () => {
        await Promise.all(snapshot.filter((task) => ids.includes(task.id)).map((task) => window.api.tasks.update(task.id, taskInputForEdit(task))))
        await refresh()
      } })
      setSelected(new Set())
    } catch (e) { setTasks(snapshot); setError(errMsg(e)) }
    setBulkBusy(false)
  }

  const saveView = () => {
    const name = window.prompt('Name this task view')
    if (!name?.trim()) return
    const id = `${Date.now()}`
    updateSettings({ taskSavedViews: [...settings.taskSavedViews, { id, name: name.trim(), filter }] })
  }

  const applySavedView = (savedFilter: typeof filter) => {
    setView(savedFilter.view ?? 'all')
    filters.setText(savedFilter.text ?? '')
    filters.setPriority(savedFilter.priority ?? '')
    filters.setProject(savedFilter.project ?? '')
    filters.setTag(savedFilter.tag ?? '')
  }

  const clearTrash = async () => {
    setBulkBusy(true)
    try { await window.api.tasks.clearTrash(); setClearTrashConfirm(false); await refresh() }
    catch (e) { setError(errMsg(e)) }
    setBulkBusy(false)
  }

  const reorderSubtask = async (task: Task, targetId: number) => {
    if (!dragSubtask || dragSubtask.taskId !== task.id || dragSubtask.id === targetId) return
    const snapshot = tasks
    const subtasks = [...task.subtasks]
    const from = subtasks.findIndex((item) => item.id === dragSubtask.id)
    const to = subtasks.findIndex((item) => item.id === targetId)
    if (from < 0 || to < 0) return
    subtasks.splice(to, 0, subtasks.splice(from, 1)[0])
    setTasks((current) => current.map((item) => item.id === task.id ? { ...item, subtasks } : item))
    try { await window.api.tasks.reorderSubtasks(task.id, subtasks.map((item) => item.id)) }
    catch (e) { setTasks(snapshot); setError(errMsg(e)) }
    setDragSubtask(null)
  }

  const deleteForever = async (id: number) => {
    try { await window.api.tasks.deleteForever(id); await refresh() }
    catch (e) { setError(errMsg(e)) }
  }

  const skipOccurrence = async (task: Task) => {
    try {
      const updated = await window.api.tasks.skipOccurrence(task.id, day)
      setTasks((current) => current.map((item) => item.id === task.id ? updated : item))
    } catch (e) { setError(errMsg(e)) }
  }

  const toggleSubtask = async (task: Task, subtaskId: number, done: boolean) => {
    const snapshot = tasks
    setTasks((current) => current.map((item) => item.id === task.id
      ? { ...item, subtasks: item.subtasks.map((subtask) => subtask.id === subtaskId ? { ...subtask, done } : subtask) }
      : item))
    try { await window.api.tasks.setSubtaskDone(task.id, subtaskId, done) }
    catch (e) { setTasks(snapshot); setError(errMsg(e)) }
  }

  const promoteSubtask = async (task: Task, subtaskId: number) => {
    try { await window.api.tasks.promoteSubtask(task.id, subtaskId); await refresh() }
    catch (e) { setError(errMsg(e)) }
  }

  const bulk = async (action: BulkAction) => {
    const ids = [...selected]
    if (ids.length === 0 || bulkBusy) return
    setBulkBusy(true)
    try {
      if (action === 'delete') await window.api.tasks.removeMany(ids)
      else await window.api.tasks.setStatusMany(ids, action)
      if (action === 'delete') setUndoToast({ message: `${ids.length} task${ids.length === 1 ? '' : 's'} moved to Trash`, run: async () => {
        await Promise.all(ids.map((id) => window.api.tasks.restore(id)))
        await refresh()
      } })
      setSelected(new Set()); setConfirmDelete(false); await refresh()
    } catch (e) { setError(errMsg(e)) }
    setBulkBusy(false)
  }

  useEffect(() => {
    const overdue = () => setView('overdue')
    const completeSelected = () => { if (selected.size > 0) void bulk('done'); else setError('Select one or more tasks first.') }
    window.addEventListener('tasks:overdue', overdue)
    window.addEventListener('tasks:complete-selected', completeSelected)
    return () => {
      window.removeEventListener('tasks:overdue', overdue)
      window.removeEventListener('tasks:complete-selected', completeSelected)
    }
  }, [setView, selected, bulkBusy])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.isComposing || e.altKey || e.ctrlKey || e.metaKey || e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLSelectElement) return
      if (e.key === '/') { e.preventDefault(); searchRef.current?.focus(); searchRef.current?.select(); return }
      if (e.key.toLowerCase() === 'n') { e.preventDefault(); setEditing('new') }
      if (layout === 'list' && e.code === 'Space' && e.target instanceof HTMLElement && e.target.dataset.taskRow === 'true') {
        const id = Number(e.target.dataset.taskId)
        if (id) { e.preventDefault(); void toggle(id); return }
      }
      if (layout === 'list' && view !== 'trash' && ['j', 'k', 'x', 'e', 'd'].includes(e.key.toLowerCase())) {
        const rows = [...document.querySelectorAll<HTMLElement>('[data-task-row="true"]')]
        const active = document.activeElement instanceof HTMLElement ? document.activeElement.closest<HTMLElement>('[data-task-row="true"]') : null
        const index = Math.max(0, rows.indexOf(active ?? rows[0]))
        if (e.key.toLowerCase() === 'j' || e.key.toLowerCase() === 'k') {
          e.preventDefault()
          rows[Math.min(rows.length - 1, Math.max(0, index + (e.key.toLowerCase() === 'j' ? 1 : -1)))]?.focus()
        } else if (active) {
          const id = Number(active.dataset.taskId)
          const task = tasks.find((item) => item.id === id)
          if (!task) return
          e.preventDefault()
          if (e.key.toLowerCase() === 'x') void toggle(id)
          if (e.key.toLowerCase() === 'e') setEditing(task)
          if (e.key.toLowerCase() === 'd') active.querySelector<HTMLInputElement>('input[type="date"]')?.focus()
        }
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [layout, view, tasks, toggle])

  const reorder = async (targetId: number) => {
    if (dragId === null || dragId === targetId) return
    const snapshot = tasks
    const group = filtered.filter((t) => t.status !== 'done')
    const from = group.findIndex((t) => t.id === dragId), to = group.findIndex((t) => t.id === targetId)
    if (from < 0 || to < 0) return
    const ordered = [...group]
    ordered.splice(to, 0, ordered.splice(from, 1)[0])
    const ids = applyColumnOrder(tasks.map((task) => task.id), ordered.map((task) => task.id))
    const next = new Map(ids.map((id, index) => [id, index]))
    setTasks((current) => current.map((task) => ({ ...task, position: next.get(task.id) ?? task.position })).sort((a, b) => a.position - b.position))
    try { await window.api.tasks.reorder(ids) }
    catch (e) { setTasks(snapshot); setError(errMsg(e)) }
    setDragId(null)
  }

  const title = VIEWS.find((v) => v.id === view)?.label ?? 'Tasks'
  const countForView = (viewId: TaskView): number =>
    viewId === 'trash' ? trashCount : viewId === 'completed' ? completedTasks.length : filterTasks(tasks, { view: viewId }, day, clock).length
  return (
    <div className="page page-lg">
      <PageHeader title="Tasks" subtitle={`${filtered.length}${filtering ? ` of ${displayedTasks.length}` : ''} ${filtered.length === 1 ? 'task' : 'tasks'} · local only`}>
        {layout === 'list' && view !== 'completed' && (
          <button className={`btn ${selectMode ? 'border-accent text-accent-fg' : ''}`} aria-pressed={selectMode} onClick={() => (selectMode ? leaveSelectMode() : setSelectMode(true))}>
            <CheckSquare size={16} /> {selectMode ? 'Done' : 'Select'}
          </button>
        )}
        <button className="btn-primary" onClick={() => setEditing('new')} title="N"><Plus size={16} /> New task</button>
      </PageHeader>
      <div className="mt-1 flex flex-wrap items-center justify-between gap-2">
        <div className="seg seg-tabs flex flex-wrap" role="tablist" aria-label="Task views">
          {VIEWS.map((item) => <button key={item.id} role="tab" aria-selected={view === item.id} onClick={() => filters.setView(item.id)}>
            {item.label} <span className="ml-1 text-xs text-muted">{countForView(item.id)}</span>
          </button>)}
        </div>
        <div className="seg flex flex-wrap" role="group" aria-label="Task layout">
          {LAYOUTS.map((item) => {
            const Icon = item.icon
            return <button key={item.id} aria-pressed={layout === item.id} onClick={() => updateSettings({ taskLayout: item.id })}><Icon size={14} className="mr-1 inline" />{item.label}</button>
          })}
        </div>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        {view === 'completed' && <label className="flex items-center gap-2 text-sm text-muted">
          Completed on
          <input type="date" className="field w-40" aria-label="Show tasks completed on date"
            value={completedDay} onChange={(e) => { if (e.target.value) setCompletedDay(e.target.value) }} />
        </label>}
        <div className="relative min-w-[12rem] flex-1">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
          <input ref={searchRef} type="search" className="field pl-9" placeholder="Search tasks, notes, projects or #tags" aria-label="Search tasks"
            value={text} onChange={(e) => filters.setText(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); filters.setText(''); e.currentTarget.blur() } }} />
        </div>
        <select className="field w-36" aria-label="Filter by priority" value={priority} onChange={(e) => filters.setPriority(e.target.value as TaskPriority | '')}>
          <option value="">All priorities</option><option value="high">High priority</option><option value="medium">Medium priority</option><option value="low">Low priority</option>
        </select>
        <select className="field w-40" aria-label="Filter by project" value={project} onChange={(e) => filters.setProject(e.target.value)}>
          <option value="">All projects</option>{projects.map((p) => <option key={p}>{p}</option>)}
        </select>
        <select className="field w-40" aria-label="Filter by tag" value={tag} onChange={(e) => filters.setTag(e.target.value)}>
          <option value="">All tags</option>{tags.map((t) => <option key={t} value={t}>#{t}</option>)}
        </select>
        {filtering && <button className="btn" onClick={filters.clear}>Clear</button>}
        <select className="field w-40" aria-label="Sort tasks" value={settings.taskSort}
          onChange={(e) => updateSettings({ taskSort: e.target.value as TaskSort })}>
          <option value="manual">Manual order</option><option value="due-date">Due date</option><option value="priority">Priority</option>
        </select>
        {view !== 'trash' && <button className="btn" onClick={saveView}>Save view</button>}
      </div>
      {settings.taskSavedViews.length > 0 && view !== 'trash' && (
        <div className="mt-2 flex flex-wrap gap-2" role="group" aria-label="Saved task views">
          {settings.taskSavedViews.map((saved) => <span key={saved.id} className="seg items-center">
            <button onClick={() => applySavedView(saved.filter)}>{saved.name}</button>
            <button aria-label={`Remove saved view ${saved.name}`} onClick={() => updateSettings({ taskSavedViews: settings.taskSavedViews.filter((item) => item.id !== saved.id) })}>×</button>
          </span>)}
        </div>
      )}
      {selectMode && layout === 'list' && view !== 'trash' && view !== 'completed' && (
        <div className="card card-pad-sm mt-4 flex flex-wrap items-center gap-2" role="region" aria-label="Bulk actions">
          <span className="text-sm" aria-live="polite">{selected.size} selected</span>
          <button className="btn btn-sm" onClick={selectAll} disabled={filtered.length === 0}>{allSelected ? 'Select none' : `Select all ${filtered.length}`}</button>
          <div className="ml-auto flex flex-wrap items-center gap-2">
            {confirmDelete ? (
              <>
                <span className="text-xs text-neg">Delete {selected.size} {selected.size === 1 ? 'task' : 'tasks'}?</span>
                <button className="btn-danger btn-sm" onClick={() => bulk('delete')} disabled={bulkBusy}>Delete</button>
                <button className="btn btn-sm" onClick={() => setConfirmDelete(false)} disabled={bulkBusy}>Keep</button>
              </>
            ) : (
              <>
                <button className="btn btn-sm" onClick={() => bulk('done')} disabled={selected.size === 0 || bulkBusy}><Check size={14} /> Mark done</button>
                <button className="btn btn-sm" onClick={() => bulk('todo')} disabled={selected.size === 0 || bulkBusy}><RotateCcw size={14} /> Reopen</button>
                <button className="btn btn-sm" onClick={() => void reschedule(day)} disabled={selected.size === 0 || bulkBusy}>Today</button>
                <button className="btn btn-sm" onClick={() => void reschedule(addTaskDays(day, 1), '09:00')} disabled={selected.size === 0 || bulkBusy}>Snooze 1 day</button>
                <button className="btn btn-sm" onClick={() => void reschedule(addTaskDays(day, 7), '09:00')} disabled={selected.size === 0 || bulkBusy}>Next week</button>
                <input type="date" className="field w-36" aria-label="Reschedule selected tasks to date" value={bulkDate}
                  onChange={(e) => { setBulkDate(e.target.value); if (e.target.value) void reschedule(e.target.value) }} />
                <button className="btn-icon hover:text-neg" aria-label={`Delete ${selected.size} selected ${selected.size === 1 ? 'task' : 'tasks'}`}
                  onClick={() => setConfirmDelete(true)} disabled={selected.size === 0 || bulkBusy}><Trash2 size={15} /></button>
              </>
            )}
          </div>
        </div>
      )}
      {view !== 'trash' && <form className="card card-pad-sm mt-4 flex gap-2" onSubmit={(e) => { e.preventDefault(); void add() }}>
        <input className="field" value={quick} onChange={(e) => setQuick(e.target.value)}
          placeholder="Add a task… (try Friday 5pm #tag project:Home high)" aria-label="Quick add task" />
        <button type="submit" className="btn-primary" aria-label="Add task"><Plus size={16} /></button>
      </form>}
      {error && <p role="alert" className="mt-3 text-sm text-neg">{error}</p>}
      {view === 'trash' && (
        <div className="mt-4 flex items-center justify-between">
          <p className="text-sm text-muted">{trashCount} items in Trash</p>
          {clearTrashConfirm ? <span className="flex gap-2">
            <span className="text-sm text-neg">Permanently delete all trashed tasks?</span>
            <button className="btn-danger btn-sm" onClick={() => void clearTrash()} disabled={bulkBusy}>Delete forever</button>
            <button className="btn btn-sm" onClick={() => setClearTrashConfirm(false)}>Cancel</button>
          </span> : <button className="btn-danger btn-sm" onClick={() => setClearTrashConfirm(true)} disabled={trashCount === 0}>Empty Trash</button>}
        </div>
      )}
      {layout === 'board' && view !== 'trash' ? (
        <div className="mt-4">
          <TaskBoard tasks={tasks} filter={filter} today={day} nowTime={clock} sort={settings.taskSort} loaded={loaded} refresh={refresh}
            onOptimistic={setTasks} onInline={(task, patch) => void updateInline(task, patch)}
            onSkip={(task) => void skipOccurrence(task)}
            onEdit={(task) => setEditing(task)} onNew={() => setEditing('new')} onError={setError} />
        </div>
      ) : (
        <div className="mt-4 flex flex-col gap-2">
          {loaded && filtered.length === 0 && <EmptyState icon={CheckSquare}
            title={view === 'trash' ? 'Trash is empty.' : view === 'completed' ? 'No tasks completed on this day.' : displayedTasks.length === 0 ? 'A clear list is a good place to begin.' : filtering ? 'No tasks match these filters.' : `No tasks in ${title.toLowerCase()}.`}
            text={view === 'trash' ? 'Deleted tasks can be restored here before they are permanently removed.' : view === 'completed' ? 'Choose another date to review completed tasks.' : displayedTasks.length === 0 ? 'Add one small thing you would like to get done.' : filtering ? 'Try another search term or clear a filter.' : 'Try another view or create a task.'}
            action={view !== 'trash' && view !== 'completed' ? <button className="btn-primary" onClick={() => setEditing('new')}><Plus size={16} /> Create a task</button> : undefined} />}
          {filtered.map((task) => {
            const due = task.recurrenceNext ?? task.dueDate
            const overdue = taskIsOverdue(task, day, clock)
            const done = task.status === 'done'
            const picked = selected.has(task.id)
            if (view === 'completed') return (
              <article key={`${task.id}-${task.completedAt}`} className="card card-pad-sm flex flex-wrap items-center gap-3 opacity-80">
                <Check size={16} className="shrink-0 text-accent-fg" aria-label="Completed" />
                <div className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-muted line-through">{task.title}</span>
                  <span className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted">
                    <span>Completed{task.completedAt ? ` at ${new Date(task.completedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : ''}</span>
                    {task.project && <span>{task.project}</span>}
                    {task.tags.map((item) => <span key={item}>#{item}</span>)}
                  </span>
                </div>
              </article>
            )
            return (
              <article key={task.id} data-task-id={task.id} data-task-row="true" tabIndex={0} onDoubleClick={() => { if (!selectMode) setEditing(task) }}
                onKeyDown={(e) => { if (e.key === 'Enter' && !selectMode) setEditing(task) }}
                draggable={settings.taskSort === 'manual' && view !== 'trash' && !selectMode} onDragStart={() => setDragId(task.id)} onDragOver={(e) => e.preventDefault()} onDrop={() => reorder(task.id)}
                className={`card card-pad-sm flex flex-wrap items-center gap-3 ${done ? 'opacity-70' : ''} ${picked ? 'border-accent ring-1 ring-accent' : overdue ? 'border-neg/60' : ''}`}>
                {view === 'trash'
                  ? <span className="min-w-0 flex-1 truncate text-sm font-medium">{task.title}</span>
                  : selectMode
                    ? <input type="checkbox" className="h-4 w-4 shrink-0 accent-accent" checked={picked} onChange={(e) => toggleSelect(task.id, e.nativeEvent instanceof MouseEvent && e.nativeEvent.shiftKey)} aria-label={`Select ${task.title}`} />
                    : <GripVertical size={16} className={`shrink-0 text-muted ${settings.taskSort === 'manual' ? 'cursor-grab' : ''}`} aria-label={settings.taskSort === 'manual' ? 'Drag to reorder' : 'Set Manual order to reorder'} />}
                {view !== 'trash' && <button type="button" className={`grid h-6 w-6 shrink-0 place-items-center rounded-md border ${done ? 'border-accent bg-accent text-on-accent' : 'border-line hover:border-accent'}`}
                  aria-label={`${done ? 'Mark not done' : 'Mark done'}: ${task.title}`} aria-pressed={done} disabled={busy === task.id} onClick={() => void toggle(task.id)}>
                  {done ? <Check size={15} /> : <Circle size={14} className="text-transparent" />}
                </button>}
                {view !== 'trash' && <button type="button" onClick={() => (selectMode ? toggleSelect(task.id) : setEditing(task))} className="min-w-0 flex-1 text-left">
                  <span className={`block truncate text-sm font-medium ${done ? 'text-muted line-through' : ''}`}>{task.title}</span>
                  <span className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted">
                    <span className={`badge badge-${task.priority === 'high' ? 'neg' : 'muted'}`}>{task.priority}</span>
                    {due && <span className={`flex items-center gap-1 ${overdue ? 'text-neg font-medium' : ''}`}><CalendarDays size={12} />{overdue ? 'Overdue · ' : ''}{formatDate(due)}{task.dueTime ? ` · ${task.dueTime}` : ''}</span>}
                    {task.project && <span>{task.project}</span>}
                    {task.tags.map((t) => <span key={t}>#{t}</span>)}
                    {task.recurrenceRule && <span title={`Repeats ${task.recurrenceRule.frequency}`}><Repeat2 size={12} aria-label="Recurring" /></span>}
                    {task.subtasks.length > 0 && <span>{task.subtasks.filter((s) => s.done).length}/{task.subtasks.length} checklist</span>}
                  </span>
                </button>}
                {view === 'trash' ? <>
                  <button className="btn btn-sm" onClick={() => { void window.api.tasks.restore(task.id).then(refresh).catch((e) => setError(errMsg(e))) }}>Restore</button>
                  <button className="btn-danger btn-sm" onClick={() => void deleteForever(task.id)}>Delete forever</button>
                </> : !selectMode && <div className="flex flex-wrap items-center gap-1" onClick={(e) => e.stopPropagation()}>
                  <input type="date" className="field w-36" aria-label={`Due date for ${task.title}`} value={task.recurrenceNext ?? task.dueDate ?? ''}
                    onChange={(e) => void updateInline(task, { dueDate: e.target.value || null })} />
                  <select className="field w-28" aria-label={`Priority for ${task.title}`} value={task.priority}
                    onChange={(e) => void updateInline(task, { priority: e.target.value as TaskPriority })}>
                    <option value="high">High</option><option value="medium">Medium</option><option value="low">Low</option>
                  </select>
                  <input className="field w-28" aria-label={`Project for ${task.title}`} placeholder="Project" defaultValue={task.project ?? ''}
                    onBlur={(e) => { if (e.target.value !== (task.project ?? '')) void updateInline(task, { project: e.target.value || null }) }} />
                  {task.recurrenceRule && <button className="btn-icon" aria-label={`Skip next occurrence of ${task.title}`} title="Skip next occurrence"
                    onClick={() => void skipOccurrence(task)}><SkipForward size={15} /></button>}
                  <button className="btn-icon hover:text-neg" aria-label={`Move ${task.title} to Trash`} onClick={() => void removeTask(task)}><Trash2 size={15} /></button>
                </div>}
                {view !== 'trash' && task.subtasks.length > 0 && <div className="flex basis-full flex-wrap gap-2 border-t border-line pt-2">
                  {task.subtasks.map((subtask) => <span key={subtask.id} draggable
                    onDragStart={() => setDragSubtask({ taskId: task.id, id: subtask.id })}
                    onDragOver={(e) => e.preventDefault()} onDrop={() => void reorderSubtask(task, subtask.id)}
                    className="flex items-center gap-1 rounded-md border border-line px-2 py-1 text-xs">
                    <input type="checkbox" checked={subtask.done} aria-label={`Complete ${subtask.title}`}
                      onChange={(e) => void toggleSubtask(task, subtask.id, e.target.checked)} />
                    <span className={subtask.done ? 'text-muted line-through' : ''}>{subtask.title}</span>
                    <button className="text-muted hover:text-fg" title="Promote to task" aria-label={`Promote ${subtask.title} to task`}
                      onClick={() => void promoteSubtask(task, subtask.id)}>↗</button>
                  </span>)}
                </div>}
              </article>
            )
          })}
        </div>
      )}
      {undoToast && <div role="status" className="fixed bottom-4 right-4 z-20 flex items-center gap-3 rounded-xl border border-line bg-panel p-3 shadow-card">
        <span className="text-sm">{undoToast.message}</span>
        <button className="btn btn-sm" onClick={async () => {
          try { await undoToast.run(); setUndoToast(null) }
          catch (e) { setError(errMsg(e)) }
        }}><Undo2 size={14} /> Undo</button>
        <button className="btn-icon" aria-label="Dismiss undo message" onClick={() => setUndoToast(null)}>×</button>
      </div>}
      <p className="mt-4 text-xs text-muted">
        Shortcuts: <kbd className="kbd">N</kbd> new task · <kbd className="kbd">/</kbd> search
        {layout === 'list'
          ? <> · <kbd className="kbd">Space</kbd> toggle focused task · drag rows to reorder.</>
          : <> · <kbd className="kbd">Enter</kbd> edit a card · <kbd className="kbd">Alt</kbd> + <kbd className="kbd">←</kbd>/<kbd className="kbd">→</kbd> move a card · drag cards to move or reorder.</>}
      </p>
      {editing && <TaskEditor key={editing === 'new' ? 'new' : editing.id} task={editing === 'new' ? null : editing}
        onClose={() => setEditing(null)} onSaved={() => { setEditing(null); void refresh() }} />}
    </div>
  )
}
