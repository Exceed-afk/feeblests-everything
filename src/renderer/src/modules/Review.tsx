import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import {
  AlertCircle, ArrowDownRight, ArrowUpRight, BookOpen, CalendarCheck, CandlestickChart, Flame, Lightbulb, PiggyBank,
  Plus, Smile, Sparkles, TrendingDown, TrendingUp
} from 'lucide-react'
import { MOODS, DEFAULT_INTELLIGENCE, type InsightsPayload, type Mood, type ReviewData, type ReviewGoal, type ReviewKind, type ReviewTx } from '../../../shared/types'
import { REVIEW_TAG, reviewRange, shiftRange, periodLabel, summaryText, weeklyInsights } from '../../../shared/review'
import { progressPercent, signedAmount } from '../../../shared/savings'
import { shortDate } from '../../../shared/design'
import { WEEKDAY_NAMES, weekdayOf } from '../../../shared/habits'
import { MOOD_STYLE, moodStyle, wordNear } from '../lib/moods'
import { formatDate, today } from '../lib/dates'
import { fmtAmount, fmtPnl, round8 } from '../lib/format'
import { errMsg } from '../lib/errors'
import { useRefreshOnCapture } from '../lib/dataChanged'
import type { ModuleProps } from '../lib/navigation'
import { PageHeader, PeriodArrows } from '../components/PageHeader'
import { EmptyState } from '../components/EmptyState'
import { useSettings } from '../lib/settingsStore'
import { ProgressBar } from '../components/ProgressBar'
import { Pnl } from '../components/Pnl'
import { MoodTrend, TradeBars, TrendSpark } from '../components/Charts'
import { HabitWeekRow, MoodDays, WeekStrip } from '../components/ReviewViews'
import { tradeBars, type TradeView } from '../lib/chartData'

const MAX_HABITS = 6 // habits listed in the card before "+N more"
const MAX_MISSED = 4 // missed days named under a habit before "+N"
const MAX_TX = 4 // savings transactions listed before "and N more"

// A change that matters: below this the two periods are described as "the same".
const FLAT = 0.005

export interface Draft { body: string; mood: Mood | null }

// Unsaved reflection text, per period and per loaded answer: stepping to another week and back keeps it, and once a
// save has brought fresh data the box starts again from the saved entry (the draft is dropped, as before).
// Exported for the page's tests and for anyone reusing the key; the page is its only caller.
export const draftKeyOf = (data: ReviewData, stamp: number): string => `${data.kind}:${data.start}:${stamp}`

// Saves a draft and the way back to its period's data. Without the page around it (a design preview, a test) the
// reflection still works: it keeps its draft in its own state.
interface DraftBox { draft: Draft | null; set: (d: Draft | null) => void; reload: () => void }
const DraftContext = createContext<DraftBox | null>(null)
function useDraft(): DraftBox {
  const fromPage = useContext(DraftContext)
  const [own, setOwn] = useState<Draft | null>(null)
  // Always building the object keeps the hook order the same whether or not the page is above us.
  return fromPage ?? { draft: own, set: setOwn, reload: () => undefined }
}

export function Review({ onOpen, onNavigate }: ModuleProps) { // eslint-disable-line no-unused-vars
  const settings = useSettings()
  const [kind, setKind] = useState<ReviewKind>('week')
  const [anchor, setAnchor] = useState(today()) // any date inside the period being shown
  const [data, setData] = useState<ReviewData | null>(null)
  const [error, setError] = useState('')
  // Reflection text that is typed but not saved yet, keyed by period and answer (see draftKeyOf).
  const [drafts, setDrafts] = useState<Record<string, Draft>>({})
  // Every answer carries a new stamp, so the reflection box can tell a first load from a reload after saving.
  const [stamp, setStamp] = useState(0)
  const latest = useRef(0) // the newest request wins, so a slow answer for an old period cannot overwrite a newer one

  // `bump` also starts the reflection box afresh: used after a save and when another window saved something, never
  // when you merely step between periods (typed text there is kept).
  const load = useCallback(async (bump = false) => {
    if (bump) setStamp((s) => s + 1)
    const request = ++latest.current
    try {
      const d = await window.api.review.build(kind, anchor, today())
      if (request === latest.current) { setData(d); setError('') }
    } catch (e) {
      if (request === latest.current) setError(errMsg(e))
    }
  }, [kind, anchor])
  useEffect(() => { void load() }, [load])
  useRefreshOnCapture(() => { void load(true) }) // something was saved from the Quick capture window

  // Coming back to the window (maybe the next day) refreshes the numbers.
  useEffect(() => {
    const onFocus = () => { void load() }
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [load])

  const now = today()
  const insightsOn = settings.intelligence?.features.insights ?? DEFAULT_INTELLIGENCE.features.insights
  const [topInsights, setTopInsights] = useState<InsightsPayload | null>(null)
  useEffect(() => {
    if (!insightsOn) return
    const d = new Date()
    const t = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    window.api.intelligence.insights.build(t).then(setTopInsights).catch(() => undefined)
  }, [insightsOn])
  const range = useMemo(() => reviewRange(kind, anchor), [kind, anchor])
  const word = kind === 'week' ? 'week' : 'month'
  const isCurrent = range.start <= now && now <= range.end
  const stale = !data || data.kind !== kind || data.start !== range.start // the answer for this period is still on its way
  const step = (delta: number) => setAnchor(shiftRange(kind, range, delta).start)

  const header = (
    <PageHeader title="Review" subtitle={
      <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span>{periodLabel(kind, range.start, range.end)}</span>
        {range.end >= now
          ? <span className="badge badge-open">In progress</span>
          : <span className="badge badge-done">Complete</span>}
      </span>
    }>
      <div className="seg" role="group" aria-label="Review period">
        <button aria-pressed={kind === 'week'} onClick={() => setKind('week')}>Week</button>
        <button aria-pressed={kind === 'month'} onClick={() => setKind('month')}>Month</button>
      </div>
      <PeriodArrows onPrev={() => step(-1)} onNext={() => step(1)} nextDisabled={range.end >= now}
        prevLabel={`Previous ${word}`} nextLabel={`Next ${word}`} />
      {/* Always rendered, so stepping between periods never moves the controls beside it. */}
      <button className={`btn btn-sm ${isCurrent ? 'invisible' : ''}`} onClick={() => setAnchor(now)} disabled={isCurrent}
        aria-hidden={isCurrent}>This {word}</button>
    </PageHeader>
  )

  if (!data) {
    return (
      <div className="page page-lg" aria-busy={!error}>
        {header}
        {error
          ? <ReviewError message={error} onRetry={() => { void load() }} />
          : <ReviewLoading />}
      </div>
    )
  }

  const draftKey = draftKeyOf(data, stamp)
  const setDraft = (d: Draft | null) => setDrafts((all) => {
    const next = { ...all }
    if (d) next[draftKey] = d
    else delete next[draftKey]
    return next
  })

  const top = topInsights && [...topInsights.comparisons, ...topInsights.correlations]
    .filter((c) => c.ok && !topInsights.dismissed.includes(c.id)).slice(0, 3)

  return (
    <div className="page page-lg" aria-busy={stale}>
      {header}
      {error && <ReviewError message={error} onRetry={() => { void load() }} compact />}
      <div className={stale ? 'opacity-60 transition-opacity' : 'transition-opacity'}>
        <DraftContext.Provider value={{ draft: drafts[draftKey] ?? null, set: setDraft, reload: () => load(true) }}>
          <ReviewBody data={data} onOpen={onOpen} onNavigate={onNavigate} />
        </DraftContext.Provider>
      </div>

      {insightsOn && top && top.length > 0 && (
        <section className="card card-pad mt-4" aria-label="Top insights">
          <div className="card-head">
            <h2 className="card-head-title"><span className="card-head-icon"><Lightbulb size={15} /></span> Top insights</h2>
            <button className="card-link" onClick={() => onNavigate('insights')}>See all <ArrowUpRight size={12} /></button>
          </div>
          <ul className="mt-3 flex flex-col gap-2 text-sm">
            {top.map((c) => <li key={c.id}>{c.text}<span className="meta"> {c.detail}</span></li>)}
          </ul>
        </section>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------------------------------------------
// Everything below only needs the data, so it can be drawn (and tested) without the database.

type Nav = Pick<ModuleProps, 'onOpen' | 'onNavigate'>

export function ReviewBody({ data, onOpen, onNavigate }: Nav & { data: ReviewData }) {
  const { trades, savings, habits, mood } = data
  const word = data.kind === 'week' ? 'week' : 'month'
  const ts = trades.stats

  const nothing = ts.total === 0 && savings.txCount === 0 && habits.due === 0 && habits.bonus === 0 && data.tasks.created === 0 && data.tasks.completed === 0 && mood.logged === 0 && data.journal.entries.length === 0

  return (
    <>
      {/* ---- Summary: the four headline figures, in one row on a wide screen ---- */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <TradingCard data={data} onNavigate={onNavigate} />
        <SavingsCard data={data} onNavigate={onNavigate} />
        <HabitCard data={data} onNavigate={onNavigate} />
        <MoodCard data={data} onNavigate={onNavigate} />
      </div>

      {nothing && (
        <div className="mt-4">
          <EmptyState icon={BookOpen} title={`Nothing to review for this ${word} yet`}
            text="Log a trade, a saving, a habit check-in or a mood and it shows up here. You can still write a reflection below."
            action={<button className="btn-primary" onClick={() => onNavigate('logbook')}>Open logbook</button>} />
        </div>
      )}

      {!nothing && (
        <div className="mt-4 grid items-start gap-4 lg:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
          <TradingPanel data={data} onOpen={onOpen} onNavigate={onNavigate} />
          <SavingsPanel data={data} onOpen={onOpen} onNavigate={onNavigate} />
          <HabitsPanel data={data} onNavigate={onNavigate} />
          <MoodPanel data={data} onNavigate={onNavigate} />
        </div>
      )}

      {!nothing && <WeeklyInsights data={data} />}

      {data.insights.length > 0 && (
        <section className="card card-pad mt-4">
          <h2 className="card-head-title"><span className="card-head-icon"><Sparkles size={15} /></span>Across your tools</h2>
          <ul className="mt-3 flex flex-col gap-2 text-sm">
            {data.insights.map((i) => <li key={i.id}>{i.text}</li>)}
          </ul>
          <p className="meta mt-3">These put the numbers side by side. They do not show that one causes the other.</p>
        </section>
      )}

      <Reflection key={`${data.kind}:${data.start}`} data={data} onOpen={onOpen} />
      <ReflectionForm data={data} onOpen={onOpen} />

      <p className="meta mt-4">
        Trades count on their entry date, like the P&L curve on the dashboard. Habits count scheduled days that have passed;
        today only counts once it is checked off.
      </p>
    </>
  )
}

// ---------------------------------------------------------------------------------------------------------------
// Summary cards: one metric in charge, a supporting line, and one small visual each (sparkline, strip, bar, chart).


const isFlat = (n: number): boolean => Math.abs(n) < FLAT

// The comparison under a metric. While the period is still running the previous period is shown as plain context,
// because half a week set against a whole week would look like a drop that is not one.
function Versus({ data, now, before, format, points, prevWord }: {
  data: ReviewData; now: number | null; before: number | null; format: (n: number) => string; points?: number; prevWord: string
}) {
  if (before === null) return <span className="text-muted">No {prevWord} to compare</span>
  if (!data.complete || now === null) return <span className="text-muted">{cap(prevWord)}: {format(before)}</span>
  const diff = round8(now - before)
  if (isFlat(diff)) return <span className="text-muted">Same as {prevWord}</span>
  const up = diff > 0
  return (
    <span className="flex items-center gap-1">
      {up ? <ArrowUpRight size={13} className="pos" aria-hidden="true" /> : <ArrowDownRight size={13} className="neg" aria-hidden="true" />}
      <span className={up ? 'text-pos' : 'text-neg'}>{up ? '+' : '-'}{fmtAmount(Math.abs(diff))}{points === undefined ? '' : points === 1 ? ' pt' : ' pts'}</span>
      <span className="text-muted">vs {prevWord}</span>
    </span>
  )
}

type GoTo = { data: ReviewData; onNavigate: (where: string) => void }

function TradingCard({ data, onNavigate }: GoTo) {
  const ts = data.trades.stats
  const values = tradeBars(data.trades.days, 'cumulative').map((b) => b.value)
  return (
    <button className="card card-pad-sm card-interactive kpi" onClick={() => onNavigate('trades')}
      aria-label={`Trading P&L ${ts.closed === 0 ? 'none closed yet' : fmtPnl(ts.totalPnl)}. ${ts.closed} closed, ${ts.winRate === null ? 0 : Math.round(ts.winRate)}% wins. Open trades`}>
      <span className="kpi-label">Trading P&L</span>
      <span>
        <span className={`kpi-value block ${ts.closed === 0 ? 'text-muted' : pnlClass(ts.totalPnl)}`}>{ts.closed === 0 ? '–' : fmtPnl(ts.totalPnl)}</span>
        <span className="kpi-sub block">
          {ts.closed === 0 ? (ts.open > 0 ? `${ts.open} open, none closed` : 'No closed trades') : `${ts.closed} closed, ${ts.winRate === null ? 0 : Math.round(ts.winRate)}% wins`}
        </span>
      </span>
      {ts.closed > 0 ? <TrendSpark values={values} /> : <div className="h-9" />}
      <span className="kpi-foot">
        <Versus data={data} now={ts.closed === 0 ? null : ts.totalPnl} before={data.trades.previous.closed === 0 ? null : data.trades.previous.totalPnl}
          format={fmtPnl} prevWord="previous period" />
      </span>
    </button>
  )
}

function SavingsCard({ data, onNavigate }: GoTo) {
  const s = data.savings
  // The goal closest to its target: the one the progress bar is about. Only goals with a target can progress.
  const goals = s.goals.filter((g) => g.target !== null && g.target > 0)
  const focus = [...goals].sort((a, b) => (progressPercent(b.endBalance, b.target) ?? 0) - (progressPercent(a.endBalance, a.target) ?? 0))[0] ?? null
  const pct = focus ? progressPercent(focus.endBalance, focus.target) : null
  return (
    <button className="card card-pad-sm card-interactive kpi" onClick={() => onNavigate('savings')}
      aria-label={`Savings movement ${s.txCount === 0 ? 'none' : fmtPnl(s.net)}. Balance ${fmtAmount(s.endBalance)}. Open savings`}>
      <span className="kpi-label">Savings movement</span>
      <span>
        <span className={`kpi-value block ${s.txCount === 0 ? 'text-muted' : pnlClass(s.net)}`}>{s.txCount === 0 ? '–' : fmtPnl(s.net)}</span>
        <span className="kpi-sub block">Balance {fmtAmount(s.endBalance)}</span>
      </span>
      {focus && pct !== null ? (
        <span className="block pt-2.5">
          <ProgressBar percent={pct} tone="mood" />
          <span className="meta mt-1.5 flex justify-between gap-2">
            <span className="truncate">{focus.name}</span>
            <span className="num shrink-0">{Math.floor(pct)}% of {fmtAmount(focus.target as number)}</span>
          </span>
        </span>
      ) : (
        <span className="meta block pt-4">{s.goals.length > 0 ? 'No goal with a target moved' : 'Set a goal target to see progress'}</span>
      )}
      <span className="kpi-foot">
        <Versus data={data} now={s.txCount === 0 ? null : s.net} before={s.previousNet === 0 ? null : s.previousNet}
          format={fmtPnl} prevWord="previous period" />
      </span>
    </button>
  )
}

function HabitCard({ data, onNavigate }: GoTo) {
  const h = data.habits
  return (
    <button className="card card-pad-sm card-interactive kpi" onClick={() => onNavigate('habits')}
      aria-label={`Habit consistency ${h.rate === null ? 'nothing scheduled' : `${Math.round(h.rate)} percent`}. ${h.done} of ${h.due} days done. Open habits`}>
      <span className="kpi-label">Habit consistency</span>
      <span>
        <span className={`kpi-value block ${h.rate === null ? 'text-muted' : ''}`}>{h.rate === null ? '–' : `${Math.round(h.rate)}%`}</span>
        <span className="kpi-sub block">
          {h.rate === null ? 'Nothing scheduled yet' : `${h.done} of ${h.due} days done${h.bonus > 0 ? `, +${h.bonus} bonus` : ''}`}
        </span>
      </span>
      {h.rate === null ? <div className="h-10" /> : <span className="block pt-1.5"><WeekStrip days={h.days.slice(0, 7)} today={data.today} trackedFrom={h.trackedFrom} /></span>}
      <span className="kpi-foot">
        <Versus data={data} now={h.rate === null ? null : Math.round(h.rate)} before={h.previousRate === null ? null : Math.round(h.previousRate)}
          format={(n) => `${n}%`} points={1} prevWord="previous period" />
      </span>
    </button>
  )
}

function MoodCard({ data, onNavigate }: GoTo) {
  const m = data.mood
  const avg = m.average
  return (
    <button className="card card-pad-sm card-interactive kpi" onClick={() => onNavigate('logbook')}
      aria-label={`Mood ${avg === null ? 'none logged' : `${avg.toFixed(1)} of 5`}. ${m.logged} entries. Open logbook`}>
      <span className="kpi-label">Mood</span>
      <span>
        <span className={`kpi-value block ${avg === null ? 'text-muted' : ''}`}>{avg === null ? '–' : avg.toFixed(1)}{avg !== null && <span className="text-base font-medium text-muted"> / 5</span>}</span>
        <span className="kpi-sub block">
          {avg === null ? 'No moods logged' : `${MOOD_STYLE[wordNear(avg)].label}, ${m.logged} ${m.logged === 1 ? 'entry' : 'entries'}`}
        </span>
      </span>
      {avg === null ? <div className="h-9" /> : <span className="chart-mood block pt-1.5"><MoodCardDot avg={avg} days={m.days} /></span>}
      <span className="kpi-foot">
        <Versus data={data} now={avg} before={m.previousAverage} format={(n) => n.toFixed(1)} points={1} prevWord="previous period" />
      </span>
    </button>
  )
}

// The seven mood dots of the period, a compact view of the same scale as the big trend chart.
function MoodCardDot({ avg, days }: { avg: number; days: ReviewData['mood']['days'] }) {
  return (
    <span className="flex items-end gap-1" aria-hidden="true">
      {days.slice(0, 7).map((d) => (
        <span key={d.date} className="flex flex-1 flex-col items-center gap-1">
          {d.average === null
            ? <span className="h-1.5 w-1.5 rounded-full border border-dashed border-line" />
            : <span className={`rounded-full ${MOOD_STYLE[wordNear(d.average)].dot}`} style={{ width: 6 + (d.average / 5) * 6, height: 6 + (d.average / 5) * 6 }} />}
        </span>
      ))}
      <span className="ml-1 text-[10px] text-muted">avg {avg.toFixed(1)}</span>
    </span>
  )
}

// ---------------------------------------------------------------------------------------------------------------
// Trading panel

function TradingPanel({ data, onOpen, onNavigate }: Nav & { data: ReviewData }) {
  const { trades } = data
  const ts = trades.stats
  const [view, setView] = useState<TradeView>('pnl')
  const traded = trades.days.filter((d) => d.closed > 0).length
  return (
    <Panel title="Trading" icon={<CandlestickChart size={15} />} link={{ label: 'Open trades', onClick: () => onNavigate('trades') }}>
      {ts.total === 0 ? (
        <EmptyState compact title={`No trades this ${data.kind === 'week' ? 'week' : 'month'}`} text="Trades count on the day they were entered."
          action={<button className="btn-primary" onClick={() => onNavigate('trades')}>Log a trade</button>} />
      ) : (
        <>
          <dl className="facts">
            <Fact label="Closed trades" value={<>{ts.closed}{ts.open > 0 && <span className="ml-1 text-xs font-normal text-muted">+{ts.open} open</span>}</>} />
            <Fact label="Win rate" value={ts.winRate === null ? '-' : `${Math.round(ts.winRate)}%`} />
            <Fact label="Fees" value={fmtAmount(ts.totalFees)} />
          </dl>

          {ts.closed > 0 && (
            <div className="mt-4">
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                <div className="legend">
                  <span><span className="legend-swatch bg-pos" aria-hidden="true" />Profit</span>
                  <span><span className="legend-swatch bg-neg" aria-hidden="true" />Loss</span>
                </div>
                {traded > 1 && (
                  <div className="seg" role="group" aria-label="Chart view">
                    {(Object.keys(TRADE_VIEWS) as TradeView[]).map((v) => (
                      <button key={v} aria-pressed={view === v} onClick={() => setView(v)}>{TRADE_VIEWS[v]}</button>
                    ))}
                  </div>
                )}
              </div>
              <TradeBars days={trades.days} kind={data.kind} today={data.today} view={view} />
              <p className="meta mt-1">
                {view === 'pnl' ? 'Closed trades by the day they were entered.' : view === 'cumulative' ? 'Running total through the period.' : 'How many trades closed each day.'}
              </p>
            </div>
          )}

          {(trades.best || trades.worst || ts.closed > 0) && (
            <div className="mt-4 border-t border-line pt-3">
              <div className="subhead mb-1">Best and worst</div>
              <div className="flex flex-col">
                {trades.best && <TradeLine label="Best" trade={trades.best} onClick={() => onOpen({ module: 'trades', trade: trades.best! })} />}
                {trades.worst && <TradeLine label="Worst" trade={trades.worst} onClick={() => onOpen({ module: 'trades', trade: trades.worst! })} />}
                {!trades.best && !trades.worst && <p className="meta">No winning or losing trade to name yet.</p>}
              </div>
            </div>
          )}
        </>
      )}
    </Panel>
  )
}

const TRADE_VIEWS: Record<TradeView, string> = { pnl: 'Daily P&L', cumulative: 'Cumulative', count: 'Trades' }

// ---------------------------------------------------------------------------------------------------------------
// Savings panel: overview, goal, recent activity

function SavingsPanel({ data, onOpen, onNavigate }: Nav & { data: ReviewData }) {
  const s = data.savings
  const word = data.kind === 'week' ? 'week' : 'month'
  const moved = s.goals
  return (
    <Panel title="Savings" icon={<PiggyBank size={15} />} link={{ label: 'Open savings', onClick: () => onNavigate('savings') }}>
      {/* A. Overview */}
      <div className="subhead">Overview</div>
      <dl className="facts mt-2">
        <Fact label="Deposited" value={<span className={s.deposits > 0 ? 'text-pos' : ''}>{fmtAmount(s.deposits)}</span>} />
        <Fact label="Withdrawn" value={<span className={s.withdrawals > 0 ? 'text-neg' : ''}>{fmtAmount(s.withdrawals)}</span>} />
        <Fact label="Net" value={<Pnl value={s.net} />} />
      </dl>
      <p className="meta mt-2">Total balance {fmtAmount(s.startBalance)} to {fmtAmount(s.endBalance)}.</p>

      {/* B. Goal progress */}
      <div className="mt-4 border-t border-line pt-3">
        <div className="subhead">Goal progress</div>
        {moved.length === 0 ? (
          <p className="meta mt-1.5">No deposits or withdrawals this {word}. Balance is still {fmtAmount(s.endBalance)}.</p>
        ) : (
          <ul className="mt-1 flex flex-col">
            {moved.map((g) => (
              <li key={g.goalId}>
                <GoalRow goal={g} onClick={() => onOpen({ module: 'savings', goalId: g.goalId })} />
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* C. Recent activity: the stored transactions, never a re-calculated figure */}
      {s.recent.length > 0 && (
        <div className="mt-4 border-t border-line pt-3">
          <div className="subhead mb-1">Recent activity</div>
          <ul className="flex flex-col">
            {s.recent.slice(0, MAX_TX).map((t) => <li key={t.id}><TxRow tx={t} onClick={() => onOpen({ module: 'savings', goalId: t.goalId })} /></li>)}
          </ul>
          {s.txCount > MAX_TX && <button className="card-link mt-1" onClick={() => onNavigate('savings')}>and {s.txCount - MAX_TX} more this {word}</button>}
        </div>
      )}
    </Panel>
  )
}

function GoalRow({ goal, onClick }: { goal: ReviewGoal; onClick: () => void }) {
  const pct = progressPercent(goal.endBalance, goal.target)
  return (
    <button className="row-link" onClick={onClick}>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-3">
          <span className="flex min-w-0 items-center gap-2">
            <span className="truncate text-sm font-medium">{goal.name}</span>
            {goal.reached && <span className="badge badge-pos">Goal reached</span>}
          </span>
          <span className="shrink-0 text-sm"><Pnl value={goal.net} /></span>
        </div>
        {pct !== null && <div className="mt-1.5"><ProgressBar percent={pct} tone="mood" /></div>}
        <div className="meta mt-1 flex justify-between gap-2">
          <span>Balance {fmtAmount(goal.endBalance)}</span>
          {goal.target !== null && pct !== null && <span className="num">{Math.floor(pct)}% of {fmtAmount(goal.target)}</span>}
        </div>
      </div>
    </button>
  )
}

function TxRow({ tx, onClick }: { tx: ReviewTx; onClick: () => void }) {
  const out = tx.kind === 'withdrawal'
  const signed = signedAmount(tx.kind, tx.amount)
  return (
    <button className="row-link" onClick={onClick} title={tx.note || undefined}>
      <span className="flex min-w-0 items-center gap-2">
        <span className={`grid h-6 w-6 shrink-0 place-items-center rounded-full ${out ? 'bg-neg/10 text-neg' : 'bg-pos/10 text-pos'}`} aria-hidden="true">
          {out ? <ArrowDownRight size={13} /> : <ArrowUpRight size={13} />}
        </span>
        <span className="min-w-0">
          <span className="block truncate text-sm">{out ? 'Withdrawal' : 'Deposit'} <span className="text-muted">· {tx.goalName}</span></span>
          <span className="meta block">{shortDate(tx.date)}</span>
        </span>
      </span>
      <span className={`shrink-0 text-sm font-medium num ${out ? 'text-neg' : 'text-pos'}`}>{signed > 0 ? '+' : '-'}{fmtAmount(tx.amount)}</span>
    </button>
  )
}

// ---------------------------------------------------------------------------------------------------------------
// Habits and Mood panels

function HabitsPanel({ data, onNavigate }: GoTo) {
  const h = data.habits
  return (
    <Panel title="Habits" icon={<CalendarCheck size={15} />} link={{ label: 'Open habits', onClick: () => onNavigate('habits') }}>
      {h.habits.length === 0 ? (
        <EmptyState compact title="No habit days to count" text="Add a habit and check it off day by day."
          action={<button className="btn-primary" onClick={() => onNavigate('habits')}>Open habits</button>} />
      ) : (
        <>
          <div className="flex flex-wrap items-end justify-between gap-2">
            <div>
              <div className="kpi-value">{h.rate === null ? '–' : `${Math.round(h.rate)}%`}</div>
              <div className="meta">
                {h.done} of {h.due} scheduled days{h.bonus > 0 && `, plus ${h.bonus} on rest ${h.bonus === 1 ? 'day' : 'days'}`}
              </div>
            </div>
            <div className="meta text-right">
              <div>Best current streak</div>
              <div className="flex items-center justify-end gap-1 text-sm font-semibold text-fg"><Flame size={14} className="warn" />{Math.max(...h.habits.map((x) => x.streak), 0)}</div>
            </div>
          </div>
          <div className="mt-3">
            <WeekStrip days={h.days.slice(0, 7)} today={data.today} trackedFrom={h.trackedFrom} />
            <div className="legend mt-2">
              <span><span className="hs-swatch" data-state="done" aria-hidden="true" />Completed</span>
              <span><span className="hs-swatch" data-state="partial" aria-hidden="true" />Incomplete</span>
              <span><span className="hs-swatch" data-state="rest" aria-hidden="true" />Not scheduled</span>
              <span><span className="hs-swatch" data-state="untracked" aria-hidden="true" />Not tracked</span>
            </div>
          </div>
          <ul className="mt-3 flex flex-col">
            {h.habits.slice(0, MAX_HABITS).map((habit) => (
              <li key={habit.id} className="border-b border-line/60 py-2 last:border-0">
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="truncate text-sm font-medium">{habit.name}</span>
                      <span className="meta num shrink-0">{habit.due === 0 ? 'rest days only' : `${habit.done} / ${habit.due}`}</span>
                    </div>
                    {habit.rate !== null && <div className="mt-1.5"><ProgressBar percent={habit.rate} tone={habit.rate >= 100 ? 'pos' : 'accent'} /></div>}
                  </div>
                  {data.kind === 'week' && <HabitWeekRow habit={habit} days={h.days} today={data.today} />}
                </div>
                <div className="meta mt-1 flex flex-wrap items-center justify-between gap-x-3">
                  <span>{habit.missed.length === 0 ? (habit.due > 0 ? 'Nothing missed' : '') : `Missed ${missedText(habit.missed)}`}</span>
                  {habit.streak > 0 && <span className="flex items-center gap-0.5" title="Current streak"><Flame size={12} className="warn" />{habit.streak}</span>}
                </div>
              </li>
            ))}
          </ul>
          {h.habits.length > MAX_HABITS && <div className="meta mt-2">+ {h.habits.length - MAX_HABITS} more</div>}
        </>
      )}
    </Panel>
  )
}

function MoodPanel({ data, onNavigate }: GoTo) {
  const m = data.mood
  const word = data.kind === 'week' ? 'week' : 'month'
  const diff = m.average !== null && m.previousAverage !== null ? round8(m.average - m.previousAverage) : null
  return (
    <Panel title="Mood" icon={<Smile size={15} />} link={{ label: 'Open logbook', onClick: () => onNavigate('logbook') }}>
      {m.logged === 0 ? (
        <EmptyState compact title="No moods logged" text="Pick a mood when you write a logbook entry and the trend shows here."
          action={<button className="btn-primary" onClick={() => onNavigate('logbook')}>Write an entry</button>} />
      ) : (
        <>
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <div>
              <div className="kpi-value">{(m.average as number).toFixed(1)}<span className="text-base font-medium text-muted"> / 5</span></div>
              <div className="meta">{MOOD_STYLE[wordNear(m.average as number)].label}, {m.logged} {m.logged === 1 ? 'entry' : 'entries'} on {m.days.filter((d) => d.average !== null).length} {m.days.filter((d) => d.average !== null).length === 1 ? 'day' : 'days'}</div>
            </div>
            {m.trend && (
              <span className="badge badge-muted">
                {m.trend === 'up' ? <TrendingUp size={13} /> : m.trend === 'down' ? <TrendingDown size={13} /> : null}
                {m.trend === 'up' ? 'Rising' : m.trend === 'down' ? 'Falling' : 'Steady'}
              </span>
            )}
          </div>
          <div className="mt-3"><MoodTrend days={m.days} kind={data.kind} today={data.today} /></div>
          {/* A comparison only when BOTH periods have logged moods; otherwise there is nothing to compare. */}
          {m.average !== null && m.previousAverage !== null && diff !== null && (
            <p className="meta mt-2">
              Previous {word}: {m.previousAverage.toFixed(1)} of 5
              {data.complete && (Math.abs(diff) < 0.05
                ? ' (about the same)'
                : ` (${diff > 0 ? '+' : ''}${diff.toFixed(1)} pts)`)}
            </p>
          )}
          {/* The five-point scale, always shown, with the count for each word. */}
          <div className="mt-1 flex flex-wrap items-center justify-between gap-2">
            <div className="legend">
              {MOODS.filter((x) => m.counts[x] > 0).map((x) => (
                <span key={x}><span className={`h-2 w-2 rounded-full ${MOOD_STYLE[x].dot}`} aria-hidden="true" />{MOOD_STYLE[x].label} <span className="num">{m.counts[x]}</span></span>
              ))}
            </div>
            <span className="meta">Scale 1 rough to 5 great</span>
          </div>
          {data.kind === 'week' && <div className="mt-3 border-t border-line pt-3"><MoodDays days={m.days} kind={data.kind} today={data.today} /></div>}
          {m.lowest && <p className="meta mt-2">Lowest: {formatDate(m.lowest.date)} ({moodStyle(m.lowest.mood).label}).</p>}
        </>
      )}
    </Panel>
  )
}

// ---------------------------------------------------------------------------------------------------------------
// Weekly insights: short, honest sentences from the same numbers above.

const TOPIC_ICON = { trades: CandlestickChart, savings: PiggyBank, habits: CalendarCheck, mood: Smile }

function WeeklyInsights({ data }: { data: ReviewData }) {
  const lines = weeklyInsights(data)
  const word = data.kind === 'week' ? 'week' : 'month'
  return (
    <section className="card card-pad mt-4" aria-label="Weekly insights">
      <div className="card-head">
        <h2 className="card-head-title"><span className="card-head-icon"><Sparkles size={15} /></span>This {word}</h2>
        <span className="meta">From your own records</span>
      </div>
      {lines.length === 0 ? (
        <p className="mt-3 text-sm text-muted">Not enough data yet for this {word}. Log a trade, a saving, a habit check-in or a mood and the summary appears here.</p>
      ) : (
        <ul className="mt-3 grid gap-3 sm:grid-cols-2">
          {lines.map((line) => {
            const Icon = TOPIC_ICON[line.topic]
            return (
              <li key={line.id} className="flex items-start gap-2.5 text-sm">
                <span className="card-head-icon mt-0.5"><Icon size={14} /></span>
                <span className="leading-relaxed">{line.text}</span>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}

// The page's own loading and failure states. They sit under the header, so the controls never jump.
function ReviewLoading() {
  return (
    <div aria-busy="true">
      <p role="status" className="sr-only">Loading review…</p>
      <div aria-hidden="true" className="animate-pulse">
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="card card-pad-sm h-36">
              <div className="h-3 w-24 rounded bg-fg/10" />
              <div className="mt-3 h-8 w-32 rounded bg-fg/10" />
              <div className="mt-2 h-3 w-20 rounded bg-fg/10" />
              <div className="mt-5 h-7 w-full rounded bg-fg/[0.06]" />
            </div>
          ))}
        </div>
        <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
          {[0, 1].map((i) => (
            <div key={i} className="card card-pad h-64">
              <div className="h-4 w-28 rounded bg-fg/10" />
              <div className="mt-5 h-24 w-full rounded bg-fg/[0.06]" />
              <div className="mt-4 h-3 w-3/4 rounded bg-fg/10" />
              <div className="mt-2 h-3 w-1/2 rounded bg-fg/10" />
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

function ReviewError({ message, onRetry, compact = false }: { message: string; onRetry: () => void; compact?: boolean }) {
  return (
    <div role="alert" className={compact ? 'card card-pad-sm mb-4 flex flex-wrap items-center gap-3' : 'card card-pad' }>
      <span className="empty-icon mt-0 shrink-0"><AlertCircle size={18} aria-hidden="true" /></span>
      <div className="min-w-0 flex-1">
        <p className="font-medium">Could not load this review</p>
        <p className="mt-1 break-words text-sm text-muted">{message}</p>
      </div>
      <button className="btn btn-sm" onClick={onRetry}>Try again</button>
    </div>
  )
}

// ---------------------------------------------------------------------------------------------------------------
// Shared little pieces

const cap = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1)
const pnlClass = (n: number): string => (n > 0 ? 'text-pos' : n < 0 ? 'text-neg' : 'text-muted')

// "Mon, Wed" or "Mon, Wed, Fri, Sat +2"
function missedText(dates: string[]): string {
  const shown = dates.slice(0, MAX_MISSED).map((d) => dates.length > 7 ? String(Number(d.slice(8))) : WEEKDAY_NAMES[weekdayOf(d)])
  return shown.join(', ') + (dates.length > MAX_MISSED ? ` +${dates.length - MAX_MISSED}` : '')
}

// A card with an icon tile, a title and one link on the right.
function Panel({ title, icon, link, children }: { title: string; icon: ReactNode; link: { label: string; onClick: () => void }; children: ReactNode }) {
  return (
    <section className="card card-pad h-full">
      <div className="card-head">
        <h2 className="card-head-title"><span className="card-head-icon">{icon}</span>{title}</h2>
        <button className="card-link" onClick={link.onClick}>{link.label} <span aria-hidden="true">›</span></button>
      </div>
      <div className="mt-3">{children}</div>
    </section>
  )
}

function Fact({ label, value }: { label: string; value: ReactNode }) {
  return <div><dt className="fact-label">{label}</dt><dd className="fact-value">{value}</dd></div>
}

function TradeLine({ label, trade, onClick }: { label: string; trade: NonNullable<ReviewData['trades']['best']>; onClick: () => void }) {
  return (
    <button className="row-link" onClick={onClick}>
      <span className="flex min-w-0 items-center gap-2 text-sm">
        <span className="meta w-10 shrink-0">{label}</span>
        <span className="truncate font-semibold">{trade.asset}</span>
        <span className={`badge capitalize ${trade.direction === 'long' ? 'badge-pos' : 'badge-neg'}`}>{trade.direction}</span>
        <span className="meta shrink-0">{formatDate(trade.date)}</span>
      </span>
      <span className="shrink-0 text-sm"><Pnl value={trade.pnl} /></span>
    </button>
  )
}

// ---------------------------------------------------------------------------------------------------------------
// The reflection: suggested questions, a text box, and a save that writes an ordinary logbook entry
// (tagged "review") so it shows up in the Logbook and in Search like any other entry.

// Kept as its own component so the page reads top to bottom: this draws the heading of the reflection section.
function Reflection({ data, onOpen }: Pick<ModuleProps, 'onOpen'> & { data: ReviewData }) {
  const saved = data.journal.reflection
  const word = data.kind === 'week' ? 'week' : 'month'
  return (
    <section className="card card-pad mt-4" aria-labelledby="reflection-title">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="reflection-title" className="card-head-title">
          <span className="card-head-icon"><BookOpen size={15} /></span> Reflection
          {saved && <span className="badge badge-pos ml-1">Saved</span>}
        </h2>
        {saved && <button className="card-link" onClick={() => onOpen({ module: 'logbook', entry: saved })}>Open in Logbook <span aria-hidden="true">›</span></button>}
      </div>
      <p className="page-sub mt-1">
        {saved ? `Your reflection for this ${word} is saved. Edit it here any time.` : `Take two minutes to write down how this ${word} went. Start from a question, or just write.`}
      </p>
    </section>
  )
}

// The reflection form: suggested questions, a text box, and a save that writes an ordinary logbook entry
// (tagged "review") so it shows up in the Logbook and in Search like any other entry. The behaviour is unchanged
// from earlier versions; only the layout moved under the section heading above.
function ReflectionForm({ data, onOpen }: { data: ReviewData; onOpen: ModuleProps['onOpen'] }) {
  const saved = data.journal.reflection
  const base: Draft = { body: saved?.body ?? '', mood: saved?.mood ?? null }
  const box = useDraft()
  const draft = box.draft // eslint-disable-line react-hooks/rules-of-hooks -- useDraft is called once, above
  const dirty = draft !== null && (draft.body !== base.body || draft.mood !== base.mood)
  const shown = draft ?? base
  const [saving, setSaving] = useState(false)
  const [note, setNote] = useState('')
  const [error, setError] = useState('')
  const area = useRef<HTMLTextAreaElement>(null)
  const word = data.kind === 'week' ? 'week' : 'month'
  const numbersAdded = shown.body.includes(`Numbers for ${data.label}`)

  const setBody = (body: string) => { setNote(''); box.set({ ...shown, body }) }
  const focusEnd = () => requestAnimationFrame(() => {
    const el = area.current
    if (!el) return
    el.focus()
    el.setSelectionRange(el.value.length, el.value.length)
    el.scrollTop = el.scrollHeight
  })
  // A question goes on its own line, with room below it to answer.
  const addPrompt = (text: string) => { setBody(`${shown.body.trimEnd()}${shown.body.trim() ? '\n\n' : ''}${text}\n`); focusEnd() }
  const addNumbers = () => setBody(`${summaryText(data)}\n\n${shown.body}`.trimEnd() + (shown.body.trim() ? '' : '\n\n'))

  const save = async () => {
    if (!shown.body.trim() || saving) return
    setSaving(true); setError(''); setNote('')
    try {
      if (saved) {
        await window.api.logbook.update(saved.id, { date: saved.date, title: saved.title, body: shown.body, mood: shown.mood, tags: saved.tags })
      } else {
        await window.api.logbook.create({
          date: data.complete ? data.end : data.today, // a finished period is dated its last day, a running one today
          title: data.title, body: shown.body, mood: shown.mood,
          tags: [REVIEW_TAG, data.kind === 'week' ? 'weekly' : 'monthly']
        })
      }
      box.reload() // reload first, so the saved text is already shown when the unsaved copy is dropped
      box.set(null)
      setNote('Saved to your logbook.')
    } catch (e) {
      setError(errMsg(e))
    }
    setSaving(false)
  }

  return (
    <div className="card card-pad">
      <div className="grid gap-5 lg:grid-cols-5">
        <div className="lg:col-span-2">
          <div className="subhead">Questions to start from</div>
          <ul className="mt-1.5 flex flex-col gap-0.5">
            {data.prompts.map((p) => (
              <li key={p.id}>
                <button className="row-link items-start text-left" onClick={() => addPrompt(p.text)} title="Add this question to your reflection">
                  <span className="text-sm leading-snug">{p.text}</span>
                  <Plus size={14} className="mt-0.5 shrink-0 text-muted" aria-hidden="true" />
                </button>
              </li>
            ))}
          </ul>

          {data.journal.entries.length > 0 && (
            <>
              <div className="subhead mt-4">
                Logbook this {word}: {data.journal.entries.length} {data.journal.entries.length === 1 ? 'entry' : 'entries'} on {data.journal.daysWritten} {data.journal.daysWritten === 1 ? 'day' : 'days'}
              </div>
              <ul className="mt-1.5 flex flex-col gap-0.5">
                {data.journal.entries.slice(0, 4).map((e) => (
                  <li key={e.id}>
                    <button className="row-link" onClick={() => onOpen({ module: 'logbook', entry: e })}>
                      <span className="flex min-w-0 items-center gap-2 text-sm">
                        {e.mood && <span title={moodStyle(e.mood).label} className={`h-2 w-2 shrink-0 rounded-full ${moodStyle(e.mood).dot}`} />}
                        <span className="truncate">{e.title}</span>
                      </span>
                      <span className="meta shrink-0">{formatDate(e.date)}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>

        <div className="flex flex-col gap-3 lg:col-span-3">
          <label className="flex flex-col text-xs text-muted">Your reflection
            <textarea ref={area} className="field mt-1 min-h-[12rem] resize-y leading-relaxed" value={shown.body}
              placeholder="What stood out? What will you keep, and what will you change?"
              onChange={(e) => setBody(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && e.ctrlKey) { e.preventDefault(); save() } }} />
          </label>

          <div>
            <div className="text-xs text-muted">How are you feeling about it? (optional)</div>
            <div className="mt-1 flex flex-wrap gap-2">
              {MOODS.map((m) => (
                <button key={m} aria-pressed={shown.mood === m} onClick={() => { setNote(''); box.set({ ...shown, mood: shown.mood === m ? null : m }) }}
                  className={`flex items-center gap-2 rounded-xl border px-3 py-1.5 text-sm transition-colors ${shown.mood === m ? 'border-accent bg-accent/15' : 'border-line text-muted hover:border-fg/25 hover:text-fg'}`}>
                  <span className={`h-2.5 w-2.5 rounded-full ${MOOD_STYLE[m].dot}`} />
                  {MOOD_STYLE[m].label}
                </button>
              ))}
            </div>
          </div>

          {error && <p role="alert" className="text-sm text-neg">{error}</p>}
          <div className="flex flex-wrap items-center gap-2">
            <button className="btn btn-sm" onClick={addNumbers} disabled={numbersAdded}
              title="Adds a few lines with this period's numbers, so the entry keeps them">
              {numbersAdded ? 'Numbers added' : 'Add the numbers'}
            </button>
            <span className="ml-auto text-xs text-muted" role="status">
              {dirty ? 'Unsaved changes' : note || 'Ctrl+Enter to save'}
            </span>
            <button className="btn-primary" onClick={save} aria-busy={saving} disabled={saving || !shown.body.trim() || (saved !== null && !dirty)}>
              {saved ? 'Update reflection' : 'Save reflection'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
