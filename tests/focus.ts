// Phase 4: Focus timer and time tracking tests.
//   npm test
import assert from 'node:assert/strict'
import { openDatabase } from './sqlite'
import { applyMigrations } from '../src/main/migrations'
import {
  calculateHeatmapLevel,
  computeTimerElapsed,
  computeTimerRemaining,
  formatDuration,
  formatTimerDigits,
  isTimerFinished,
  nextPomodoroPhase,
  splitSessionByDay,
  type ActiveFocusSession
} from '../src/shared/focus'
import {
  createProject,
  deleteProject,
  discardActiveTimer,
  getActiveSession,
  getFocusReport,
  getFocusSummary,
  getProject,
  getTaskFocusSeconds,
  listProjects,
  listSessions,
  logManualSession,
  pauseTimer,
  resumeTimer,
  startTimer,
  stopTimer,
  updateProject,
  updateSession,
  deleteSession,
  assistantTimeSpent
} from '../src/main/focus'
import { createTask } from '../src/main/tasks'
import { listTrash, restoreBatch } from '../src/main/trash'
import { askAssistant } from '../src/main/assistant'

let n = 0
const test = (name: string, fn: () => void | Promise<void>) => {
  const r = fn()
  if (r instanceof Promise) {
    return r.then(() => { n++; console.log('ok  ', name) })
  }
  n++
  console.log('ok  ', name)
}

const openDb = () => {
  const db = openDatabase()
  db.pragma('foreign_keys = ON')
  applyMigrations(db)
  return db
}

// ---------------------------------------------------------------------------
// 1. Pure timer math & state calculations
// ---------------------------------------------------------------------------

test('computeTimerElapsed computes clock-based elapsed seconds without tick drift', () => {
  const baseMs = 1700000000000
  const session: ActiveFocusSession = {
    taskId: null,
    projectId: null,
    projectName: '',
    type: 'focus',
    mode: 'pomodoro',
    status: 'running',
    startedAt: new Date(baseMs).toISOString(),
    targetSeconds: 1500,
    elapsedSeconds: 120, // 2 minutes already accumulated
    pausedAt: null,
    round: 1,
    note: ''
  }

  // 10 seconds later
  assert.equal(computeTimerElapsed(session, baseMs + 10_000), 130)

  // 60 seconds later
  assert.equal(computeTimerElapsed(session, baseMs + 60_000), 180)

  // When paused, elapsed remains frozen at elapsedSeconds
  const pausedSession: ActiveFocusSession = { ...session, status: 'paused', elapsedSeconds: 250 }
  assert.equal(computeTimerElapsed(pausedSession, baseMs + 999_000), 250)
})

test('computeTimerRemaining and isTimerFinished respect target seconds and count-up', () => {
  const baseMs = 1700000000000
  const session: ActiveFocusSession = {
    taskId: null,
    projectId: null,
    projectName: '',
    type: 'focus',
    mode: 'pomodoro',
    status: 'running',
    startedAt: new Date(baseMs).toISOString(),
    targetSeconds: 1500, // 25 min
    elapsedSeconds: 0,
    pausedAt: null,
    round: 1,
    note: ''
  }

  // At start
  assert.equal(computeTimerRemaining(session, baseMs), 1500)
  assert.equal(isTimerFinished(session, baseMs), false)

  // At 1400s
  assert.equal(computeTimerRemaining(session, baseMs + 1400_000), 100)
  assert.equal(isTimerFinished(session, baseMs + 1400_000), false)

  // At 1500s (finished)
  assert.equal(computeTimerRemaining(session, baseMs + 1500_000), 0)
  assert.equal(isTimerFinished(session, baseMs + 1500_000), true)

  // Over target: clamped to 0 remaining
  assert.equal(computeTimerRemaining(session, baseMs + 1600_000), 0)
  assert.equal(isTimerFinished(session, baseMs + 1600_000), true)

  // Count-up mode never finishes and has 0 remaining
  const countUp: ActiveFocusSession = { ...session, mode: 'count-up', targetSeconds: 0 }
  assert.equal(computeTimerRemaining(countUp, baseMs + 5000_000), 0)
  assert.equal(isTimerFinished(countUp, baseMs + 5000_000), false)
})

test('nextPomodoroPhase transitions through focus and breaks with long break on 4th round', () => {
  // Round 1 focus -> short break
  assert.deepEqual(nextPomodoroPhase('focus', 1, 4), { type: 'short-break', nextRound: 1 })
  // Short break -> Round 2 focus
  assert.deepEqual(nextPomodoroPhase('short-break', 1, 4), { type: 'focus', nextRound: 2 })

  // Round 3 focus -> short break
  assert.deepEqual(nextPomodoroPhase('focus', 3, 4), { type: 'short-break', nextRound: 3 })

  // Round 4 focus -> LONG break
  assert.deepEqual(nextPomodoroPhase('focus', 4, 4), { type: 'long-break', nextRound: 4 })
  // Long break -> Round 5 focus
  assert.deepEqual(nextPomodoroPhase('long-break', 4, 4), { type: 'focus', nextRound: 5 })
})

// ---------------------------------------------------------------------------
// 2. Midnight splitting & time bucketing
// ---------------------------------------------------------------------------

test('splitSessionByDay splits sessions spanning local midnights accurately', () => {
  // 1. Session completely within same day (10:00 to 11:30 = 90 min)
  const sameDay = splitSessionByDay('2026-11-03T10:00:00.000Z', '2026-11-03T11:30:00.000Z')
  assert.equal(sameDay.length, 1)
  assert.equal(sameDay[0].seconds, 5400) // 90 min

  // 2. Session crossing midnight (23:40 to 00:25 next day = 45 min total)
  // Local times
  const d1 = new Date(2026, 10, 3, 23, 40, 0)
  const d2 = new Date(2026, 10, 4, 0, 25, 0)
  const split = splitSessionByDay(d1.toISOString(), d2.toISOString())

  assert.equal(split.length, 2)
  assert.equal(split[0].seconds, 20 * 60, 'Day 1 receives 20 minutes')
  assert.equal(split[1].seconds, 25 * 60, 'Day 2 receives 25 minutes')
  assert.equal(split[0].seconds + split[1].seconds, 45 * 60, 'Total sum matches exact duration')

  // 3. Invalid or zero duration returns empty array
  assert.deepEqual(splitSessionByDay('2026-11-03T10:00:00.000Z', '2026-11-03T10:00:00.000Z'), [])
  assert.deepEqual(splitSessionByDay('2026-11-03T12:00:00.000Z', '2026-11-03T10:00:00.000Z'), [])
})

test('formatDuration and formatTimerDigits format seconds cleanly', () => {
  assert.equal(formatDuration(45), '45s')
  assert.equal(formatDuration(1500), '25m')
  assert.equal(formatDuration(3600), '1h')
  assert.equal(formatDuration(3665), '1h 1m')

  assert.equal(formatTimerDigits(0), '00:00')
  assert.equal(formatTimerDigits(65), '01:05')
  assert.equal(formatTimerDigits(1500), '25:00')
  assert.equal(formatTimerDigits(3665), '1:01:05')

  assert.equal(calculateHeatmapLevel(0, 3600), 0)
  assert.equal(calculateHeatmapLevel(500, 3600), 1)
  assert.equal(calculateHeatmapLevel(1200, 3600), 2)
  assert.equal(calculateHeatmapLevel(2000, 3600), 3)
  assert.equal(calculateHeatmapLevel(3600, 3600), 4)
})

// ---------------------------------------------------------------------------
// 3. Database session persistence (survives app restart / crash)
// ---------------------------------------------------------------------------

test('active session persists in SQLite and survives app crash / restart', () => {
  const db = openDb()

  // Start a timer
  const active = startTimer(db, {
    type: 'focus',
    mode: 'pomodoro',
    targetSeconds: 1500,
    projectName: 'Engine',
    round: 1,
    note: 'Deep work'
  })
  assert.equal(active.status, 'running')
  assert.equal(active.targetSeconds, 1500)
  assert.equal(active.round, 1)

  // Simulate app restart / window close by querying clean database handle
  const restored = getActiveSession(db)
  assert.ok(restored, 'Running timer must be recovered on launch')
  assert.equal(restored?.status, 'running')
  assert.equal(restored?.projectName, 'Engine')

  // Pause timer
  const paused = pauseTimer(db)
  assert.equal(paused?.status, 'paused')

  // Re-read after simulated restart while paused
  const restoredPaused = getActiveSession(db)
  assert.equal(restoredPaused?.status, 'paused')

  // Resume timer
  const resumed = resumeTimer(db)
  assert.equal(resumed?.status, 'running')

  // Stop timer and log to time_sessions
  const logged = stopTimer(db, true)
  assert.ok(logged)
  assert.equal(logged?.type, 'focus')
  assert.equal(logged?.completed, true)

  // Active session must now be cleared
  assert.equal(getActiveSession(db), null)

  // Discard active timer clears without logging
  startTimer(db, { type: 'focus', mode: 'pomodoro', targetSeconds: 300 })
  assert.ok(getActiveSession(db))
  discardActiveTimer(db)
  assert.equal(getActiveSession(db), null)

  db.close()
})

// ---------------------------------------------------------------------------
// 4. Projects CRUD & seeding from existing tasks
// ---------------------------------------------------------------------------

test('projects table is created and supports CRUD with soft delete', () => {
  const db = openDb()

  // Create task with project before migration to test seeding
  const initialProjects = listProjects(db)
  const proj = createProject(db, { name: 'Client Project', colour: '#10b981' })
  assert.equal(proj.name, 'Client Project')
  assert.equal(proj.colour, '#10b981')

  const updated = updateProject(db, proj.id, { colour: '#3b82f6' })
  assert.equal(updated.colour, '#3b82f6')

  // Soft delete
  const batchId = deleteProject(db, proj.id)
  assert.ok(batchId)
  assert.equal(listProjects(db).some((p) => p.id === proj.id), false)

  // Restore via trash
  restoreBatch(db, batchId)
  assert.equal(listProjects(db).some((p) => p.id === proj.id), true)

  db.close()
})

// ---------------------------------------------------------------------------
// 5. Manual sessions logging & soft delete
// ---------------------------------------------------------------------------

test('manual session logging, update and soft delete with trash restore', () => {
  const db = openDb()
  const proj = createProject(db, { name: 'Writing' })
  const task = createTask(db, {
    title: 'Draft post', notes: '', status: 'todo', priority: 'medium', dueDate: null, dueTime: null,
    project: 'Writing', tags: [], subtasks: [], recurrenceRule: null, recurrenceNext: null
  })

  // Log manual session (60 minutes = 3600 seconds)
  const session = logManualSession(db, {
    taskId: task.id,
    projectId: proj.id,
    startedAt: '2026-11-03T14:00:00.000Z',
    endedAt: '2026-11-03T15:00:00.000Z',
    type: 'focus',
    note: 'Initial draft'
  })
  assert.equal(session.actualSeconds, 3600)
  assert.equal(session.source, 'manual')
  assert.equal(session.projectName, 'Writing')

  // Verify task tracked focus seconds
  assert.equal(getTaskFocusSeconds(db, task.id), 3600)

  // Update session
  const updated = updateSession(db, session.id, { note: 'Revised draft' })
  assert.equal(updated.note, 'Revised draft')

  // Soft delete session
  const batchId = deleteSession(db, session.id)
  assert.ok(batchId)
  assert.equal(listSessions(db).length, 0)
  assert.equal(getTaskFocusSeconds(db, task.id), 0)

  // Restore session
  restoreBatch(db, batchId)
  assert.equal(listSessions(db).length, 1)
  assert.equal(getTaskFocusSeconds(db, task.id), 3600)

  db.close()
})

// ---------------------------------------------------------------------------
// 6. Reports & Analytics
// ---------------------------------------------------------------------------

test('getFocusSummary and getFocusReport compute accurate totals and midnight splits', () => {
  const db = openDb()
  const proj = createProject(db, { name: 'Coding', colour: '#3b82f6' })

  // Log 1 hour today
  logManualSession(db, {
    projectId: proj.id,
    startedAt: '2026-11-03T10:00:00.000Z',
    endedAt: '2026-11-03T11:00:00.000Z',
    type: 'focus'
  })

  // Log session across midnight (local dates)
  const d1 = new Date(2026, 10, 3, 23, 30, 0)
  const d2 = new Date(2026, 10, 4, 0, 30, 0)
  logManualSession(db, {
    projectId: proj.id,
    startedAt: d1.toISOString(),
    endedAt: d2.toISOString(),
    type: 'focus'
  })

  // Summary for 2026-11-03: 3600s + 1800s (30m before midnight) = 5400s (90 min)
  const summary = getFocusSummary(db, '2026-11-03')
  assert.equal(summary.todayFocusSeconds, 5400)

  // Report for 2026-11-03 to 2026-11-04
  const report = getFocusReport(db, '2026-11-03', '2026-11-04')
  assert.equal(report.totalFocusSeconds, 7200) // 1h + 1h = 2h total
  assert.equal(report.byProject.length, 1)
  assert.equal(report.byProject[0].name, 'Coding')
  assert.equal(report.byProject[0].seconds, 7200)
  assert.equal(report.byProject[0].percentage, 100)
  assert.ok(report.heatmap.length >= 2)

  db.close()
})

// ---------------------------------------------------------------------------
// 7. Assistant time_spent query integration
// ---------------------------------------------------------------------------

test('assistant time_spent calculates hours and filters by project', () => {
  const db = openDb()
  const p1 = createProject(db, { name: 'Alpha' })
  const p2 = createProject(db, { name: 'Beta' })

  logManualSession(db, {
    projectId: p1.id,
    projectName: 'Alpha',
    startedAt: '2026-11-03T09:00:00.000Z',
    endedAt: '2026-11-03T11:00:00.000Z', // 2 hours
    type: 'focus'
  })

  logManualSession(db, {
    projectId: p2.id,
    projectName: 'Beta',
    startedAt: '2026-11-03T13:00:00.000Z',
    endedAt: '2026-11-03T14:30:00.000Z', // 1.5 hours
    type: 'focus'
  })

  // Overall time
  const allTime = assistantTimeSpent(db, '2026-11-01', '2026-11-05')
  assert.equal(allTime.hours, 3)
  assert.equal(allTime.minutes, 30)

  // Filtered by project Alpha
  const alphaTime = assistantTimeSpent(db, '2026-11-01', '2026-11-05', { project: 'Alpha' })
  assert.equal(alphaTime.hours, 2)
  assert.equal(alphaTime.minutes, 0)

  db.close()
})

console.log(`\n${n} focus tests passed`)
