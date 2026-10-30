import { useCallback, useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { BookOpen, CalendarCheck, CandlestickChart, Check, CheckSquare, ChevronRight, Circle, ClipboardCheck, Flame, PiggyBank, TrendingUp } from 'lucide-react'
import type { DashboardData, SavingsGoal } from '../../../shared/types'
import { progressPercent } from '../../../shared/savings'
import { moodStyle } from '../lib/moods'
import { formatDate, today } from '../lib/dates'
import { fmtAmount, fmtPnl, pnlColor } from '../lib/format'
import { errMsg } from '../lib/errors'
import { useRefreshOnCapture } from '../lib/dataChanged'
import type { ModuleProps } from '../lib/navigation'
import { ProgressBar } from '../components/ProgressBar'
import { PnlChart } from '../components/PnlChart'
import { PageHeader } from '../components/PageHeader'
import { EmptyState } from '../components/EmptyState'
import { Pnl } from '../components/Pnl'

const MAX_GOALS = 4 // savings goals shown before "View all"
const MAX_HABITS = 6 // habits listed in the tile before "+N more"

const greeting = (): string => {
  const hour = new Date().getHours()
  return hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening'
}

// Goals still in progress come first (closest to done on top), then reached
// goals, then goals with no target (largest balance first).
function featuredGoals(goals: SavingsGoal[]): SavingsGoal[] {
  const pct = (g: SavingsGoal) => progressPercent(g.balance, g.target)
  const rank = (g: SavingsGoal) => { const p = pct(g); return p === null ? 2 : p >= 100 ? 1 : 0 }
  return [...goals].sort((a, b) =>
    rank(a) - rank(b) || (rank(a) === 0 ? (pct(b) ?? 0) - (pct(a) ?? 0) : b.balance - a.balance))
}

export function Dashboard({ onOpen, onNavigate }: ModuleProps) {
  const [data, setData] = useState<DashboardData | null>(null)
  const [error, setError] = useState('')

  const load = useCallback(() => {
    window.api.dashboard.summary(today()).then(setData).catch((e) => setError(errMsg(e)))
  }, [])
  useEffect(() => { load() }, [load])
  useRefreshOnCapture(load) // something was saved from the Quick capture window

  const header = <PageHeader title={greeting()} subtitle={`${formatDate(today())}. Your data stays on this computer.`} />

  if (!data) {
    return (
      <div className="page page-lg">
        {header}
        {error && <p role="alert" className="text-sm text-neg">{error}</p>}
      </div>
    )
  }

  const { tradeStats: ts, log, goals, habits } = data
  const goalsShown = featuredGoals(goals).slice(0, MAX_GOALS)

  // A clickable stat tile: the whole tile opens the module it summarises.
  const stat = (label: string, value: string, sub: string, to: string, color = '') => (
    <button className="stat card card-pad-sm card-interactive" onClick={() => onNavigate(to)} aria-label={`${label}: ${value}. ${sub}. Open ${to}`}>
      <div className="stat-label">{label}</div>
      <div className={`stat-value ${color}`}>{value}</div>
      <div className="stat-sub">{sub}</div>
    </button>
  )

  return (
    <div className="page page-lg">
      {header}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {stat('Total saved', fmtAmount(data.totalSaved), goals.length === 0 ? 'No goals yet' : `across ${goals.length} ${goals.length === 1 ? 'goal' : 'goals'}`, 'savings')}
        {stat('Trading P&L', ts.closed === 0 ? '-' : fmtPnl(ts.totalPnl),
          ts.winRate === null ? 'No closed trades yet' : `${ts.winRate.toFixed(0)}% win rate`, 'trades', ts.closed === 0 ? '' : pnlColor(ts.totalPnl))}
        {stat('Trades logged', String(ts.total), `${ts.closed} closed, ${ts.open} open`, 'trades')}
        {stat('Logbook streak', `${log.streak} ${log.streak === 1 ? 'day' : 'days'}`,
          log.total === 0 ? 'Write your first entry'
            : log.streak === 0 ? 'Write today to start one'
            : `${log.thisMonth} ${log.thisMonth === 1 ? 'entry' : 'entries'} this month`, 'logbook')}
      </div>

      {/* One door to the weekly / monthly summary that ties the tools together */}
      <button className="card card-pad-sm card-interactive mt-4 flex w-full items-center justify-between gap-3 text-left" onClick={() => onNavigate('review')}>
        <span className="flex min-w-0 items-center gap-3">
          <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-accent/15 text-accent-fg"><ClipboardCheck size={16} /></span>
          <span className="min-w-0">
            <span className="block text-sm font-medium">Review your week</span>
            <span className="block truncate text-xs text-muted">Trades, savings, habits and mood in one summary, with a prompt to write it down.</span>
          </span>
        </span>
        <ChevronRight size={14} className="shrink-0 text-muted" />
      </button>

      <button className="card card-pad-sm card-interactive mt-4 flex w-full items-center justify-between gap-4 text-left" onClick={() => onNavigate('tasks')}
        aria-label={`Tasks: ${data.tasks.dueToday} due today, ${data.tasks.overdue} overdue, ${data.tasks.completedThisWeek} completed this week`}>
        <span className="flex items-center gap-3"><CheckSquare size={18} className="text-muted" /><span><span className="block text-sm font-medium">Tasks</span>
          <span className="meta">{data.tasks.dueToday} due today · {data.tasks.overdue} overdue · {data.tasks.completedThisWeek} completed this week</span></span></span>
        <ChevronRight size={14} className="text-muted" />
      </button>

      {/* Today + the P&L curve */}
      <div className="mt-4 grid gap-4 lg:grid-cols-5">
        <div className="lg:col-span-2"><HabitsTile habits={habits} onOpenHabits={() => onNavigate('habits')} /></div>
        <div className="lg:col-span-3">
          <Panel title="P&L over time" icon={<TrendingUp size={15} />} onViewAll={() => onNavigate('trades')} showViewAll={data.pnlSeries.length > 0}>
            {data.pnlSeries.length === 0 ? (
              <EmptyState compact title="No closed trades yet" text="Close a trade (add its exit price) and your running P&L shows up here."
                action={<button className="btn-primary" onClick={() => onNavigate('trades')}>Open trades</button>} />
            ) : <PnlChart points={data.pnlSeries} />}
          </Panel>
        </div>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Panel title="Recent log entries" icon={<BookOpen size={15} />} onViewAll={() => onNavigate('logbook')} showViewAll={data.recentEntries.length > 0}>
          {data.recentEntries.length === 0 ? (
            <EmptyState compact title="Nothing written yet" text="One line about today is a good start."
              action={<button className="btn-primary" onClick={() => onNavigate('logbook')}>Write an entry</button>} />
          ) : data.recentEntries.map((e) => (
            <Row key={e.id} onClick={() => onOpen({ module: 'logbook', entry: e })}>
              <div className="min-w-0">
                <div className="truncate text-sm font-medium">{e.title}</div>
                <div className="meta mt-0.5 flex items-center gap-2">
                  {e.mood && <span title={moodStyle(e.mood).label} className={`h-2 w-2 rounded-full ${moodStyle(e.mood).dot}`} />}
                  {formatDate(e.date)}
                  {e.mood && <span>{moodStyle(e.mood).label}</span>}
                </div>
              </div>
            </Row>
          ))}
        </Panel>

        <Panel title="Recent trades" icon={<CandlestickChart size={15} />} onViewAll={() => onNavigate('trades')} showViewAll={data.recentTrades.length > 0}>
          {data.recentTrades.length === 0 ? (
            <EmptyState compact title="No trades yet" text="Your first entry starts the track record."
              action={<button className="btn-primary" onClick={() => onNavigate('trades')}>Log a trade</button>} />
          ) : data.recentTrades.map((t) => (
            <Row key={t.id} onClick={() => onOpen({ module: 'trades', trade: t })}>
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="truncate text-sm font-medium">{t.asset}</span>
                  <span className={`badge capitalize ${t.direction === 'long' ? 'badge-pos' : 'badge-neg'}`}>{t.direction}</span>
                </div>
                <div className="meta mt-0.5">{formatDate(t.date)}</div>
              </div>
              <span className="shrink-0 text-sm font-medium">
                {t.pnl === null ? <span className="badge badge-open">Open</span> : <Pnl value={t.pnl} />}
              </span>
            </Row>
          ))}
        </Panel>
      </div>

      <div className="mt-4">
        <Panel title="Savings progress" icon={<PiggyBank size={15} />} onViewAll={() => onNavigate('savings')} showViewAll={goals.length > 0}>
          {goals.length === 0 ? (
            <EmptyState compact title="No savings goals yet" text="Every big balance starts with one goal."
              action={<button className="btn-primary" onClick={() => onNavigate('savings')}>Create a goal</button>} />
          ) : (
            <>
              <div className="grid gap-x-8 gap-y-1 sm:grid-cols-2">
                {goalsShown.map((g) => {
                  const pct = progressPercent(g.balance, g.target)
                  return (
                    <Row key={g.id} onClick={() => onOpen({ module: 'savings', goalId: g.id })}>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-baseline justify-between gap-3">
                          <span className="truncate text-sm font-medium">{g.name}</span>
                          <span className="num shrink-0 text-sm">{fmtAmount(g.balance)}</span>
                        </div>
                        {g.target !== null && pct !== null ? (
                          <>
                            <div className="mt-2"><ProgressBar percent={pct} /></div>
                            <div className="meta mt-1 flex justify-between">
                              <span>{pct >= 100 ? 'Goal reached' : `${Math.floor(pct)}%`}</span>
                              <span>Target {fmtAmount(g.target)}</span>
                            </div>
                          </>
                        ) : (
                          <div className="meta mt-1">No target set</div>
                        )}
                      </div>
                    </Row>
                  )
                })}
              </div>
              {goals.length > goalsShown.length && (
                <button className="section-link mt-2" onClick={() => onNavigate('savings')}>
                  + {goals.length - goalsShown.length} more {goals.length - goalsShown.length === 1 ? 'goal' : 'goals'}
                </button>
              )}
            </>
          )}
        </Panel>
      </div>
    </div>
  )
}

// "Habits today": done / due, the longest running streak, and today's list. The tile and each line open the Habits page.
function HabitsTile({ habits, onOpenHabits }: { habits: DashboardData['habits']; onOpenHabits: () => void }) {
  const shown = habits.items.slice(0, MAX_HABITS)
  const more = habits.items.length - shown.length
  const allDone = habits.due > 0 && habits.done === habits.due
  const head = (
    <div className="flex items-center justify-between">
      <h2 className="section-title"><CalendarCheck size={15} /> Habits today</h2>
      {habits.total > 0 && <span className="section-link">Open <ChevronRight size={12} /></span>}
    </div>
  )

  if (habits.total === 0) {
    return (
      <section className="card card-pad h-full">
        {head}
        <div className="mt-3">
          <EmptyState compact title="No habits yet" text="Add one you can do even on a bad day."
            action={<button className="btn-primary" onClick={onOpenHabits}>Add a habit</button>} />
        </div>
      </section>
    )
  }

  return (
    <section className="card card-pad card-interactive h-full" onClick={onOpenHabits}>
      {head}
      <div className="mt-3 flex items-end justify-between gap-3">
        <div>
          <div className="stat-value mt-0">{habits.done}<span className="text-muted"> / {habits.due}</span></div>
          <div className="stat-sub">{habits.due === 0 ? 'Nothing scheduled today' : allDone ? 'All done. Nicely done.' : 'done today'}</div>
        </div>
        <div className="meta flex items-center gap-1" title="Longest current streak among your habits">
          <Flame size={14} className={habits.longestStreak > 0 ? 'warn' : ''} />
          <span className="num font-medium text-fg">{habits.longestStreak}-day</span> best streak
        </div>
      </div>
      {habits.due > 0 && <div className="mt-3"><ProgressBar percent={(habits.done / habits.due) * 100} /></div>}
      {shown.length > 0 && (
        <ul className="mt-3 flex flex-col gap-0.5">
          {shown.map((h) => (
            <li key={h.id}>
              <button className="row-link" onClick={(e) => { e.stopPropagation(); onOpenHabits() }}
                aria-label={`${h.name}: ${h.done ? 'done' : 'not done yet'}`}>
                <span className="flex min-w-0 items-center gap-2.5">
                  {h.done
                    ? <span className="grid h-4 w-4 shrink-0 place-items-center rounded-full bg-accent text-on-accent"><Check size={11} strokeWidth={3} /></span>
                    : <Circle size={16} className="shrink-0 text-muted" />}
                  <span className={`truncate text-sm ${h.done ? 'text-muted line-through decoration-muted/50' : ''}`}>{h.name}</span>
                </span>
                {h.streak > 0 && <span className="meta num flex shrink-0 items-center gap-0.5"><Flame size={12} className="warn" />{h.streak}</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
      {more > 0 && <div className="meta mt-1">+ {more} more</div>}
    </section>
  )
}

function Panel({ title, icon, onViewAll, showViewAll, children }: {
  title: string; icon: ReactNode; onViewAll: () => void; showViewAll: boolean; children: ReactNode
}) {
  return (
    <section className="card card-pad h-full">
      <div className="flex items-center justify-between">
        <h2 className="section-title">{icon} {title}</h2>
        {showViewAll && <button className="section-link" onClick={onViewAll}>View all <ChevronRight size={12} /></button>}
      </div>
      <div className="mt-3 flex flex-col gap-0.5">{children}</div>
    </section>
  )
}

// A clickable line inside a panel.
function Row({ onClick, children }: { onClick: () => void; children: ReactNode }) {
  return <button onClick={onClick} className="row-link">{children}</button>
}
