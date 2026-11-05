// Focus timer and time tracking (Phase 4): pure logic, timer math, midnight splitting, and report rules.
//
// Rules from the plan:
// - Do not count ticks: store timestamps and compute remaining/elapsed from the wall clock.
// - Sessions that cross midnight are split by local day for reports.
// - Pure logic, no Electron or DOM imports, fully testable in tsx.

export type FocusType = 'focus' | 'short-break' | 'long-break' | 'count-up'
export type FocusTimerMode = 'pomodoro' | 'count-up'
export type FocusTimerStatus = 'idle' | 'running' | 'paused'

export interface FocusSettings {
  focusDuration: number // in minutes (default 25)
  shortBreakDuration: number // in minutes (default 5)
  longBreakDuration: number // in minutes (default 15)
  longBreakInterval: number // rounds (default 4)
  autoStartBreaks: boolean // default false
  autoStartFocus: boolean // default false
  soundEnabled: boolean // default true
}

export const DEFAULT_FOCUS_SETTINGS: FocusSettings = {
  focusDuration: 25,
  shortBreakDuration: 5,
  longBreakDuration: 15,
  longBreakInterval: 4,
  autoStartBreaks: false,
  autoStartFocus: false,
  soundEnabled: true
}

export interface ActiveFocusSession {
  taskId: number | null
  projectId: number | null
  projectName: string
  type: FocusType
  mode: FocusTimerMode
  status: 'running' | 'paused'
  startedAt: string // ISO timestamp of current running stretch
  targetSeconds: number // e.g. 1500 for 25 min
  elapsedSeconds: number // accumulated seconds prior to current running stretch
  pausedAt: string | null
  round: number
  note: string
}

export interface TimeSession {
  id: number
  taskId: number | null
  projectId: number | null
  projectName: string
  startedAt: string // ISO timestamp
  endedAt: string // ISO timestamp
  plannedSeconds: number
  actualSeconds: number
  type: FocusType
  completed: boolean
  note: string
  source: 'timer' | 'manual'
  createdAt: string
  updatedAt: string
  deletedAt: string | null
  deleteBatchId: string | null
}

export interface Project {
  id: number
  name: string
  colour: string
  archived: boolean
  createdAt: string
  updatedAt: string
  deletedAt: string | null
  deleteBatchId: string | null
}

export interface ProjectInput {
  name: string
  colour?: string
  archived?: boolean
}

export interface ManualSessionInput {
  taskId?: number | null
  projectId?: number | null
  projectName?: string
  startedAt: string // ISO timestamp
  endedAt: string // ISO timestamp
  plannedSeconds?: number
  actualSeconds?: number
  type?: FocusType
  completed?: boolean
  note?: string
}

// ---------- Timer calculations (clock-based, no tick counting) ----------

/**
 * Computes actual elapsed seconds for an active session relative to wall-clock now.
 */
export function computeTimerElapsed(session: ActiveFocusSession, nowMs: number = Date.now()): number {
  if (session.status === 'paused') {
    return session.elapsedSeconds
  }
  const startedMs = new Date(session.startedAt).getTime()
  if (Number.isNaN(startedMs)) return session.elapsedSeconds
  const additional = Math.max(0, Math.floor((nowMs - startedMs) / 1000))
  return session.elapsedSeconds + additional
}

/**
 * Computes remaining seconds for a Pomodoro target.
 * For count-up mode, remaining is always 0.
 */
export function computeTimerRemaining(session: ActiveFocusSession, nowMs: number = Date.now()): number {
  if (session.mode === 'count-up') return 0
  const elapsed = computeTimerElapsed(session, nowMs)
  return Math.max(0, session.targetSeconds - elapsed)
}

/**
 * Checks if a Pomodoro target has finished based on wall-clock now.
 */
export function isTimerFinished(session: ActiveFocusSession, nowMs: number = Date.now()): boolean {
  if (session.mode === 'count-up' || session.targetSeconds <= 0) return false
  return computeTimerElapsed(session, nowMs) >= session.targetSeconds
}

/**
 * Determines the next Pomodoro phase based on standard rules:
 * - focus -> (round % longBreakInterval === 0 ? long-break : short-break)
 * - short-break / long-break -> focus (round + 1)
 */
export function nextPomodoroPhase(
  currentType: FocusType,
  round: number,
  longBreakInterval: number = 4
): { type: FocusType; nextRound: number } {
  const interval = Math.max(1, longBreakInterval)
  if (currentType === 'focus') {
    const isLong = round > 0 && round % interval === 0
    return {
      type: isLong ? 'long-break' : 'short-break',
      nextRound: round
    }
  }
  return {
    type: 'focus',
    nextRound: round + 1
  }
}

// ---------- Midnight splitting ----------

export interface DaySlice {
  date: string // YYYY-MM-DD
  seconds: number
}

/**
 * Splits a time range [startedAt, endedAt] across local calendar midnights.
 * Ensures that if a session runs from 23:45 to 00:30, it assigns 15 min to day 1 and 30 min to day 2.
 * Total seconds across all slices strictly equals total duration.
 */
export function splitSessionByDay(startedAtIso: string, endedAtIso: string): DaySlice[] {
  const startMs = new Date(startedAtIso).getTime()
  const endMs = new Date(endedAtIso).getTime()

  if (Number.isNaN(startMs) || Number.isNaN(endMs) || endMs <= startMs) {
    return []
  }

  const slices: DaySlice[] = []
  let currentStartMs = startMs

  while (currentStartMs < endMs) {
    const startDate = new Date(currentStartMs)
    const year = startDate.getFullYear()
    const month = startDate.getMonth()
    const day = startDate.getDate()

    // Next midnight local time
    const nextMidnight = new Date(year, month, day + 1, 0, 0, 0, 0).getTime()
    const sliceEndMs = Math.min(endMs, nextMidnight)
    const seconds = Math.max(0, Math.round((sliceEndMs - currentStartMs) / 1000))

    const pad = (n: number) => String(n).padStart(2, '0')
    const dateStr = `${year}-${pad(month + 1)}-${pad(day)}`

    if (seconds > 0) {
      slices.push({ date: dateStr, seconds })
    }

    currentStartMs = sliceEndMs
  }

  return slices
}

// ---------- Formatting & Heatmap ----------

export function formatDuration(totalSeconds: number): string {
  const s = Math.max(0, Math.round(totalSeconds))
  const hours = Math.floor(s / 3600)
  const minutes = Math.floor((s % 3600) / 60)
  const seconds = s % 60

  if (hours > 0) {
    return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`
  }
  if (minutes > 0) {
    return seconds > 0 ? `${minutes}m ${seconds}s` : `${minutes}m`
  }
  return `${seconds}s`
}

export function formatTimerDigits(totalSeconds: number): string {
  const s = Math.max(0, Math.round(totalSeconds))
  const hours = Math.floor(s / 3600)
  const minutes = Math.floor((s % 3600) / 60)
  const seconds = s % 60
  const pad = (n: number) => String(n).padStart(2, '0')

  if (hours > 0) {
    return `${hours}:${pad(minutes)}:${pad(seconds)}`
  }
  return `${pad(minutes)}:${pad(seconds)}`
}

export function calculateHeatmapLevel(seconds: number, maxSeconds: number): 0 | 1 | 2 | 3 | 4 {
  if (seconds <= 0 || maxSeconds <= 0) return 0
  const ratio = seconds / maxSeconds
  if (ratio < 0.25) return 1
  if (ratio < 0.5) return 2
  if (ratio < 0.75) return 3
  return 4
}

// ---------- Reports data structures ----------

export interface FocusProjectBreakdown {
  projectId: number | null
  name: string
  colour: string
  seconds: number
  percentage: number
}

export interface FocusTaskBreakdown {
  taskId: number
  title: string
  seconds: number
}

export interface FocusHeatmapEntry {
  date: string // YYYY-MM-DD
  seconds: number
  level: 0 | 1 | 2 | 3 | 4
}

export interface FocusReport {
  from: string // YYYY-MM-DD
  to: string // YYYY-MM-DD
  totalFocusSeconds: number
  totalBreakSeconds: number
  sessionsCount: number
  completedRounds: number
  byProject: FocusProjectBreakdown[]
  byTask: FocusTaskBreakdown[]
  dailyTotals: Record<string, number> // YYYY-MM-DD -> focus seconds
  heatmap: FocusHeatmapEntry[]
}

export interface FocusDashboardSummary {
  todayFocusSeconds: number
  activeSession: ActiveFocusSession | null
  completedRoundsToday: number
}
