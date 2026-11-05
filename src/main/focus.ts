// Focus timer and time tracking main-process service (Phase 4).
//
// Owns:
// - projects table (lightweight projects)
// - time_sessions table (durable historical log)
// - active_focus_session table (persisting currently running / paused timer across restarts)
import { Notification, powerMonitor } from 'electron'
import type Database from 'better-sqlite3'
import { LIVE, newBatchId, nowIso, trashByWhere } from './repo'
import { indexOne, removeOne } from './searchIndex'
import {
  calculateHeatmapLevel,
  computeTimerElapsed,
  formatDuration,
  splitSessionByDay,
  type ActiveFocusSession,
  type FocusDashboardSummary,
  type FocusHeatmapEntry,
  type FocusProjectBreakdown,
  type FocusReport,
  type FocusTaskBreakdown,
  type FocusTimerMode,
  type FocusType,
  type ManualSessionInput,
  type Project,
  type ProjectInput,
  type TimeSession
} from '../shared/focus'
import type { TrashEntry } from '../shared/trash'

interface ProjectRow {
  id: number
  name: string
  colour: string
  archived: number
  created_at: string
  updated_at: string
  deleted_at: string | null
  delete_batch_id: string | null
}

const toProject = (r: ProjectRow): Project => ({
  id: r.id,
  name: r.name,
  colour: r.colour,
  archived: r.archived === 1,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
  deletedAt: r.deleted_at,
  deleteBatchId: r.delete_batch_id
})

interface SessionRow {
  id: number
  task_id: number | null
  project_id: number | null
  project_name: string
  started_at: string
  ended_at: string
  planned_seconds: number
  actual_seconds: number
  type: FocusType
  completed: number
  note: string
  source: 'timer' | 'manual'
  created_at: string
  updated_at: string
  deleted_at: string | null
  delete_batch_id: string | null
}

const toSession = (r: SessionRow): TimeSession => ({
  id: r.id,
  taskId: r.task_id,
  projectId: r.project_id,
  projectName: r.project_name,
  startedAt: r.started_at,
  endedAt: r.ended_at,
  plannedSeconds: r.planned_seconds,
  actualSeconds: r.actual_seconds,
  type: r.type,
  completed: r.completed === 1,
  note: r.note,
  source: r.source,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
  deletedAt: r.deleted_at,
  deleteBatchId: r.delete_batch_id
})

interface ActiveRow {
  id: number
  task_id: number | null
  project_id: number | null
  project_name: string
  type: FocusType
  mode: FocusTimerMode
  status: 'running' | 'paused'
  started_at: string
  target_seconds: number
  elapsed_seconds: number
  paused_at: string | null
  round: number
  note: string
  updated_at: string
}

const toActiveSession = (r: ActiveRow): ActiveFocusSession => ({
  taskId: r.task_id,
  projectId: r.project_id,
  projectName: r.project_name,
  type: r.type,
  mode: r.mode,
  status: r.status,
  startedAt: r.started_at,
  targetSeconds: r.target_seconds,
  elapsedSeconds: r.elapsed_seconds,
  pausedAt: r.paused_at,
  round: r.round,
  note: r.note
})

// ---------- Projects CRUD ----------

export function listProjects(db: Database.Database, includeArchived = false): Project[] {
  const archiveFilter = includeArchived ? '' : 'AND archived = 0'
  const rows = db.prepare(
    `SELECT * FROM projects WHERE ${LIVE()} ${archiveFilter} ORDER BY name ASC`
  ).all() as ProjectRow[]
  return rows.map(toProject)
}

export function getProject(db: Database.Database, id: number): Project {
  const row = db.prepare(
    `SELECT * FROM projects WHERE id = ? AND ${LIVE()}`
  ).get(id) as ProjectRow | undefined
  if (!row) throw new Error(`Project not found (id: ${id})`)
  return toProject(row)
}

export function createProject(db: Database.Database, input: ProjectInput): Project {
  const name = input.name.trim()
  if (!name) throw new Error('Project name cannot be empty')
  const colour = input.colour?.trim() || '#8b5cf6'
  const now = nowIso()

  const info = db.prepare(
    `INSERT INTO projects (name, colour, archived, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?)`
  ).run(name, colour, input.archived ? 1 : 0, now, now)

  return getProject(db, Number(info.lastInsertRowid))
}

export function updateProject(db: Database.Database, id: number, input: Partial<ProjectInput>): Project {
  const existing = getProject(db, id)
  const name = input.name !== undefined ? input.name.trim() : existing.name
  if (!name) throw new Error('Project name cannot be empty')
  const colour = input.colour !== undefined ? input.colour.trim() : existing.colour
  const archived = input.archived !== undefined ? (input.archived ? 1 : 0) : (existing.archived ? 1 : 0)
  const now = nowIso()

  db.prepare(
    `UPDATE projects SET name = ?, colour = ?, archived = ?, updated_at = ?
     WHERE id = ? AND ${LIVE()}`
  ).run(name, colour, archived, now, id)

  return getProject(db, id)
}

export function deleteProject(db: Database.Database, id: number): string {
  getProject(db, id)
  const batchId = newBatchId()
  const changes = trashByWhere(db, 'projects', `id = ? AND ${LIVE()}`, [id], batchId)
  if (changes === 0) throw new Error('Project not found')
  return batchId
}

// ---------- Active Focus Session (Persisted across window close / restart) ----------

export function getActiveSession(db: Database.Database): ActiveFocusSession | null {
  const row = db.prepare('SELECT * FROM active_focus_session WHERE id = 1').get() as ActiveRow | undefined
  if (!row) return null
  return toActiveSession(row)
}

export function startTimer(
  db: Database.Database,
  params: {
    type: FocusType
    mode: FocusTimerMode
    targetSeconds: number
    taskId?: number | null
    projectId?: number | null
    projectName?: string
    round?: number
    note?: string
  }
): ActiveFocusSession {
  const now = nowIso()
  let resolvedProjectName = params.projectName ?? ''
  let resolvedProjectId = params.projectId ?? null

  if (params.taskId) {
    const task = db.prepare('SELECT project FROM tasks WHERE id = ?').get(params.taskId) as { project: string | null } | undefined
    if (task?.project && !resolvedProjectName) {
      resolvedProjectName = task.project
      const proj = db.prepare('SELECT id FROM projects WHERE name = ? AND deleted_at IS NULL').get(task.project) as { id: number } | undefined
      if (proj && !resolvedProjectId) resolvedProjectId = proj.id
    }
  }

  if (resolvedProjectId && !resolvedProjectName) {
    const proj = db.prepare('SELECT name FROM projects WHERE id = ?').get(resolvedProjectId) as { name: string } | undefined
    if (proj) resolvedProjectName = proj.name
  }

  db.prepare(
    `INSERT INTO active_focus_session
       (id, task_id, project_id, project_name, type, mode, status, started_at, target_seconds, elapsed_seconds, paused_at, round, note, updated_at)
     VALUES (1, ?, ?, ?, ?, ?, 'running', ?, ?, 0, NULL, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       task_id = excluded.task_id,
       project_id = excluded.project_id,
       project_name = excluded.project_name,
       type = excluded.type,
       mode = excluded.mode,
       status = 'running',
       started_at = excluded.started_at,
       target_seconds = excluded.target_seconds,
       elapsed_seconds = 0,
       paused_at = NULL,
       round = excluded.round,
       note = excluded.note,
       updated_at = excluded.updated_at`
  ).run(
    resolvedProjectId ? resolvedProjectId : null,
    params.taskId ?? null,
    resolvedProjectName,
    params.type,
    params.mode,
    now,
    Math.max(0, Math.round(params.targetSeconds)),
    Math.max(1, Math.round(params.round ?? 1)),
    params.note ?? '',
    now
  )

  const active = getActiveSession(db)
  if (!active) throw new Error('Failed to start active focus session')
  return active
}

export function pauseTimer(db: Database.Database): ActiveFocusSession | null {
  const active = getActiveSession(db)
  if (!active) return null
  if (active.status === 'paused') return active

  const elapsed = computeTimerElapsed(active)
  const now = nowIso()

  db.prepare(
    `UPDATE active_focus_session
     SET status = 'paused', elapsed_seconds = ?, paused_at = ?, updated_at = ?
     WHERE id = 1`
  ).run(elapsed, now, now)

  return getActiveSession(db)
}

export function resumeTimer(db: Database.Database): ActiveFocusSession | null {
  const active = getActiveSession(db)
  if (!active) return null
  if (active.status === 'running') return active

  const now = nowIso()

  db.prepare(
    `UPDATE active_focus_session
     SET status = 'running', started_at = ?, paused_at = NULL, updated_at = ?
     WHERE id = 1`
  ).run(now, now)

  return getActiveSession(db)
}

export function stopTimer(
  db: Database.Database,
  completed = true,
  noteOverride?: string
): TimeSession | null {
  const active = getActiveSession(db)
  if (!active) return null

  const actualSeconds = Math.max(1, computeTimerElapsed(active))
  const endedAt = nowIso()
  const startedAt = new Date(new Date(endedAt).getTime() - actualSeconds * 1000).toISOString()
  const note = noteOverride !== undefined ? noteOverride.trim() : active.note

  let loggedSession: TimeSession | null = null

  db.transaction(() => {
    // Only record if some time was spent (> 0 seconds)
    if (actualSeconds > 0) {
      const now = nowIso()
      const info = db.prepare(
        `INSERT INTO time_sessions
           (task_id, project_id, project_name, started_at, ended_at, planned_seconds, actual_seconds, type, completed, note, source, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'timer', ?, ?)`
      ).run(
        active.taskId,
        active.projectId,
        active.projectName,
        startedAt,
        endedAt,
        active.targetSeconds,
        actualSeconds,
        active.type,
        completed ? 1 : 0,
        note,
        now,
        now
      )
      const row = db.prepare('SELECT * FROM time_sessions WHERE id = ?').get(info.lastInsertRowid) as SessionRow
      loggedSession = toSession(row)
      indexOne(db, 'time_session', loggedSession.id)
    }

    db.prepare('DELETE FROM active_focus_session WHERE id = 1').run()
  })()

  return loggedSession
}

export function discardActiveTimer(db: Database.Database): void {
  db.prepare('DELETE FROM active_focus_session WHERE id = 1').run()
}

// ---------- Manual Session Logging ----------

export function logManualSession(db: Database.Database, input: ManualSessionInput): TimeSession {
  const startedMs = new Date(input.startedAt).getTime()
  const endedMs = new Date(input.endedAt).getTime()
  if (Number.isNaN(startedMs) || Number.isNaN(endedMs)) {
    throw new Error('Invalid start or end date format')
  }
  if (endedMs <= startedMs) {
    throw new Error('End time must be after start time')
  }

  const calculatedSeconds = Math.round((endedMs - startedMs) / 1000)
  const actualSeconds = input.actualSeconds !== undefined ? Math.max(1, Math.round(input.actualSeconds)) : calculatedSeconds
  const plannedSeconds = input.plannedSeconds !== undefined ? Math.max(0, Math.round(input.plannedSeconds)) : actualSeconds
  const type = input.type ?? 'focus'
  const completed = input.completed !== undefined ? (input.completed ? 1 : 0) : 1
  const note = input.note ? input.note.trim() : ''

  let resolvedProjectName = input.projectName ?? ''
  let resolvedProjectId = input.projectId ?? null

  if (input.taskId) {
    const task = db.prepare('SELECT project FROM tasks WHERE id = ?').get(input.taskId) as { project: string | null } | undefined
    if (task?.project && !resolvedProjectName) {
      resolvedProjectName = task.project
      const proj = db.prepare('SELECT id FROM projects WHERE name = ? AND deleted_at IS NULL').get(task.project) as { id: number } | undefined
      if (proj && !resolvedProjectId) resolvedProjectId = proj.id
    }
  }

  if (resolvedProjectId && !resolvedProjectName) {
    const proj = db.prepare('SELECT name FROM projects WHERE id = ?').get(resolvedProjectId) as { name: string } | undefined
    if (proj) resolvedProjectName = proj.name
  }

  const now = nowIso()
  const info = db.prepare(
    `INSERT INTO time_sessions
       (task_id, project_id, project_name, started_at, ended_at, planned_seconds, actual_seconds, type, completed, note, source, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'manual', ?, ?)`
  ).run(
    input.taskId ?? null,
    resolvedProjectId,
    resolvedProjectName,
    input.startedAt,
    input.endedAt,
    plannedSeconds,
    actualSeconds,
    type,
    completed,
    note,
    now,
    now
  )

  const row = db.prepare('SELECT * FROM time_sessions WHERE id = ?').get(info.lastInsertRowid) as SessionRow
  const created = toSession(row)
  indexOne(db, 'time_session', created.id)
  return created
}

export function updateSession(
  db: Database.Database,
  id: number,
  input: Partial<ManualSessionInput>
): TimeSession {
  const existingRow = db.prepare(`SELECT * FROM time_sessions WHERE id = ? AND ${LIVE()}`).get(id) as SessionRow | undefined
  if (!existingRow) throw new Error('Session not found')

  const startedAt = input.startedAt ?? existingRow.started_at
  const endedAt = input.endedAt ?? existingRow.ended_at
  const startedMs = new Date(startedAt).getTime()
  const endedMs = new Date(endedAt).getTime()
  if (endedMs <= startedMs) throw new Error('End time must be after start time')

  const calculatedSeconds = Math.round((endedMs - startedMs) / 1000)
  const actualSeconds = input.actualSeconds !== undefined ? Math.round(input.actualSeconds) : calculatedSeconds
  const plannedSeconds = input.plannedSeconds !== undefined ? Math.round(input.plannedSeconds) : existingRow.planned_seconds
  const type = input.type ?? existingRow.type
  const completed = input.completed !== undefined ? (input.completed ? 1 : 0) : existingRow.completed
  const note = input.note !== undefined ? input.note.trim() : existingRow.note
  const taskId = input.taskId !== undefined ? input.taskId : existingRow.task_id
  const projectId = input.projectId !== undefined ? input.projectId : existingRow.project_id
  const projectName = input.projectName !== undefined ? input.projectName : existingRow.project_name
  const now = nowIso()

  db.prepare(
    `UPDATE time_sessions
     SET started_at = ?, ended_at = ?, planned_seconds = ?, actual_seconds = ?,
         type = ?, completed = ?, note = ?, task_id = ?, project_id = ?,
         project_name = ?, updated_at = ?
     WHERE id = ? AND ${LIVE()}`
  ).run(startedAt, endedAt, plannedSeconds, actualSeconds, type, completed, note, taskId, projectId, projectName, now, id)

  const updated = db.prepare('SELECT * FROM time_sessions WHERE id = ?').get(id) as SessionRow
  const sess = toSession(updated)
  indexOne(db, 'time_session', sess.id)
  return sess
}

export function deleteSession(db: Database.Database, id: number): string {
  const existing = db.prepare(`SELECT id FROM time_sessions WHERE id = ? AND ${LIVE()}`).get(id)
  if (!existing) throw new Error('Session not found')
  const batchId = newBatchId()
  trashByWhere(db, 'time_sessions', `id = ? AND ${LIVE()}`, [id], batchId)
  removeOne(db, 'time_session', id)
  return batchId
}

export function listSessions(
  db: Database.Database,
  filter?: { from?: string; to?: string; projectId?: number; taskId?: number; type?: FocusType }
): TimeSession[] {
  const conditions = [LIVE()]
  const params: unknown[] = []

  if (filter?.from) {
    conditions.push('ended_at >= ?')
    params.push(filter.from)
  }
  if (filter?.to) {
    conditions.push('started_at <= ?')
    params.push(`${filter.to}T23:59:59.999Z`)
  }
  if (filter?.projectId) {
    conditions.push('project_id = ?')
    params.push(filter.projectId)
  }
  if (filter?.taskId) {
    conditions.push('task_id = ?')
    params.push(filter.taskId)
  }
  if (filter?.type) {
    conditions.push('type = ?')
    params.push(filter.type)
  }

  const rows = db.prepare(
    `SELECT * FROM time_sessions WHERE ${conditions.join(' AND ')} ORDER BY started_at DESC, id DESC`
  ).all(...params) as SessionRow[]

  return rows.map(toSession)
}

// ---------- Reports & Analytics with Midnight Splitting ----------

// One session row as the report needs it (no database here, so the math is testable).
interface ReportSession {
  type: FocusType
  completed: number
  started_at: string
  ended_at: string
  project_id: number | null
  task_id: number | null
  project_name: string
}

// The aggregates one report builds up from its sessions.
interface ReportTotals {
  totalFocusSeconds: number
  totalBreakSeconds: number
  sessionsCount: number
  completedRounds: number
  dailyTotals: Record<string, number>
  projectSeconds: Map<number | null, { name: string; seconds: number }>
  taskSeconds: Map<number, number>
}

// Walks the sessions, splits each across midnight and adds every slice into the
// right bucket (focus/break, per day, per project, per task). Only slices dated
// inside [from, to] count.
function accumulateSessions(sessions: ReportSession[], from: string, to: string): ReportTotals {
  const totals: ReportTotals = {
    totalFocusSeconds: 0, totalBreakSeconds: 0, sessionsCount: 0, completedRounds: 0,
    dailyTotals: {}, projectSeconds: new Map(), taskSeconds: new Map()
  }
  for (const r of sessions) {
    totals.sessionsCount++
    if (r.completed === 1 && (r.type === 'focus' || r.type === 'count-up')) totals.completedRounds++
    for (const slice of splitSessionByDay(r.started_at, r.ended_at)) {
      if (slice.date < from || slice.date > to) continue
      if (r.type === 'focus' || r.type === 'count-up') {
        totals.totalFocusSeconds += slice.seconds
        totals.dailyTotals[slice.date] = (totals.dailyTotals[slice.date] ?? 0) + slice.seconds
        const name = r.project_name || 'No Project'
        const entry = totals.projectSeconds.get(r.project_id) ?? { name, seconds: 0 }
        entry.seconds += slice.seconds
        totals.projectSeconds.set(r.project_id, entry)
        if (r.task_id) totals.taskSeconds.set(r.task_id, (totals.taskSeconds.get(r.task_id) ?? 0) + slice.seconds)
      } else {
        totals.totalBreakSeconds += slice.seconds
      }
    }
  }
  return totals
}

export function getFocusSummary(db: Database.Database, todayStr: string): FocusDashboardSummary {
  // Query all sessions overlapping today
  const startOfDay = `${todayStr}T00:00:00.000`
  const endOfDay = `${todayStr}T23:59:59.999`

  const rows = db.prepare(
    `SELECT started_at, ended_at, actual_seconds, type, completed
     FROM time_sessions
     WHERE ${LIVE()} AND started_at <= ? AND ended_at >= ?`
  ).all(endOfDay, startOfDay) as Array<{
    started_at: string
    ended_at: string
    actual_seconds: number
    type: FocusType
    completed: number
  }>

  let todayFocusSeconds = 0
  let completedRoundsToday = 0

  for (const r of rows) {
    const slices = splitSessionByDay(r.started_at, r.ended_at)
    for (const slice of slices) {
      if (slice.date === todayStr) {
        if (r.type === 'focus' || r.type === 'count-up') {
          todayFocusSeconds += slice.seconds
          if (r.completed === 1) completedRoundsToday++
        }
      }
    }
  }

  const activeSession = getActiveSession(db)

  return {
    todayFocusSeconds,
    activeSession,
    completedRoundsToday
  }
}

export function getFocusReport(db: Database.Database, fromStr: string, toStr: string): FocusReport {
  const startPeriod = `${fromStr}T00:00:00.000`
  const endPeriod = `${toStr}T23:59:59.999`

  const rows = db.prepare(
    `SELECT id, task_id, project_id, project_name, started_at, ended_at, actual_seconds, type, completed
     FROM time_sessions
     WHERE ${LIVE()} AND started_at <= ? AND ended_at >= ?`
  ).all(endPeriod, startPeriod) as Array<{
    id: number
    task_id: number | null
    project_id: number | null
    project_name: string
    started_at: string
    ended_at: string
    actual_seconds: number
    type: FocusType
    completed: number
  }>

  const totals = accumulateSessions(rows, fromStr, toStr)
  const { totalFocusSeconds, totalBreakSeconds, sessionsCount, completedRounds, dailyTotals, projectSeconds: projectSecondsMap, taskSeconds: taskSecondsMap } = totals

  // Load project colours
  const allProjects = listProjects(db, true)
  const projectColours = new Map<number, string>()
  for (const p of allProjects) projectColours.set(p.id, p.colour)

  const byProject: FocusProjectBreakdown[] = []
  for (const [pId, pData] of projectSecondsMap.entries()) {
    const colour = pId !== null ? (projectColours.get(pId) ?? '#8b5cf6') : '#6b7280'
    const percentage = totalFocusSeconds > 0 ? Math.round((pData.seconds / totalFocusSeconds) * 100) : 0
    byProject.push({
      projectId: pId,
      name: pData.name,
      colour,
      seconds: pData.seconds,
      percentage
    })
  }
  byProject.sort((a, b) => b.seconds - a.seconds)

  // Load task titles
  const byTask: FocusTaskBreakdown[] = []
  for (const [taskId, seconds] of taskSecondsMap.entries()) {
    const task = db.prepare('SELECT title FROM tasks WHERE id = ?').get(taskId) as { title: string } | undefined
    byTask.push({
      taskId,
      title: task?.title ?? `Task #${taskId}`,
      seconds
    })
  }
  byTask.sort((a, b) => b.seconds - a.seconds)

  // Heatmap generation
  let maxDaily = 0
  for (const s of Object.values(dailyTotals)) {
    if (s > maxDaily) maxDaily = s
  }

  const heatmap: FocusHeatmapEntry[] = []
  const [startY, startM, startD] = fromStr.split('-').map(Number)
  const [endY, endM, endD] = toStr.split('-').map(Number)
  const startDate = new Date(Date.UTC(startY, startM - 1, startD))
  const endDate = new Date(Date.UTC(endY, endM - 1, endD))

  for (let d = new Date(startDate); d <= endDate; d.setUTCDate(d.getUTCDate() + 1)) {
    const y = d.getUTCFullYear()
    const m = String(d.getUTCMonth() + 1).padStart(2, '0')
    const day = String(d.getUTCDate()).padStart(2, '0')
    const dateStr = `${y}-${m}-${day}`
    const s = dailyTotals[dateStr] ?? 0
    heatmap.push({
      date: dateStr,
      seconds: s,
      level: calculateHeatmapLevel(s, maxDaily || 7200)
    })
  }

  return {
    from: fromStr,
    to: toStr,
    totalFocusSeconds,
    totalBreakSeconds,
    sessionsCount,
    completedRounds,
    byProject,
    byTask,
    dailyTotals,
    heatmap
  }
}

// Tracked focus time on a specific task
export function getTaskFocusSeconds(db: Database.Database, taskId: number): number {
  const row = db.prepare(
    `SELECT SUM(actual_seconds) AS total FROM time_sessions
     WHERE task_id = ? AND (type = 'focus' OR type = 'count-up') AND ${LIVE()}`
  ).get(taskId) as { total: number | null }
  return row?.total ?? 0
}

// ---------- Assistant Tool: time_spent ----------

export function assistantTimeSpent(
  db: Database.Database,
  fromStr: string,
  toStr: string,
  filter?: { project?: string; task?: string }
): { hours: number; minutes: number; totalSeconds: number; label: string } {
  let projectFilterId: number | null = null
  let taskFilterId: number | null = null
  let label = 'Overall focus time'

  if (filter?.project) {
    const proj = db.prepare('SELECT id, name FROM projects WHERE name LIKE ? AND deleted_at IS NULL').get(`%${filter.project}%`) as { id: number; name: string } | undefined
    if (proj) {
      projectFilterId = proj.id
      label = `Focus time on project "${proj.name}"`
    }
  }

  if (filter?.task) {
    const task = db.prepare('SELECT id, title FROM tasks WHERE title LIKE ? AND deleted_at IS NULL').get(`%${filter.task}%`) as { id: number; title: string } | undefined
    if (task) {
      taskFilterId = task.id
      label = `Focus time on task "${task.title}"`
    }
  }

  const report = getFocusReport(db, fromStr, toStr)
  let totalSeconds = 0

  if (projectFilterId !== null) {
    totalSeconds = report.byProject.find((p) => p.projectId === projectFilterId)?.seconds ?? 0
  } else if (taskFilterId !== null) {
    totalSeconds = report.byTask.find((t) => t.taskId === taskFilterId)?.seconds ?? 0
  } else {
    totalSeconds = report.totalFocusSeconds
  }

  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)

  return { hours, minutes, totalSeconds, label }
}

// ---------- Desktop Notification ----------

export function notifyFocusEnded(title: string, body: string): void {
  try {
    if (Notification.isSupported()) {
      new Notification({ title, body, silent: false }).show()
    }
  } catch {
    // Desktop notifications are progressive enhancement
  }
}

// ---------- Power Monitor for System Suspend / Resume ----------

let powerMonitorSetup = false

export function setupFocusPowerMonitor(db: Database.Database): void {
  if (powerMonitorSetup) return
  powerMonitorSetup = true

  try {
    powerMonitor.on('suspend', () => {
      // System is going to sleep: pause running timer so it doesn't accumulate phantom time while asleep
      const active = getActiveSession(db)
      if (active && active.status === 'running') {
        pauseTimer(db)
      }
    })
  } catch {
    // Power monitor may be unavailable in test environments
  }
}

// ---------- Trash Support ----------

export function describeTrashed(db: Database.Database): TrashEntry[] {
  const sessions = (db.prepare(
    'SELECT id, project_name, actual_seconds, deleted_at, delete_batch_id FROM time_sessions WHERE deleted_at IS NOT NULL'
  ).all() as Array<{ id: number; project_name: string; actual_seconds: number; deleted_at: string; delete_batch_id: string | null }>).map((r) => ({
    type: 'time_session' as const,
    id: r.id,
    batchId: r.delete_batch_id,
    trashedAt: r.deleted_at,
    label: r.project_name ? `Focus session: ${r.project_name}` : 'Focus session',
    sublabel: formatDuration(r.actual_seconds)
  }))

  const projects = (db.prepare(
    'SELECT id, name, deleted_at, delete_batch_id FROM projects WHERE deleted_at IS NOT NULL'
  ).all() as Array<{ id: number; name: string; deleted_at: string; delete_batch_id: string | null }>).map((r) => ({
    type: 'project' as const,
    id: r.id,
    batchId: r.delete_batch_id,
    trashedAt: r.deleted_at,
    label: `Project: ${r.name}`,
    sublabel: 'Project'
  }))

  return [...sessions, ...projects]
}

export function getSessionsByIds(db: Database.Database, ids: number[]): TimeSession[] {
  if (ids.length === 0) return []
  const marks = ids.map(() => '?').join(',')
  const rows = db.prepare(`SELECT * FROM time_sessions WHERE id IN (${marks}) AND ${LIVE()}`).all(...ids) as SessionRow[]
  return rows.map(toSession)
}
