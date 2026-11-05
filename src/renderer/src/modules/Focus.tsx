// Focus timer and time tracking page (Phase 4).
//
// Tabs:
// - Timer: Pomodoro & Count-up interactive clock, tied to task/project, sound chime, notifications.
// - Reports: Today, week, month reports, by-project and by-task breakdowns, and focus heatmap.
// - Sessions: Detailed session history with manual entry, edit and delete.
// - Projects: Project manager for categorizing time.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Check, Clock, Flame, Folder,
  Pencil, Play, Pause, Plus, Settings as SettingsIcon,
  Timer, Trash2
} from 'lucide-react'
import type { ModuleProps } from '../lib/navigation'
import type {
  ActiveFocusSession, FocusDashboardSummary, FocusReport, FocusSettings,
  FocusTimerMode, FocusType, Project, TimeSession
} from '../../../shared/focus'
import {
  calculateHeatmapLevel, computeTimerElapsed, computeTimerRemaining,
  DEFAULT_FOCUS_SETTINGS, formatDuration, formatTimerDigits, isTimerFinished,
  nextPomodoroPhase
} from '../../../shared/focus'
import type { Task } from '../../../shared/types'
import { PageHeader } from '../components/PageHeader'
import { EmptyState } from '../components/EmptyState'
import { Dialog, Field, FormMessage } from '../components/EditorBits'
import { ProgressBar } from '../components/ProgressBar'
import { errMsg } from '../lib/errors'
import { today, formatDate, localTime } from '../lib/dates'
import { useSettings, updateSettings } from '../lib/settingsStore'
import { useRefreshOnCapture } from '../lib/dataChanged'
import { noteUndoableDelete } from '../lib/undo'

type Tab = 'timer' | 'reports' | 'sessions' | 'projects'

const PROJECT_PALETTE = [
  '#8b5cf6', '#3b82f6', '#10b981', '#f59e0b',
  '#ef4444', '#ec4899', '#06b6d4', '#64748b'
]

// Pure data-URI swatch for project colour circles without inline colour literals
const swatch = (hex: string): string =>
  `url("data:image/svg+xml,${encodeURIComponent(`<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 1 1'><rect width='1' height='1' fill='${hex.replace(/'/g, '')}'/></svg>`)}")`

// Offline chime using HTML5 Web Audio API
function playChime(): void {
  try {
    const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
    if (!AudioCtx) return
    const ctx = new AudioCtx()
    const now = ctx.currentTime
    const notes = [523.25, 659.25, 783.99] // C5, E5, G5
    notes.forEach((freq, i) => {
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.type = 'sine'
      osc.frequency.setValueAtTime(freq, now + i * 0.12)
      gain.gain.setValueAtTime(0, now + i * 0.12)
      gain.gain.linearRampToValueAtTime(0.18, now + i * 0.12 + 0.02)
      gain.gain.exponentialRampToValueAtTime(0.001, now + i * 0.12 + 0.45)
      osc.connect(gain)
      gain.connect(ctx.destination)
      osc.start(now + i * 0.12)
      osc.stop(now + i * 0.12 + 0.5)
    })
  } catch {
    // Progressive enhancement
  }
}

export function Focus({ onNavigate }: ModuleProps) {
  const settings = useSettings()
  const focusSettings = settings.focus ?? DEFAULT_FOCUS_SETTINGS

  const [tab, setTab] = useState<Tab>('timer')
  const [active, setActive] = useState<ActiveFocusSession | null>(null)
  const [nowMs, setNowMs] = useState<number>(Date.now())
  const [projects, setProjects] = useState<Project[]>([])
  const [tasks, setTasks] = useState<Task[]>([])
  const [summary, setSummary] = useState<FocusDashboardSummary | null>(null)
  const [error, setError] = useState('')
  const [loaded, setLoaded] = useState(false)

  // Modals
  const [showSettings, setShowSettings] = useState(false)
  const [manualModal, setManualModal] = useState<TimeSession | 'new' | null>(null)
  const [projectModal, setProjectModal] = useState<Project | 'new' | null>(null)

  // Local state for setting up next timer when idle
  const [idleMode, setIdleMode] = useState<FocusTimerMode>('pomodoro')
  const [idleType, setIdleType] = useState<FocusType>('focus')
  const [selectedTaskId, setSelectedTaskId] = useState<number | null>(null)
  const [selectedProjectId, setSelectedProjectId] = useState<number | null>(null)
  const [sessionNote, setSessionNote] = useState('')

  const refresh = useCallback(async () => {
    try {
      const [act, projs, tsks, summ] = await Promise.all([
        window.api.focus.active(),
        window.api.projects.list(true),
        window.api.tasks.list({ view: 'all' }),
        window.api.focus.summary(today())
      ])
      setActive(act)
      setProjects(projs)
      setTasks(tsks)
      setSummary(summ)
      setError('')
    } catch (e) {
      setError(errMsg(e))
    }
    setLoaded(true)
  }, [])

  useEffect(() => { void refresh() }, [refresh])
  useRefreshOnCapture(refresh)

  // Clock tick every 500ms to compute remaining/elapsed accurately without drift
  useEffect(() => {
    const timer = setInterval(() => {
      setNowMs(Date.now())
    }, 500)
    return () => clearInterval(timer)
  }, [])

  // Auto-finish detection for Pomodoro mode
  const finishedHandled = useRef(false)
  useEffect(() => {
    if (!active || active.status !== 'running' || active.mode === 'count-up') {
      finishedHandled.current = false
      return
    }

    if (isTimerFinished(active, nowMs) && !finishedHandled.current) {
      finishedHandled.current = true
      if (focusSettings.soundEnabled) playChime()

      // Stop and log the completed round
      window.api.focus.stop(true, active.note).then(() => {
        // Prepare next phase
        const next = nextPomodoroPhase(active.type, active.round, focusSettings.longBreakInterval)
        let targetMins = focusSettings.focusDuration
        if (next.type === 'short-break') targetMins = focusSettings.shortBreakDuration
        if (next.type === 'long-break') targetMins = focusSettings.longBreakDuration

        const autoStart = next.type === 'focus' ? focusSettings.autoStartFocus : focusSettings.autoStartBreaks

        if (autoStart) {
          window.api.focus.start({
            type: next.type,
            mode: 'pomodoro',
            targetSeconds: targetMins * 60,
            taskId: active.taskId,
            projectId: active.projectId,
            projectName: active.projectName,
            round: next.nextRound,
            note: active.note
          }).then(() => void refresh())
        } else {
          setIdleType(next.type)
          setIdleMode('pomodoro')
          void refresh()
        }
      }).catch((e) => setError(errMsg(e)))
    }
  }, [active, nowMs, focusSettings, refresh])

  // Timer controls
  const handleStart = async (type: FocusType = idleType, mode: FocusTimerMode = idleMode) => {
    let target = 0
    if (mode === 'pomodoro') {
      let mins = focusSettings.focusDuration
      if (type === 'short-break') mins = focusSettings.shortBreakDuration
      if (type === 'long-break') mins = focusSettings.longBreakDuration
      target = mins * 60
    }

    try {
      const started = await window.api.focus.start({
        type,
        mode,
        targetSeconds: target,
        taskId: selectedTaskId,
        projectId: selectedProjectId,
        round: active ? active.round : 1,
        note: sessionNote
      })
      setActive(started)
      setError('')
      void refresh()
    } catch (e) {
      setError(errMsg(e))
    }
  }

  const handlePause = async () => {
    try {
      const paused = await window.api.focus.pause()
      setActive(paused)
    } catch (e) {
      setError(errMsg(e))
    }
  }

  const handleResume = async () => {
    try {
      const resumed = await window.api.focus.resume()
      setActive(resumed)
    } catch (e) {
      setError(errMsg(e))
    }
  }

  const handleStop = async (completed = true) => {
    try {
      await window.api.focus.stop(completed, active?.note)
      setActive(null)
      void refresh()
      void window.api.capture.saved()
    } catch (e) {
      setError(errMsg(e))
    }
  }

  const handleDiscard = async () => {
    try {
      await window.api.focus.discard()
      setActive(null)
      void refresh()
    } catch (e) {
      setError(errMsg(e))
    }
  }

  // Keyboard shortcut: Space toggles running/pause when on timer tab
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLSelectElement) {
        return
      }
      if (tab === 'timer' && e.code === 'Space') {
        e.preventDefault()
        if (!active) void handleStart()
        else if (active.status === 'running') void handlePause()
        else if (active.status === 'paused') void handleResume()
      }
      if (e.ctrlKey && e.key.toLowerCase() === 'n') {
        e.preventDefault()
        setManualModal('new')
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  // Computed values
  const elapsed = active ? computeTimerElapsed(active, nowMs) : 0
  const remaining = active ? computeTimerRemaining(active, nowMs) : 0
  const displayDigits = active
    ? (active.mode === 'pomodoro' ? formatTimerDigits(remaining) : formatTimerDigits(elapsed))
    : (idleMode === 'pomodoro'
      ? formatTimerDigits((idleType === 'focus' ? focusSettings.focusDuration : idleType === 'short-break' ? focusSettings.shortBreakDuration : focusSettings.longBreakDuration) * 60)
      : '00:00')

  const progressPct = active && active.targetSeconds > 0
    ? Math.min(100, Math.round((elapsed / active.targetSeconds) * 100))
    : 0

  return (
    <div className="page">
      <PageHeader
        title="Focus"
        subtitle={summary
          ? `${formatDuration(summary.todayFocusSeconds)} focused today · ${summary.completedRoundsToday} ${summary.completedRoundsToday === 1 ? 'round' : 'rounds'} completed`
          : 'Pomodoro timer, time tracking and reports by task and project.'}
      >
        <div className="flex items-center gap-2">
          <button className="btn btn-sm" onClick={() => setManualModal('new')} title="Ctrl+N">
            <Plus size={14} /> Log time
          </button>
          <button className="btn-icon" onClick={() => setShowSettings(true)} aria-label="Timer settings" title="Timer settings">
            <SettingsIcon size={16} />
          </button>
        </div>
      </PageHeader>

      <div className="seg mb-5" role="tablist" aria-label="Focus views">
        <button role="tab" aria-selected={tab === 'timer'} onClick={() => setTab('timer')}>
          <Timer size={14} className="mr-1.5 inline" /> Timer
        </button>
        <button role="tab" aria-selected={tab === 'reports'} onClick={() => setTab('reports')}>
          <Flame size={14} className="mr-1.5 inline" /> Reports
        </button>
        <button role="tab" aria-selected={tab === 'sessions'} onClick={() => setTab('sessions')}>
          <Clock size={14} className="mr-1.5 inline" /> Sessions
        </button>
        <button role="tab" aria-selected={tab === 'projects'} onClick={() => setTab('projects')}>
          <Folder size={14} className="mr-1.5 inline" /> Projects
        </button>
      </div>

      {error && <p role="alert" className="mb-4 text-sm text-neg">{error}</p>}

      {/* -------------------- 1. TIMER VIEW -------------------- */}
      {tab === 'timer' && (
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
          {/* Main interactive timer card */}
          <section className="card card-pad-lg flex flex-col items-center justify-center py-10 text-center">
            {/* Phase Mode Pills */}
            {!active ? (
              <div className="seg mb-6" role="group" aria-label="Timer mode">
                <button aria-pressed={idleMode === 'pomodoro' && idleType === 'focus'} onClick={() => { setIdleMode('pomodoro'); setIdleType('focus') }}>
                  Focus ({focusSettings.focusDuration}m)
                </button>
                <button aria-pressed={idleMode === 'pomodoro' && idleType === 'short-break'} onClick={() => { setIdleMode('pomodoro'); setIdleType('short-break') }}>
                  Short break ({focusSettings.shortBreakDuration}m)
                </button>
                <button aria-pressed={idleMode === 'pomodoro' && idleType === 'long-break'} onClick={() => { setIdleMode('pomodoro'); setIdleType('long-break') }}>
                  Long break ({focusSettings.longBreakDuration}m)
                </button>
                <button aria-pressed={idleMode === 'count-up'} onClick={() => { setIdleMode('count-up'); setIdleType('count-up') }}>
                  Count-up
                </button>
              </div>
            ) : (
              <div className="mb-4 flex items-center gap-2">
                <span className="badge badge-accent uppercase tracking-wider text-xs">
                  {active.type === 'focus' ? 'Focus session' : active.type === 'short-break' ? 'Short break' : active.type === 'long-break' ? 'Long break' : 'Count-up'}
                </span>
                {active.mode === 'pomodoro' && (
                  <span className="meta">Round {active.round} of {focusSettings.longBreakInterval}</span>
                )}
                {active.status === 'paused' && (
                  <span className="badge badge-neg">Paused</span>
                )}
              </div>
            )}

            {/* Circular Timer Clock */}
            <div className="relative my-4 flex h-64 w-64 items-center justify-center">
              <svg className="h-full w-full -rotate-90 transform" viewBox="0 0 100 100">
                {/* Track circle */}
                <circle
                  cx="50" cy="50" r="44"
                  className="stroke-line"
                  strokeWidth="4"
                  fill="none"
                />
                {/* Progress arc */}
                {active && active.mode === 'pomodoro' && (
                  <circle
                    cx="50" cy="50" r="44"
                    className="stroke-accent transition-all duration-300"
                    strokeWidth="5"
                    strokeLinecap="round"
                    fill="none"
                    strokeDasharray={276.46}
                    strokeDashoffset={276.46 - (276.46 * progressPct) / 100}
                  />
                )}
              </svg>

              {/* Digits inside circle */}
              <div className="absolute flex flex-col items-center">
                <span className="font-mono text-5xl font-bold tracking-tight text-fg tabular-nums">
                  {displayDigits}
                </span>
                <span className="meta mt-1 text-xs">
                  {active ? (active.status === 'running' ? 'Press Space to pause' : 'Press Space to resume') : 'Press Space or click Start'}
                </span>
              </div>
            </div>

            {/* Timer action controls */}
            <div className="mt-4 flex flex-wrap items-center justify-center gap-3">
              {!active ? (
                <button className="btn-primary px-6 py-2.5 text-base font-semibold" onClick={() => void handleStart()}>
                  <Play size={18} className="mr-2 inline" /> Start {idleType === 'focus' ? 'Focus' : idleType === 'count-up' ? 'Count-up' : 'Break'}
                </button>
              ) : active.status === 'running' ? (
                <>
                  <button className="btn px-4 py-2" onClick={() => void handlePause()}>
                    <Pause size={16} className="mr-1.5 inline" /> Pause
                  </button>
                  <button className="btn-primary px-4 py-2" onClick={() => void handleStop(true)}>
                    <Check size={16} className="mr-1.5 inline" /> Complete
                  </button>
                  <button className="btn-danger btn-sm" onClick={() => void handleDiscard()} title="Discard without logging">
                    <Trash2 size={14} />
                  </button>
                </>
              ) : (
                <>
                  <button className="btn-primary px-5 py-2" onClick={() => void handleResume()}>
                    <Play size={16} className="mr-1.5 inline" /> Resume
                  </button>
                  <button className="btn px-4 py-2" onClick={() => void handleStop(true)}>
                    <Check size={16} className="mr-1.5 inline" /> Done
                  </button>
                  <button className="btn btn-sm" onClick={() => void handleDiscard()}>
                    Discard
                  </button>
                </>
              )}
            </div>
          </section>

          {/* Right sidebar: Context & Tie to Task/Project */}
          <aside className="space-y-4">
            <div className="card card-pad">
              <h3 className="section-title">Context & Task</h3>
              <p className="meta mt-1">Tie this session to a task or project so reports reflect where your hours go.</p>

              <div className="mt-4 space-y-3">
                <Field label="Task (optional)">
                  <select
                    className="field"
                    value={active ? (active.taskId ?? '') : (selectedTaskId ?? '')}
                    disabled={active !== null}
                    onChange={(e) => {
                      const id = e.target.value ? Number(e.target.value) : null
                      setSelectedTaskId(id)
                      if (id) {
                        const t = tasks.find((item) => item.id === id)
                        if (t?.project) {
                          const p = projects.find((item) => item.name === t.project)
                          if (p) setSelectedProjectId(p.id)
                        }
                      }
                    }}
                  >
                    <option value="">No task</option>
                    {tasks.filter((t) => t.status !== 'done').map((t) => (
                      <option key={t.id} value={t.id}>{t.title}</option>
                    ))}
                  </select>
                </Field>

                <Field label="Project (optional)">
                  <select
                    className="field"
                    value={active ? (active.projectId ?? '') : (selectedProjectId ?? '')}
                    disabled={active !== null}
                    onChange={(e) => setSelectedProjectId(e.target.value ? Number(e.target.value) : null)}
                  >
                    <option value="">No project</option>
                    {projects.map((p) => (
                      <option key={p.id} value={p.id}>{p.name}</option>
                    ))}
                  </select>
                </Field>

                <Field label="Session note">
                  <input
                    className="field"
                    placeholder="What are you working on?"
                    value={active ? active.note : sessionNote}
                    onChange={(e) => {
                      const val = e.target.value
                      setSessionNote(val)
                      if (active) active.note = val
                    }}
                  />
                </Field>
              </div>
            </div>

            {/* Today's quick snapshot */}
            <div className="card card-pad">
              <h3 className="section-title">Today's Focus</h3>
              <div className="mt-3 flex items-baseline justify-between">
                <span className="stat-value">{formatDuration(summary?.todayFocusSeconds ?? 0)}</span>
                <span className="meta">{summary?.completedRoundsToday ?? 0} rounds done</span>
              </div>
              <div className="mt-3">
                <ProgressBar percent={Math.min(100, Math.round(((summary?.todayFocusSeconds ?? 0) / 14400) * 100))} />
                <span className="meta mt-1 block">Goal: 4 hours (14,400s)</span>
              </div>
            </div>
          </aside>
        </div>
      )}

      {/* -------------------- 2. REPORTS VIEW -------------------- */}
      {tab === 'reports' && (
        <FocusReportsView projects={projects} />
      )}

      {/* -------------------- 3. SESSIONS LOG -------------------- */}
      {tab === 'sessions' && (
        <FocusSessionsLog
          projects={projects}
          tasks={tasks}
          onRefresh={refresh}
          onEdit={(s) => setManualModal(s)}
        />
      )}

      {/* -------------------- 4. PROJECTS MANAGER -------------------- */}
      {tab === 'projects' && (
        <FocusProjectsManager
          projects={projects}
          onRefresh={refresh}
          onOpenModal={(p) => setProjectModal(p)}
        />
      )}

      {/* Manual session log modal */}
      {manualModal && (
        <ManualSessionModal
          session={manualModal === 'new' ? null : manualModal}
          projects={projects}
          tasks={tasks}
          onClose={() => setManualModal(null)}
          onSaved={() => { setManualModal(null); void refresh() }}
        />
      )}

      {/* Project editor modal */}
      {projectModal && (
        <ProjectEditorModal
          project={projectModal === 'new' ? null : projectModal}
          onClose={() => setProjectModal(null)}
          onSaved={() => { setProjectModal(null); void refresh() }}
        />
      )}

      {/* Pomodoro Settings modal */}
      {showSettings && (
        <FocusSettingsModal
          settings={focusSettings}
          onClose={() => setShowSettings(false)}
          onSaved={(patch) => {
            updateSettings({ focus: { ...focusSettings, ...patch } })
            setShowSettings(false)
          }}
        />
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Reports view with Heatmap & Breakdowns
// ---------------------------------------------------------------------------

function FocusReportsView({ projects }: { projects: Project[] }) {
  const [rangeKind, setRangeKind] = useState<'today' | 'week' | 'month'>('week')
  const [report, setReport] = useState<FocusReport | null>(null)
  const [loading, setLoading] = useState(false)

  const dateSpan = useMemo(() => {
    const d = new Date()
    const todayStr = today()
    if (rangeKind === 'today') {
      return { from: todayStr, to: todayStr }
    }
    if (rangeKind === 'week') {
      // Last 7 days
      const past = new Date(d.getTime() - 6 * 86_400_000)
      const pad = (n: number) => String(n).padStart(2, '0')
      const fromStr = `${past.getFullYear()}-${pad(past.getMonth() + 1)}-${pad(past.getDate())}`
      return { from: fromStr, to: todayStr }
    }
    // Last 30 days
    const past = new Date(d.getTime() - 29 * 86_400_000)
    const pad = (n: number) => String(n).padStart(2, '0')
    const fromStr = `${past.getFullYear()}-${pad(past.getMonth() + 1)}-${pad(past.getDate())}`
    return { from: fromStr, to: todayStr }
  }, [rangeKind])

  useEffect(() => {
    setLoading(true)
    window.api.focus.report(dateSpan.from, dateSpan.to)
      .then(setReport)
      .finally(() => setLoading(false))
  }, [dateSpan])

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="seg" role="group" aria-label="Report period">
          <button aria-pressed={rangeKind === 'today'} onClick={() => setRangeKind('today')}>Today</button>
          <button aria-pressed={rangeKind === 'week'} onClick={() => setRangeKind('week')}>7 Days</button>
          <button aria-pressed={rangeKind === 'month'} onClick={() => setRangeKind('month')}>30 Days</button>
        </div>
        <span className="meta">{formatDate(dateSpan.from)} — {formatDate(dateSpan.to)}</span>
      </div>

      {report && (
        <>
          {/* Stat summary tiles */}
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div className="card card-pad">
              <div className="stat-label">Total focus time</div>
              <div className="stat-value text-fg">{formatDuration(report.totalFocusSeconds)}</div>
              <div className="stat-sub">{report.completedRounds} completed {report.completedRounds === 1 ? 'round' : 'rounds'}</div>
            </div>
            <div className="card card-pad">
              <div className="stat-label">Break time</div>
              <div className="stat-value text-fg">{formatDuration(report.totalBreakSeconds)}</div>
              <div className="stat-sub">Short and long breaks</div>
            </div>
            <div className="card card-pad">
              <div className="stat-label">Total sessions</div>
              <div className="stat-value">{report.sessionsCount}</div>
              <div className="stat-sub">{report.sessionsCount === 1 ? '1 session' : `${report.sessionsCount} sessions`} logged</div>
            </div>
            <div className="card card-pad">
              <div className="stat-label">Active projects</div>
              <div className="stat-value">{report.byProject.length}</div>
              <div className="stat-sub">{report.byProject.length === 1 ? '1 project' : `${report.byProject.length} projects`} with focus time</div>
            </div>
          </div>

          {/* Activity Heatmap */}
          <section className="card card-pad-lg">
            <h3 className="section-title">Focus Heatmap</h3>
            <p className="meta mt-1">Daily intensity across the period.</p>
            <div className="mt-4 flex flex-wrap gap-1.5">
              {report.heatmap.map((h) => (
                <div
                  key={h.date}
                  title={`${formatDate(h.date)}: ${formatDuration(h.seconds)}`}
                  className={`h-6 w-6 rounded-md transition-transform hover:scale-110 ${h.level === 0 ? 'bg-line/40' :
                      h.level === 1 ? 'bg-accent/30' :
                        h.level === 2 ? 'bg-accent/55' :
                          h.level === 3 ? 'bg-accent/80' : 'bg-accent'
                    }`}
                />
              ))}
            </div>
          </section>

          {/* Breakdown grid */}
          <div className="grid gap-6 lg:grid-cols-2">
            {/* By Project */}
            <section className="card card-pad-lg">
              <h3 className="section-title">By Project</h3>
              {report.byProject.length === 0 ? (
                <p className="meta mt-3">No focus time logged on projects in this period.</p>
              ) : (
                <ul className="mt-4 space-y-3">
                  {report.byProject.map((p) => (
                    <li key={p.projectId ?? 'none'} className="space-y-1">
                      <div className="flex items-center justify-between text-sm">
                        <span className="flex items-center gap-2 font-medium">
                          <span
                            className="h-2.5 w-2.5 rounded-full"
                            style={{ backgroundImage: swatch(p.colour) }}
                            aria-hidden="true"
                          />
                          {p.name}
                        </span>
                        <span className="num text-muted">{formatDuration(p.seconds)} ({p.percentage}%)</span>
                      </div>
                      <ProgressBar percent={p.percentage} />
                    </li>
                  ))}
                </ul>
              )}
            </section>

            {/* By Task */}
            <section className="card card-pad-lg">
              <h3 className="section-title">By Task</h3>
              {report.byTask.length === 0 ? (
                <p className="meta mt-3">No focus time tied to tasks in this period.</p>
              ) : (
                <ul className="mt-4 divide-y divide-line/60">
                  {report.byTask.map((t) => (
                    <li key={t.taskId} className="flex items-center justify-between py-2 text-sm">
                      <span className="truncate font-medium">{t.title}</span>
                      <span className="num shrink-0 text-muted">{formatDuration(t.seconds)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>
        </>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Sessions log table
// ---------------------------------------------------------------------------

function FocusSessionsLog({
  projects, tasks, onRefresh, onEdit
}: {
  projects: Project[]
  tasks: Task[]
  onRefresh: () => void
  onEdit: (s: TimeSession) => void
}) {
  const [sessions, setSessions] = useState<TimeSession[]>([])
  const [loading, setLoading] = useState(false)

  const reload = useCallback(() => {
    setLoading(true)
    window.api.focus.listSessions()
      .then(setSessions)
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => { reload() }, [reload])

  const handleDelete = async (id: number) => {
    try {
      const batchId = await window.api.focus.deleteSession(id)
      noteUndoableDelete({ label: 'Focus session', batchId })
      reload()
      onRefresh()
    } catch (e) {
      alert(errMsg(e))
    }
  }

  return (
    <div className="space-y-4">
      {sessions.length === 0 && !loading ? (
        <EmptyState
          icon={Clock}
          title="No recorded sessions"
          text="Run the timer or click 'Log time' to add manual sessions."
        />
      ) : (
        <div className="card overflow-hidden">
          <table className="tbl">
            <thead>
              <tr>
                <th>Date & Time</th>
                <th>Type</th>
                <th>Duration</th>
                <th>Project / Task</th>
                <th>Note</th>
                <th className="w-16" />
              </tr>
            </thead>
            <tbody>
              {sessions.map((s) => (
                <tr key={s.id}>
                  <td>
                    <div className="font-medium">{formatDate(s.startedAt.slice(0, 10))}</div>
                    <div className="secondary">{s.startedAt.slice(11, 16)} — {s.endedAt.slice(11, 16)}</div>
                  </td>
                  <td>
                    <span className="badge capitalize">{s.type}</span>
                  </td>
                  <td className="num font-semibold">{formatDuration(s.actualSeconds)}</td>
                  <td>
                    {s.projectName && <div className="font-medium">{s.projectName}</div>}
                    {s.taskId && <div className="secondary">Task #{s.taskId}</div>}
                    {!s.projectName && !s.taskId && <span className="meta">—</span>}
                  </td>
                  <td>
                    <span className="secondary truncate max-w-[12rem] block">{s.note || '—'}</span>
                  </td>
                  <td className="text-right">
                    <span className="flex items-center justify-end gap-1">
                      <button className="btn-icon" onClick={() => onEdit(s)} aria-label="Edit session">
                        <Pencil size={14} />
                      </button>
                      <button className="btn-icon hover:text-neg" onClick={() => void handleDelete(s.id)} aria-label="Delete session">
                        <Trash2 size={14} />
                      </button>
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Projects manager view
// ---------------------------------------------------------------------------

function FocusProjectsManager({
  projects, onRefresh, onOpenModal
}: {
  projects: Project[]
  onRefresh: () => void
  onOpenModal: (p: Project | 'new') => void
}) {
  const handleDelete = async (p: Project) => {
    if (!confirm(`Delete project "${p.name}"?`)) return
    try {
      const batchId = await window.api.projects.delete(p.id)
      noteUndoableDelete({ label: `Project ${p.name}`, batchId })
      onRefresh()
    } catch (e) {
      alert(errMsg(e))
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="meta">{projects.length} {projects.length === 1 ? 'project' : 'projects'} available.</p>
        <button className="btn-primary" onClick={() => onOpenModal('new')}>
          <Plus size={16} /> New project
        </button>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {projects.map((p) => (
          <div key={p.id} className="card card-pad flex items-center justify-between gap-3">
            <div className="flex items-center gap-2.5">
              <span
                className="h-3.5 w-3.5 rounded-full"
                style={{ backgroundImage: swatch(p.colour) }}
                aria-hidden="true"
              />
              <span className="font-semibold">{p.name}</span>
              {p.archived && <span className="badge">Archived</span>}
            </div>
            <div className="flex items-center gap-1">
              <button className="btn-icon" onClick={() => onOpenModal(p)} aria-label="Edit project">
                <Pencil size={14} />
              </button>
              <button className="btn-icon hover:text-neg" onClick={() => void handleDelete(p)} aria-label="Delete project">
                <Trash2 size={14} />
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Modals
// ---------------------------------------------------------------------------

function ManualSessionModal({
  session, projects, tasks, onClose, onSaved
}: {
  session: TimeSession | null
  projects: Project[]
  tasks: Task[]
  onClose: () => void
  onSaved: () => void
}) {
  const [date, setDate] = useState(session ? session.startedAt.slice(0, 10) : today())
  const [startTime, setStartTime] = useState(session ? session.startedAt.slice(11, 16) : '09:00')
  const [endTime, setEndTime] = useState(session ? session.endedAt.slice(11, 16) : '09:25')
  const [projectId, setProjectId] = useState<string>(session?.projectId ? String(session.projectId) : '')
  const [taskId, setTaskId] = useState<string>(session?.taskId ? String(session.taskId) : '')
  const [type, setType] = useState<FocusType>(session?.type ?? 'focus')
  const [note, setNote] = useState(session?.note ?? '')
  const [error, setError] = useState('')

  const handleSave = async () => {
    setError('')
    const startIso = `${date}T${startTime}:00.000Z`
    const endIso = `${date}T${endTime}:00.000Z`

    if (new Date(endIso).getTime() <= new Date(startIso).getTime()) {
      setError('End time must be after start time')
      return
    }

    try {
      if (session) {
        await window.api.focus.updateSession(session.id, {
          startedAt: startIso,
          endedAt: endIso,
          type,
          note,
          projectId: projectId ? Number(projectId) : null,
          taskId: taskId ? Number(taskId) : null
        })
      } else {
        await window.api.focus.logManual({
          startedAt: startIso,
          endedAt: endIso,
          type,
          note,
          projectId: projectId ? Number(projectId) : null,
          taskId: taskId ? Number(taskId) : null
        })
      }
      onSaved()
    } catch (e) {
      setError(errMsg(e))
    }
  }

  return (
    <Dialog title={session ? 'Edit session' : 'Log focus time'} onClose={onClose} onSave={() => void handleSave()}>
      <div className="space-y-4">
        <div className="grid grid-cols-3 gap-3">
          <Field label="Date">
            <input type="date" className="field" value={date} onChange={(e) => setDate(e.target.value)} />
          </Field>
          <Field label="Start time">
            <input type="time" className="field" value={startTime} onChange={(e) => setStartTime(e.target.value)} />
          </Field>
          <Field label="End time">
            <input type="time" className="field" value={endTime} onChange={(e) => setEndTime(e.target.value)} />
          </Field>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Project">
            <select className="field" value={projectId} onChange={(e) => setProjectId(e.target.value)}>
              <option value="">No project</option>
              {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </Field>
          <Field label="Task">
            <select className="field" value={taskId} onChange={(e) => setTaskId(e.target.value)}>
              <option value="">No task</option>
              {tasks.map((t) => <option key={t.id} value={t.id}>{t.title}</option>)}
            </select>
          </Field>
        </div>

        <Field label="Type">
          <select className="field" value={type} onChange={(e) => setType(e.target.value as FocusType)}>
            <option value="focus">Focus</option>
            <option value="short-break">Short break</option>
            <option value="long-break">Long break</option>
            <option value="count-up">Count-up</option>
          </select>
        </Field>

        <Field label="Note">
          <input className="field" placeholder="Notes on this work" value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>

        {error && <FormMessage error={error} />}

        <div className="mt-5 flex justify-end gap-2">
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn-primary" onClick={() => void handleSave()}>Save</button>
        </div>
      </div>
    </Dialog>
  )
}

function ProjectEditorModal({
  project, onClose, onSaved
}: {
  project: Project | null
  onClose: () => void
  onSaved: () => void
}) {
  const [name, setName] = useState(project?.name ?? '')
  const [colour, setColour] = useState(project?.colour ?? '#8b5cf6')
  const [error, setError] = useState('')

  const handleSave = async () => {
    setError('')
    if (!name.trim()) { setError('Enter a project name'); return }
    try {
      if (project) {
        await window.api.projects.update(project.id, { name: name.trim(), colour })
      } else {
        await window.api.projects.create({ name: name.trim(), colour })
      }
      onSaved()
    } catch (e) {
      setError(errMsg(e))
    }
  }

  return (
    <Dialog title={project ? 'Edit project' : 'New project'} onClose={onClose} onSave={() => void handleSave()}>
      <div className="space-y-4">
        <Field label="Project name">
          <input className="field" autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Website redesign" />
        </Field>

        <div>
          <label className="text-xs text-muted block mb-2">Project colour</label>
          <div className="flex flex-wrap gap-2">
            {PROJECT_PALETTE.map((hex) => (
              <button
                key={hex}
                type="button"
                onClick={() => setColour(hex)}
                className={`h-7 w-7 rounded-full transition-transform ${colour === hex ? 'ring-2 ring-fg ring-offset-2 ring-offset-card scale-110' : ''}`}
                style={{ backgroundImage: swatch(hex) }}
                aria-label={hex}
              />
            ))}
          </div>
        </div>

        {error && <FormMessage error={error} />}

        <div className="mt-5 flex justify-end gap-2">
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn-primary" onClick={() => void handleSave()}>Save project</button>
        </div>
      </div>
    </Dialog>
  )
}

function FocusSettingsModal({
  settings, onClose, onSaved
}: {
  settings: FocusSettings
  onClose: () => void
  onSaved: (patch: Partial<FocusSettings>) => void
}) {
  const [focusDuration, setFocusDuration] = useState(settings.focusDuration)
  const [shortBreakDuration, setShortBreakDuration] = useState(settings.shortBreakDuration)
  const [longBreakDuration, setLongBreakDuration] = useState(settings.longBreakDuration)
  const [longBreakInterval, setLongBreakInterval] = useState(settings.longBreakInterval)
  const [soundEnabled, setSoundEnabled] = useState(settings.soundEnabled)

  return (
    <Dialog title="Timer settings" onClose={onClose} onSave={() => onSaved({ focusDuration, shortBreakDuration, longBreakDuration, longBreakInterval, soundEnabled })}>
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Focus duration (minutes)">
            <input type="number" min={1} max={180} className="field num" value={focusDuration} onChange={(e) => setFocusDuration(Number(e.target.value))} />
          </Field>
          <Field label="Short break (minutes)">
            <input type="number" min={1} max={60} className="field num" value={shortBreakDuration} onChange={(e) => setShortBreakDuration(Number(e.target.value))} />
          </Field>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Long break (minutes)">
            <input type="number" min={1} max={120} className="field num" value={longBreakDuration} onChange={(e) => setLongBreakDuration(Number(e.target.value))} />
          </Field>
          <Field label="Long break interval (rounds)">
            <input type="number" min={1} max={12} className="field num" value={longBreakInterval} onChange={(e) => setLongBreakInterval(Number(e.target.value))} />
          </Field>
        </div>

        <label className="flex items-center gap-2 text-sm pt-2">
          <input type="checkbox" checked={soundEnabled} onChange={(e) => setSoundEnabled(e.target.checked)} />
          Play sound chime when session completes
        </label>

        <div className="mt-5 flex justify-end gap-2">
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn-primary" onClick={() => onSaved({ focusDuration, shortBreakDuration, longBreakDuration, longBreakInterval, soundEnabled })}>Save settings</button>
        </div>
      </div>
    </Dialog>
  )
}
