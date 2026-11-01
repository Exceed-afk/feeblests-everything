// One owner for the Tasks filters. The list and the board both read the result of this hook,
// so switching views (or filtering in either one) always shows exactly the same set of tasks.
import { useMemo, useState } from 'react'
import { filterTasks, sortTasks } from '../../../shared/tasks'
import type { Task, TaskFilter, TaskPriority, TaskSort, TaskView } from '../../../shared/types'

export function useTaskFilters(tasks: Task[], today: string, nowTime = '00:00', sort: TaskSort = 'manual', trashTasks: Task[] = [], completedTasks: Task[] = []) {
  const [view, setView] = useState<TaskView>('today')
  const [text, setText] = useState('')
  const [priority, setPriority] = useState<TaskPriority | ''>('')
  const [project, setProject] = useState('')
  const [tag, setTag] = useState('')

  // The exact filter the shared rules receive; the board is grouped from the same object.
  const filter = useMemo<TaskFilter>(() => ({
    view, text, priority: priority || undefined, project: project || undefined, tag: tag || undefined
  }), [view, text, priority, project, tag])

  const displayedTasks = view === 'trash' ? trashTasks : view === 'completed' ? completedTasks : tasks
  const filtered = useMemo(() => sortTasks(filterTasks(displayedTasks, filter, today, nowTime), sort), [displayedTasks, filter, today, nowTime, sort])
  const projects = useMemo(() => [...new Set(displayedTasks.map((t) => t.project).filter((x): x is string => Boolean(x)))].sort(), [displayedTasks])
  const tags = useMemo(() => [...new Set(displayedTasks.flatMap((t) => t.tags))].sort(), [displayedTasks])

  const clear = () => { setText(''); setPriority(''); setProject(''); setTag('') }

  return {
    view, setView, text, setText, priority, setPriority, project, setProject, tag, setTag,
    filter, filtered, displayedTasks, projects, tags, clear,
    filtering: Boolean(text.trim() || priority || project || tag)
  }
}
