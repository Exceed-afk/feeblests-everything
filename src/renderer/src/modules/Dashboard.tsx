import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { BookOpen, CandlestickChart, PiggyBank, TrendingUp } from 'lucide-react'
import type { DashboardData, SavingsGoal } from '../../../shared/types'
import { progressPercent } from '../../../shared/savings'
import { MOOD_STYLE } from '../lib/moods'
import { formatDate, today } from '../lib/dates'
import { fmtAmount, fmtPnl, pnlColor } from '../lib/format'
import { errMsg } from '../lib/errors'
import type { ModuleProps } from '../lib/navigation'
import { ProgressBar } from '../components/ProgressBar'
import { PnlChart } from '../components/PnlChart'

const MAX_GOALS = 4 // savings goals shown before "View all"

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

  useEffect(() => {
    window.api.dashboard.summary(today()).then(setData).catch((e) => setError(errMsg(e)))
  }, [])

  const header = (
    <>
      <h1 className="text-2xl font-semibold">{greeting()}</h1>
      <p className="mt-2 text-muted">{formatDate(today())}. Your data stays on this computer.</p>
    </>
  )

  if (!data) {
    return (
      <div className="mx-auto max-w-5xl px-10 py-10">
        {header}
        {error && <p role="alert" className="mt-6 text-sm text-rose-500">{error}</p>}
      </div>
    )
  }

  const { tradeStats: ts, log, goals } = data
  const goalsShown = featuredGoals(goals).slice(0, MAX_GOALS)

  const card = (label: string, value: string, sub: string, color = '') => (
    <div className="rounded-2xl border border-line bg-card p-4 shadow-card">
      <div className="text-xs text-muted">{label}</div>
      <div className={`mt-1 text-2xl font-semibold tabular-nums ${color}`}>{value}</div>
      <div className="mt-1 text-xs text-muted">{sub}</div>
    </div>
  )

  return (
    <div className="mx-auto max-w-5xl px-10 py-10">
      {header}

      <div className="mt-8 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {card('Total saved', fmtAmount(data.totalSaved), goals.length === 0 ? 'No goals yet' : `across ${goals.length} ${goals.length === 1 ? 'goal' : 'goals'}`)}
        {card('Trading P&L', ts.closed === 0 ? '-' : fmtPnl(ts.totalPnl),
          ts.winRate === null ? 'No closed trades yet' : `${ts.winRate.toFixed(0)}% win rate`,
          ts.closed === 0 ? '' : pnlColor(ts.totalPnl))}
        {card('Trades logged', String(ts.total), `${ts.closed} closed, ${ts.open} open`)}
        {card('Logbook streak', `${log.streak} ${log.streak === 1 ? 'day' : 'days'}`,
          log.total === 0 ? 'Write your first entry'
            : log.streak === 0 ? 'Write today to start one'
            : `${log.thisMonth} ${log.thisMonth === 1 ? 'entry' : 'entries'} this month`)}
      </div>

      <div className="mt-6">
        <Panel title="P&L over time" icon={<TrendingUp size={16} />} onViewAll={() => onNavigate('trades')} showViewAll={data.pnlSeries.length > 0}>
          {data.pnlSeries.length === 0 ? (
            <Empty text="Close a trade (add its exit price) and your running P&L shows up here." action="Open trades" onAction={() => onNavigate('trades')} />
          ) : <PnlChart points={data.pnlSeries} />}
        </Panel>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Panel title="Recent log entries" icon={<BookOpen size={16} />} onViewAll={() => onNavigate('logbook')} showViewAll={data.recentEntries.length > 0}>
          {data.recentEntries.length === 0 ? (
            <Empty text="Nothing written yet. One line about today is a good start." action="Write an entry" onAction={() => onNavigate('logbook')} />
          ) : data.recentEntries.map((e) => (
            <Row key={e.id} onClick={() => onOpen({ module: 'logbook', entry: e })}>
              <div className="min-w-0">
                <div className="truncate text-sm font-medium">{e.title}</div>
                <div className="mt-0.5 flex items-center gap-2 text-xs text-muted">
                  {e.mood && <span title={MOOD_STYLE[e.mood].label} className={`h-2 w-2 rounded-full ${MOOD_STYLE[e.mood].dot}`} />}
                  {formatDate(e.date)}
                </div>
              </div>
            </Row>
          ))}
        </Panel>

        <Panel title="Recent trades" icon={<CandlestickChart size={16} />} onViewAll={() => onNavigate('trades')} showViewAll={data.recentTrades.length > 0}>
          {data.recentTrades.length === 0 ? (
            <Empty text="No trades yet. Your first entry starts the track record." action="Log a trade" onAction={() => onNavigate('trades')} />
          ) : data.recentTrades.map((t) => (
            <Row key={t.id} onClick={() => onOpen({ module: 'trades', trade: t })}>
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="truncate text-sm font-medium">{t.asset}</span>
                  <span className={`rounded-lg px-2 py-0.5 text-xs capitalize ${
                    t.direction === 'long' ? 'bg-emerald-500/10 text-emerald-500' : 'bg-rose-500/10 text-rose-500'}`}>{t.direction}</span>
                </div>
                <div className="mt-0.5 text-xs text-muted">{formatDate(t.date)}</div>
              </div>
              <span className={`shrink-0 text-sm font-medium tabular-nums ${pnlColor(t.pnl)}`}>{t.pnl === null ? 'Open' : fmtPnl(t.pnl)}</span>
            </Row>
          ))}
        </Panel>
      </div>

      <div className="mt-4">
        <Panel title="Savings progress" icon={<PiggyBank size={16} />} onViewAll={() => onNavigate('savings')} showViewAll={goals.length > 0}>
          {goals.length === 0 ? (
            <Empty text="Every big balance starts with one goal." action="Create a goal" onAction={() => onNavigate('savings')} />
          ) : (
            <>
              <div className="grid gap-x-6 gap-y-2 sm:grid-cols-2">
                {goalsShown.map((g) => {
                  const pct = progressPercent(g.balance, g.target)
                  return (
                    <Row key={g.id} onClick={() => onOpen({ module: 'savings', goalId: g.id })}>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-baseline justify-between gap-3">
                          <span className="truncate text-sm font-medium">{g.name}</span>
                          <span className="shrink-0 text-sm tabular-nums">{fmtAmount(g.balance)}</span>
                        </div>
                        {g.target !== null && pct !== null ? (
                          <>
                            <div className="mt-2"><ProgressBar percent={pct} /></div>
                            <div className="mt-1 flex justify-between text-xs text-muted">
                              <span>{pct >= 100 ? 'Goal reached' : `${Math.floor(pct)}%`}</span>
                              <span>Target {fmtAmount(g.target)}</span>
                            </div>
                          </>
                        ) : (
                          <div className="mt-1 text-xs text-muted">No target set</div>
                        )}
                      </div>
                    </Row>
                  )
                })}
              </div>
              {goals.length > goalsShown.length && (
                <button className="mt-3 text-xs text-muted hover:text-fg" onClick={() => onNavigate('savings')}>
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

function Panel({ title, icon, onViewAll, showViewAll, children }: {
  title: string; icon: ReactNode; onViewAll: () => void; showViewAll: boolean; children: ReactNode
}) {
  return (
    <section className="rounded-2xl border border-line bg-card p-5 shadow-card">
      <div className="flex items-center justify-between">
        <h2 className="flex items-center gap-2 text-sm font-medium">{icon} {title}</h2>
        {showViewAll && <button className="text-xs text-muted hover:text-fg" onClick={onViewAll}>View all</button>}
      </div>
      <div className="mt-3 flex flex-col gap-1">{children}</div>
    </section>
  )
}

// A clickable line inside a panel.
function Row({ onClick, children }: { onClick: () => void; children: ReactNode }) {
  return (
    <button onClick={onClick}
      className="-mx-2 flex w-[calc(100%+1rem)] items-center justify-between gap-3 rounded-xl px-2 py-2 text-left hover:bg-fg/5">
      {children}
    </button>
  )
}

function Empty({ text, action, onAction }: { text: string; action: string; onAction: () => void }) {
  return (
    <div className="py-4 text-center">
      <p className="text-sm text-muted">{text}</p>
      <button className="btn-primary mt-4" onClick={onAction}>{action}</button>
    </div>
  )
}
