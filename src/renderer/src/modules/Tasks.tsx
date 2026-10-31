import { useCallback, useEffect, useRef, useState } from 'react'
import { CalendarDays, Check, CheckSquare, Circle, GripVertical, LayoutGrid, List, Plus, Repeat2, RotateCcw, Search, Trash2 } from 'lucide-react'
import type { Task, TaskLayout, TaskPriority, TaskView } from '../../../shared/types'
import type { ModuleProps } from '../lib/navigation'
import { useSettings, updateSettings } from '../lib/settingsStore'
import { useTaskFilters } from '../lib/useTaskFilters'
import { today, formatDate } from '../lib/dates'
import { errMsg } from '../lib/errors'
import { PageHeader } from '../components/PageHeader'
import { EmptyState } from '../components/EmptyState'
import { TaskEditor } from './TaskEditor'
import { TaskBoard } from './TaskBoard'

const VIEWS: { id: TaskView; label: string }[] = [
  { id: 'today', label: 'Today' }, { id: 'upcoming', label: 'Upcoming' }, { id: 'overdue', label: 'Overdue' },
  { id: 'all', label: 'All' }, { id: 'completed', label: 'Completed' }
]

const LAYOUTS: { id: TaskLayout; label: string; icon: typeof List }[] = [
  { id: 'list', label: 'List', icon: List },
  { id: 'board', label: 'Board', icon: LayoutGrid }
]

type BulkAction = 'done' | 'todo' | 'delete'

export function Tasks(_props: ModuleProps) {
  const settings = useSettings()
  const layout = settings.taskLayout
  const day = today()
  const [tasks, setTasks] = useState<Task[]>([])
  const [loaded, setLoaded] = useState(false)
  const [quick, setQuick] = useState('')
  const [editing, setEditing] = useState<Task | 'new' | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState<number | null>(null)
  const [dragId, setDragId] = useState<number | null>(null)
  const [selectMode, setSelectMode] = useState(false)
  const [selected, setSelected] = useState<Set<number>>(() => new Set())
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [bulkBusy, setBulkBusy] = useState(false)
  const searchRef = useRef<HTMLInputElement>(null)
  // Both views take their tasks from this one hook, so the filters and the result never differ.
  const filters = useTaskFilters(tasks, day)
  const { view, setView, text, priority, project, tag, filter, filtered, projects, tags, filtering } = filters

  const refresh = useCallback(async () => {
    try { setTasks(await window.api.tasks.list()); setLoaded(true); setError('') }
    catch (e) { setError(errMsg(e)); setLoaded(true) }
  }, [])
  useEffect(() => { refresh() }, [refresh])

  useEffect(() => {
    const create = () => setEditing('new')
    const goToday = () => setView('today')
    const goBoard = () => updateSettings({ taskLayout: 'board' })
    window.addEventListener('tasks:new', create)
    window.addEventListener('tasks:today', goToday)
    window.addEventListener('tasks:board', goBoard)
    return () => {
      window.removeEventListener('tasks:new', create); window.removeEventListener('tasks:today', goToday)
      window.removeEventListener('tasks:board', goBoard)
    }
  }, [setView])

  // A selection only means something inside the list it was made in, so changing what is shown starts fresh.
  useEffect(() => { setSelected(new Set()); setConfirmDelete(false) }, [view, text, priority, project, tag])

  // The board has no selection toolbar: leaving it drops any selection made in the list.
  useEffect(() => { if (layout === 'board' && selectMode) { setSelectMode(false); setSelected(new Set()); setConfirmDelete(false) } }, [layout, selectMode])

  const add = async (title = quick) => {
    if (!title.trim()) return
    try {
      await window.api.tasks.create({ title: title.trim(), notes: '', status: 'todo', priority: 'medium', dueDate: view === 'today' ? day : null, dueTime: null,
        project: '', tags: [], subtasks: [], recurrenceRule: null, recurrenceNext: null })
      setQuick(''); setEditing(null); await refresh()
    } catch (e) { setError(errMsg(e)) }
  }

  const allSelected = filtered.length > 0 && filtered.every((t) => selected.has(t.id))

  const toggle = useCallback(async (id: number) => {
    if (busy !== null) return
    const task = tasks.find((t) => t.id === id)
    if (!task) return
    setBusy(id)
    try {
      await window.api.tasks.setStatus(id, task.status === 'done' ? 'todo' : 'done')
      setSelected((prev) => { const next = new Set(prev); next.delete(id); return next })
      await refresh()
    } catch (e) { setError(errMsg(e)) }
    setBusy(null)
  }, [busy, refresh, tasks])

  const toggleSelect = useCallback((id: number) => {
    setConfirmDelete(false)
    setSelected((prev) => { const next = new Set(prev); if (next.has(id)) next.delete(id); else next.add(id); return next })
  }, [])

  const selectAll = () => {
    setConfirmDelete(false)
    setSelected(allSelected ? new Set() : new Set(filtered.map((t) => t.id)))
  }

  const leaveSelectMode = () => { setSelectMode(false); setSelected(new Set()); setConfirmDelete(false) }

  const bulk = async (action: BulkAction) => {
    const ids = [...selected]
    if (ids.length === 0 || bulkBusy) return
    setBulkBusy(true)
    try {
      if (action === 'delete') await window.api.tasks.removeMany(ids)
      else await window.api.tasks.setStatusMany(ids, action)
      setSelected(new Set()); setConfirmDelete(false); await refresh()
    } catch (e) { setError(errMsg(e)) }
    setBulkBusy(false)
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.isComposing || e.altKey || e.ctrlKey || e.metaKey || e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLSelectElement) return
      if (e.key === '/') { e.preventDefault(); searchRef.current?.focus(); searchRef.current?.select(); return }
      if (e.key.toLowerCase() === 'n') { e.preventDefault(); setEditing('new') }
      if (layout === 'list' && e.code === 'Space' && e.target instanceof HTMLElement && e.target.dataset.taskRow === 'true') {
        const id = Number(e.target.dataset.taskId)
        if (id) { e.preventDefault(); if (selectMode) toggleSelect(id); else void toggle(id) }
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [layout, selectMode, toggle, toggleSelect])

  const reorder = async (targetId: number) => {
    if (dragId === null || dragId === targetId) return
    const group = filtered.filter((t) => t.status !== 'done')
    const from = group.findIndex((t) => t.id === dragId), to = group.findIndex((t) => t.id === targetId)
    if (from < 0 || to < 0) return
    const ordered = [...group]
    ordered.splice(to, 0, ordered.splice(from, 1)[0])
    try { await window.api.tasks.reorder(ordered.map((t) => t.id)); await refresh() }
    catch (e) { setError(errMsg(e)) }
    setDragId(null)
  }

  const title = VIEWS.find((v) => v.id === view)?.label ?? 'Tasks'
  return (
    <div className="page page-lg">
      <PageHeader title="Tasks" subtitle={`${filtered.length}${filtering ? ` of ${tasks.length}` : ''} ${filtered.length === 1 ? 'task' : 'tasks'} · local only`}>
        {layout === 'list' && (
          <button className={`btn ${selectMode ? 'border-accent text-accent-fg' : ''}`} aria-pressed={selectMode} onClick={() => (selectMode ? leaveSelectMode() : setSelectMode(true))}>
            <CheckSquare size={16} /> {selectMode ? 'Done' : 'Select'}
          </button>
        )}
        <button className="btn-primary" onClick={() => setEditing('new')} title="N"><Plus size={16} /> New task</button>
      </PageHeader>
      <div className="mt-1 flex flex-wrap items-center justify-between gap-2">
        <div className="seg seg-tabs flex flex-wrap" role="tablist" aria-label="Task views">
          {VIEWS.map((item) => <button key={item.id} role="tab" aria-selected={view === item.id} onClick={() => filters.setView(item.id)}>{item.label}</button>)}
        </div>
        <div className="seg flex flex-wrap" role="group" aria-label="Task layout">
          {LAYOUTS.map((item) => {
            const Icon = item.icon
            return <button key={item.id} aria-pressed={layout === item.id} onClick={() => updateSettings({ taskLayout: item.id })}><Icon size={14} className="mr-1 inline" />{item.label}</button>
          })}
        </div>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
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
      </div>
      {selectMode && layout === 'list' && (
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
                <button className="btn-icon hover:text-neg" aria-label={`Delete ${selected.size} selected ${selected.size === 1 ? 'task' : 'tasks'}`}
                  onClick={() => setConfirmDelete(true)} disabled={selected.size === 0 || bulkBusy}><Trash2 size={15} /></button>
              </>
            )}
          </div>
        </div>
      )}
      <form className="card card-pad-sm mt-4 flex gap-2" onSubmit={(e) => { e.preventDefault(); void add() }}>
        <input className="field" value={quick} onChange={(e) => setQuick(e.target.value)} placeholder="Add a task… (Enter to add)" aria-label="Quick add task" />
        <button type="submit" className="btn-primary" aria-label="Add task"><Plus size={16} /></button>
      </form>
      {error && <p role="alert" className="mt-3 text-sm text-neg">{error}</p>}
      {layout === 'board' ? (
        <div className="mt-4">
          <TaskBoard tasks={tasks} filter={filter} today={day} loaded={loaded} refresh={refresh}
            onEdit={(task) => setEditing(task)} onNew={() => setEditing('new')} onError={setError} />
        </div>
      ) : (
        <div className="mt-4 flex flex-col gap-2">
          {loaded && filtered.length === 0 && <EmptyState icon={CheckSquare}
            title={tasks.length === 0 ? 'A clear list is a good place to begin.' : `No tasks in ${title.toLowerCase()}.`}
            text={tasks.length === 0 ? 'Add one small thing you would like to get done.' : 'Try another view, search term, or clear a filter.'}
            action={<button className="btn-primary" onClick={() => setEditing('new')}><Plus size={16} /> Create a task</button>} />}
          {filtered.map((task) => {
            const overdue = (task.recurrenceNext ?? task.dueDate) !== null && ((task.recurrenceNext ?? task.dueDate) || '') < day && task.status !== 'done'
            const done = task.status === 'done'
            const picked = selected.has(task.id)
            return (
              <article key={task.id} data-task-id={task.id} data-task-row="true" tabIndex={0} onDoubleClick={() => { if (!selectMode) setEditing(task) }}
                onKeyDown={(e) => { if (e.key === 'Enter' && !selectMode) setEditing(task) }}
                draggable={view !== 'completed' && !selectMode} onDragStart={() => setDragId(task.id)} onDragOver={(e) => e.preventDefault()} onDrop={() => reorder(task.id)}
                className={`card card-pad-sm flex items-center gap-3 ${done ? 'opacity-70' : ''} ${picked ? 'border-accent ring-1 ring-accent' : overdue ? 'border-neg/60' : ''}`}>
                {selectMode
                  ? <input type="checkbox" className="h-4 w-4 shrink-0 accent-accent" checked={picked} onChange={() => toggleSelect(task.id)} aria-label={`Select ${task.title}`} />
                  : view !== 'completed' && <GripVertical size={16} className="shrink-0 cursor-grab text-muted" aria-label="Drag to reorder" />}
                <button type="button" className={`grid h-6 w-6 shrink-0 place-items-center rounded-md border ${done ? 'border-accent bg-accent text-on-accent' : 'border-line hover:border-accent'}`}
                  aria-label={`${done ? 'Mark not done' : 'Mark done'}: ${task.title}`} aria-pressed={done} disabled={busy === task.id} onClick={() => toggle(task.id)}>
                  {done ? <Check size={15} /> : <Circle size={14} className="text-transparent" />}
                </button>
                <button type="button" onClick={() => (selectMode ? toggleSelect(task.id) : setEditing(task))} className="min-w-0 flex-1 text-left">
                  <span className={`block truncate text-sm font-medium ${done ? 'text-muted line-through' : ''}`}>{task.title}</span>
                  <span className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted">
                    <span className={`badge badge-${task.priority === 'high' ? 'neg' : 'muted'}`}>{task.priority}</span>
                    {task.dueDate && <span className={`flex items-center gap-1 ${overdue ? 'text-neg font-medium' : ''}`}><CalendarDays size={12} />{overdue ? 'Overdue · ' : ''}{formatDate(task.dueDate)}</span>}
                    {task.project && <span>{task.project}</span>}
                    {task.tags.map((t) => <span key={t}>#{t}</span>)}
                    {task.recurrenceRule && <span title={`Repeats ${task.recurrenceRule.frequency}`}><Repeat2 size={12} aria-label="Recurring" /></span>}
                    {task.subtasks.length > 0 && <span>{task.subtasks.filter((s) => s.done).length}/{task.subtasks.length} checklist</span>}
                  </span>
                </button>
              </article>
            )
          })}
        </div>
      )}
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
