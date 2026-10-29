import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { BookOpen, CalendarCheck, CandlestickChart, ChevronLeft, ChevronRight, Flame, Lightbulb, PiggyBank, Plus, Smile, TrendingDown, TrendingUp } from 'lucide-react'
import { MOODS, type Mood, type ReviewData, type ReviewKind } from '../../../shared/types'
import { REVIEW_TAG, reviewRange, shiftRange, periodLabel, summaryText } from '../../../shared/review'
import { progressPercent } from '../../../shared/savings'
import { WEEKDAY_NAMES, weekdayOf } from '../../../shared/habits'
import { MOOD_STYLE, moodStyle } from '../lib/moods'
import { formatDate, today } from '../lib/dates'
import { fmtAmount, fmtPnl, pnlColor } from '../lib/format'
import { errMsg } from '../lib/errors'
import { useRefreshOnCapture } from '../lib/dataChanged'
import type { ModuleProps } from '../lib/navigation'
import { PageHeader } from '../components/PageHeader'
import { EmptyState } from '../components/EmptyState'
import { ProgressBar } from '../components/ProgressBar'
import { Pnl } from '../components/Pnl'
import { DayBars, HabitDays, MoodDays, moodNear } from '../components/ReviewViews'

const MAX_HABITS = 6 // habits listed in the card before "+N more"
const MAX_MISSED = 4 // missed days named under a habit before "+N"

export interface Draft { body: string; mood: Mood | null }

export function Review({ onOpen, onNavigate }: ModuleProps) {
  const [kind, setKind] = useState<ReviewKind>('week')
  const [anchor, setAnchor] = useState(today()) // any date inside the period being shown
  const [data, setData] = useState<ReviewData | null>(null)
  const [error, setError] = useState('')
  // Reflection text that is typed but not saved yet, per period, so stepping to another week and back loses nothing.
  const [drafts, setDrafts] = useState<Record<string, Draft>>({})
  const latest = useRef(0) // the newest request wins, so a slow answer for an old period cannot overwrite a newer one

  const load = useCallback(async () => {
    const request = ++latest.current
    try {
      const d = await window.api.review.build(kind, anchor, today())
      if (request === latest.current) { setData(d); setError('') }
    } catch (e) {
      if (request === latest.current) setError(errMsg(e))
    }
  }, [kind, anchor])
  useEffect(() => { load() }, [load])
  useRefreshOnCapture(load) // something was saved from the Quick capture window

  // Coming back to the window (maybe the next day) refreshes the numbers.
  useEffect(() => {
    window.addEventListener('focus', load)
    return () => window.removeEventListener('focus', load)
  }, [load])

  const now = today()
  const range = useMemo(() => reviewRange(kind, anchor), [kind, anchor])
  const word = kind === 'week' ? 'week' : 'month'
  const isCurrent = range.start <= now && now <= range.end
  const stale = !data || data.kind !== kind || data.start !== range.start // the answer for this period is still on its way
  const step = (delta: number) => setAnchor(shiftRange(kind, range, delta).start)

  const header = (
    <PageHeader title="Review" subtitle={
      <>
        {periodLabel(kind, range.start, range.end)}
        {range.end >= now && <span className="badge badge-open ml-2 align-middle">In progress</span>}
      </>
    }>
      <div className="seg" role="group" aria-label="Review period">
        <button aria-pressed={kind === 'week'} onClick={() => setKind('week')}>Week</button>
        <button aria-pressed={kind === 'month'} onClick={() => setKind('month')}>Month</button>
      </div>
      <div className="flex items-center">
        <button className="btn-icon" aria-label={`Previous ${word}`} title={`Previous ${word}`} onClick={() => step(-1)}><ChevronLeft size={18} /></button>
        <button className="btn-icon" aria-label={`Next ${word}`} title={`Next ${word}`} disabled={range.end >= now} onClick={() => step(1)}><ChevronRight size={18} /></button>
      </div>
      {!isCurrent && <button className="btn btn-sm" onClick={() => setAnchor(now)}>This {word}</button>}
    </PageHeader>
  )

  if (!data) {
    return (
      <div className="page page-lg" aria-busy={!error}>
        {header}
        {error && <p role="alert" className="text-sm text-neg">{error}</p>}
      </div>
    )
  }

  const draftKey = `${data.kind}:${data.start}`
  const setDraft = (d: Draft | null) => setDrafts((all) => {
    const next = { ...all }
    if (d) next[draftKey] = d
    else delete next[draftKey]
    return next
  })

  return (
    <div className="page page-lg" aria-busy={stale}>
      {header}
      {error && <p role="alert" className="mb-4 text-sm text-neg">{error}</p>}
      <div className={stale ? 'opacity-60 transition-opacity' : 'transition-opacity'}>
        <ReviewBody data={data} onOpen={onOpen} onNavigate={onNavigate}
          draft={drafts[draftKey] ?? null} onDraft={setDraft} onSaved={load} />
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------------------------------------------
// Everything below only needs the data, so it can be drawn (and tested) without the database.

type Nav = Pick<ModuleProps, 'onOpen' | 'onNavigate'>

export function ReviewBody({ data, onOpen, onNavigate, draft, onDraft, onSaved }: Nav & {
  data: ReviewData; draft: Draft | null; onDraft: (d: Draft | null) => void; onSaved: () => Promise<void> | void
}) {
  const { trades, savings, habits, mood, journal, insights } = data
  const word = data.kind === 'week' ? 'week' : 'month'
  const before = data.kind === 'week' ? 'last week' : 'last month'
  const ts = trades.stats

  const nothing = ts.total === 0 && savings.txCount === 0 && habits.due === 0 && habits.bonus === 0 && mood.logged === 0 && journal.entries.length === 0

  // The "against the period before" line. While the period is still running the earlier one is shown as plain context,
  // because a half week set against a whole week would look like a drop that is not one.
  // `show` writes a figure ("+12.00"); `gap` writes the size of a difference ("12.00"), which carries no sign of its own.
  const versus = (now: number | null, prev: number | null, show: (n: number) => string, gap: (n: number) => string = show): ReactNode => {
    if (prev === null) return null
    if (!data.complete || now === null) return `${cap(before)}: ${show(prev)}`
    const diff = now - prev
    if (Math.abs(diff) < 1e-9) return `Same as ${before}`
    return `${diff > 0 ? 'Up' : 'Down'} ${gap(Math.abs(diff))} on ${before}`
  }

  const tile = (label: string, value: string, sub: string, extra: ReactNode, to: string, color = '') => (
    <button className="stat card card-pad-sm card-interactive" onClick={() => onNavigate(to)} aria-label={`${label}: ${value}. ${sub}. Open ${to}`}>
      <div className="stat-label">{label}</div>
      <div className={`stat-value ${color}`}>{value}</div>
      <div className="stat-sub">{sub}</div>
      <div className="stat-sub min-h-[1rem]">{extra}</div>
    </button>
  )

  return (
    <>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {tile('Trading P&L', ts.closed === 0 ? '-' : fmtPnl(ts.totalPnl),
          ts.closed === 0 ? (ts.open > 0 ? `${ts.open} open, none closed` : 'No closed trades')
            : `${ts.closed} closed, ${ts.winRate === null ? 0 : Math.round(ts.winRate)}% wins`,
          versus(ts.closed === 0 ? null : ts.totalPnl, trades.previous.closed === 0 ? null : trades.previous.totalPnl, fmtPnl, fmtAmount),
          'trades', ts.closed === 0 ? '' : pnlColor(ts.totalPnl))}
        {tile('Savings movement', savings.txCount === 0 ? '-' : fmtPnl(savings.net),
          `Balance ${fmtAmount(savings.endBalance)}`,
          versus(savings.txCount === 0 ? null : savings.net, savings.previousNet === 0 ? null : savings.previousNet, fmtPnl, fmtAmount),
          'savings', savings.txCount === 0 ? '' : pnlColor(savings.net))}
        {tile('Habit consistency', habits.rate === null ? '-' : `${Math.round(habits.rate)}%`,
          habits.rate === null ? 'Nothing scheduled yet' : `${habits.done} of ${habits.due} days done`,
          versusRate(data), 'habits')}
        {tile('Mood', mood.average === null ? '-' : `${mood.average.toFixed(1)} / 5`,
          mood.average === null ? 'No moods logged' : `${MOOD_STYLE[moodNear(mood.average)].label}, ${mood.logged} ${mood.logged === 1 ? 'entry' : 'entries'}`,
          versus(mood.average, mood.previousAverage, (n) => n.toFixed(1)), 'logbook')}
      </div>

      {nothing && (
        <div className="mt-4">
          <EmptyState icon={BookOpen} title={`Nothing to review for this ${word} yet`}
            text="Log a trade, a saving, a habit check-in or a mood and it shows up here. You can still write a reflection below."
            action={<button className="btn-primary" onClick={() => onNavigate('logbook')}>Open logbook</button>} />
        </div>
      )}

      {!nothing && (
        <div className="mt-4 grid gap-4 lg:grid-cols-2">
          <Section title="Trading" icon={<CandlestickChart size={15} />} onOpen={() => onNavigate('trades')} openLabel="Open trades">
            {ts.total === 0 ? (
              <EmptyState compact title={`No trades this ${word}`} text="Trades count on the day they were entered."
                action={<button className="btn-primary" onClick={() => onNavigate('trades')}>Log a trade</button>} />
            ) : (
              <>
                <dl className="grid grid-cols-3 gap-x-4 gap-y-3 text-sm">
                  <Fact label="Closed" value={`${ts.closed}${ts.open > 0 ? ` (+${ts.open} open)` : ''}`} />
                  <Fact label="Win rate" value={ts.winRate === null ? '-' : `${Math.round(ts.winRate)}%`} />
                  <Fact label="Fees" value={fmtAmount(ts.totalFees)} />
                </dl>
                {ts.closed > 0 && <div className="mt-3"><DayBars days={trades.days} kind={data.kind} today={data.today} /></div>}
                {(trades.best || trades.worst) && (
                  <div className="mt-2 flex flex-col gap-0.5">
                    {trades.best && <TradeLine label="Best" trade={trades.best} onClick={() => onOpen({ module: 'trades', trade: trades.best! })} />}
                    {trades.worst && <TradeLine label="Worst" trade={trades.worst} onClick={() => onOpen({ module: 'trades', trade: trades.worst! })} />}
                  </div>
                )}
              </>
            )}
          </Section>

          <Section title="Savings" icon={<PiggyBank size={15} />} onOpen={() => onNavigate('savings')} openLabel="Open savings">
            {savings.txCount === 0 ? (
              <EmptyState compact title={`No deposits or withdrawals this ${word}`} text={`Total balance is still ${fmtAmount(savings.endBalance)}.`}
                action={<button className="btn-primary" onClick={() => onNavigate('savings')}>Open savings</button>} />
            ) : (
              <>
                <dl className="grid grid-cols-3 gap-x-4 gap-y-3 text-sm">
                  <Fact label="Deposited" value={fmtAmount(savings.deposits)} />
                  <Fact label="Withdrawn" value={fmtAmount(savings.withdrawals)} />
                  <Fact label="Net" value={<Pnl value={savings.net} />} />
                </dl>
                <p className="meta mt-2">Total balance {fmtAmount(savings.startBalance)} to {fmtAmount(savings.endBalance)}.</p>
                <ul className="mt-2 flex flex-col gap-0.5">
                  {savings.goals.map((g) => {
                    const pct = progressPercent(g.endBalance, g.target)
                    return (
                      <li key={g.goalId}>
                        <button className="row-link" onClick={() => onOpen({ module: 'savings', goalId: g.goalId })}>
                          <div className="min-w-0 flex-1">
                            <div className="flex items-baseline justify-between gap-3">
                              <span className="flex min-w-0 items-center gap-2">
                                <span className="truncate text-sm font-medium">{g.name}</span>
                                {g.reached && <span className="badge badge-pos">Goal reached</span>}
                              </span>
                              <span className="shrink-0 text-sm"><Pnl value={g.net} /></span>
                            </div>
                            {pct !== null && <div className="mt-1.5"><ProgressBar percent={pct} /></div>}
                            <div className="meta mt-1 flex justify-between">
                              <span>Balance {fmtAmount(g.endBalance)}</span>
                              {g.target !== null && pct !== null && <span>{Math.floor(pct)}% of {fmtAmount(g.target)}</span>}
                            </div>
                          </div>
                        </button>
                      </li>
                    )
                  })}
                </ul>
              </>
            )}
          </Section>

          <Section title="Habits" icon={<CalendarCheck size={15} />} onOpen={() => onNavigate('habits')} openLabel="Open habits">
            {habits.habits.length === 0 ? (
              <EmptyState compact title={`No habit days to count this ${word}`} text="Add a habit and check it off day by day."
                action={<button className="btn-primary" onClick={() => onNavigate('habits')}>Open habits</button>} />
            ) : (
              <>
                <div className="flex items-baseline justify-between gap-3">
                  <div className="stat-value mt-0">{habits.rate === null ? '-' : `${Math.round(habits.rate)}%`}</div>
                  <div className="meta text-right">
                    {habits.done} of {habits.due} scheduled days
                    {habits.bonus > 0 && <>, plus {habits.bonus} on rest {habits.bonus === 1 ? 'day' : 'days'}</>}
                  </div>
                </div>
                <div className="mt-3"><HabitDays days={habits.days} kind={data.kind} today={data.today} /></div>
                <ul className="mt-3 flex flex-col gap-0.5">
                  {habits.habits.slice(0, MAX_HABITS).map((h) => (
                    <li key={h.id}>
                      <button className="row-link" onClick={() => onNavigate('habits')}>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-baseline justify-between gap-3">
                            <span className="truncate text-sm font-medium">{h.name}</span>
                            <span className="meta num shrink-0">{h.due === 0 ? 'rest days only' : `${h.done} / ${h.due}`}</span>
                          </div>
                          {h.rate !== null && <div className="mt-1.5"><ProgressBar percent={h.rate} /></div>}
                          <div className="meta mt-1 flex flex-wrap items-center justify-between gap-x-3">
                            <span>{h.missed.length === 0 ? (h.due > 0 ? 'Nothing missed' : '') : `Missed ${missedText(h.missed)}`}</span>
                            {h.streak > 0 && <span className="flex items-center gap-0.5" title="Current streak"><Flame size={12} className="warn" />{h.streak}</span>}
                          </div>
                        </div>
                      </button>
                    </li>
                  ))}
                </ul>
                {habits.habits.length > MAX_HABITS && <div className="meta mt-1">+ {habits.habits.length - MAX_HABITS} more</div>}
              </>
            )}
          </Section>

          <Section title="Mood" icon={<Smile size={15} />} onOpen={() => onNavigate('logbook')} openLabel="Open logbook">
            {mood.logged === 0 ? (
              <EmptyState compact title={`No moods logged this ${word}`} text="Pick a mood when you write a logbook entry and the trend shows here."
                action={<button className="btn-primary" onClick={() => onNavigate('logbook')}>Write an entry</button>} />
            ) : (
              <>
                <div className="flex items-baseline justify-between gap-3">
                  <div className="stat-value mt-0">{(mood.average as number).toFixed(1)}<span className="text-muted"> / 5</span></div>
                  {mood.trend && (
                    <span className="badge badge-muted">
                      {mood.trend === 'up' ? <TrendingUp size={13} /> : mood.trend === 'down' ? <TrendingDown size={13} /> : null}
                      {mood.trend === 'up' ? 'Rising' : mood.trend === 'down' ? 'Falling' : 'Steady'}
                    </span>
                  )}
                </div>
                <div className="mt-3"><MoodDays days={mood.days} kind={data.kind} today={data.today} /></div>
                <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-sm">
                  {MOODS.filter((m) => mood.counts[m] > 0).map((m) => (
                    <li key={m} className="flex items-center gap-1.5">
                      <span className={`h-2.5 w-2.5 rounded-full ${MOOD_STYLE[m].dot}`} aria-hidden="true" />
                      {MOOD_STYLE[m].label} <span className="num text-muted">{mood.counts[m]}</span>
                    </li>
                  ))}
                </ul>
                {mood.lowest && <p className="meta mt-2">Lowest: {formatDate(mood.lowest.date)} ({moodStyle(mood.lowest.mood).label}).</p>}
              </>
            )}
          </Section>
        </div>
      )}

      {insights.length > 0 && (
        <section className="card card-pad mt-4">
          <h2 className="section-title"><Lightbulb size={15} /> Across your tools</h2>
          <ul className="mt-3 flex flex-col gap-2 text-sm">
            {insights.map((i) => <li key={i.id}>{i.text}</li>)}
          </ul>
          <p className="meta mt-3">These put the numbers side by side. They do not show that one causes the other.</p>
        </section>
      )}

      <Reflection key={`${data.kind}:${data.start}`} data={data} draft={draft} onDraft={onDraft} onSaved={onSaved} onOpen={onOpen} />

      <p className="meta mt-4">
        Trades count on their entry date, like the P&L curve on the dashboard. Habits count scheduled days that have passed;
        today only counts once it is checked off.
      </p>
    </>
  )
}

// "Last week" -> "Last week" (first letter up)
const cap = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1)

// Habit consistency is a percentage, so the comparison is in points rather than a plain subtraction of money.
function versusRate(d: ReviewData): ReactNode {
  const prev = d.habits.previousRate
  if (prev === null) return null
  const word = d.kind === 'week' ? 'last week' : 'last month'
  if (!d.complete || d.habits.rate === null) return `${cap(word)}: ${Math.round(prev)}%`
  const diff = Math.round(d.habits.rate) - Math.round(prev)
  return diff === 0 ? `Same as ${word}` : `${diff > 0 ? 'Up' : 'Down'} ${Math.abs(diff)} ${Math.abs(diff) === 1 ? 'point' : 'points'} on ${word}`
}

// "Mon, Wed" or "Mon, Wed, Fri, Sat +2"
function missedText(dates: string[]): string {
  const shown = dates.slice(0, MAX_MISSED).map((d) => dates.length > 7 ? String(Number(d.slice(8))) : WEEKDAY_NAMES[weekdayOf(d)])
  return shown.join(', ') + (dates.length > MAX_MISSED ? ` +${dates.length - MAX_MISSED}` : '')
}

function Section({ title, icon, onOpen, openLabel, children }: { title: string; icon: ReactNode; onOpen: () => void; openLabel: string; children: ReactNode }) {
  return (
    <section className="card card-pad h-full">
      <div className="flex items-center justify-between">
        <h2 className="section-title">{icon} {title}</h2>
        <button className="section-link" onClick={onOpen}>{openLabel} <ChevronRight size={12} /></button>
      </div>
      <div className="mt-3">{children}</div>
    </section>
  )
}

function Fact({ label, value }: { label: string; value: ReactNode }) {
  return <div><dt className="meta">{label}</dt><dd className="num mt-0.5 font-medium">{value}</dd></div>
}

function TradeLine({ label, trade, onClick }: { label: string; trade: NonNullable<ReviewData['trades']['best']>; onClick: () => void }) {
  return (
    <button className="row-link" onClick={onClick}>
      <span className="flex min-w-0 items-center gap-2 text-sm">
        <span className="meta w-10 shrink-0">{label}</span>
        <span className="truncate font-medium">{trade.asset}</span>
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

function Reflection({ data, draft, onDraft, onSaved, onOpen }: Pick<ModuleProps, 'onOpen'> & {
  data: ReviewData; draft: Draft | null; onDraft: (d: Draft | null) => void; onSaved: () => Promise<void> | void
}) {
  const saved = data.journal.reflection
  const base: Draft = { body: saved?.body ?? '', mood: saved?.mood ?? null }
  const value = draft ?? base
  const dirty = draft !== null && (draft.body !== base.body || draft.mood !== base.mood)
  const [saving, setSaving] = useState(false)
  const [note, setNote] = useState('')
  const [error, setError] = useState('')
  const box = useRef<HTMLTextAreaElement>(null)
  const word = data.kind === 'week' ? 'week' : 'month'
  const numbersAdded = value.body.includes(`Numbers for ${data.label}`)

  const setBody = (body: string) => { setNote(''); onDraft({ ...value, body }) }
  const focusEnd = () => requestAnimationFrame(() => {
    const el = box.current
    if (!el) return
    el.focus()
    el.setSelectionRange(el.value.length, el.value.length)
    el.scrollTop = el.scrollHeight
  })
  // A question goes on its own line, with room below it to answer.
  const addPrompt = (text: string) => { setBody(`${value.body.trimEnd()}${value.body.trim() ? '\n\n' : ''}${text}\n`); focusEnd() }
  const addNumbers = () => setBody(`${summaryText(data)}\n\n${value.body}`.trimEnd() + (value.body.trim() ? '' : '\n\n'))

  const save = async () => {
    if (!value.body.trim() || saving) return
    setSaving(true); setError(''); setNote('')
    try {
      if (saved) {
        await window.api.logbook.update(saved.id, { date: saved.date, title: saved.title, body: value.body, mood: value.mood, tags: saved.tags })
      } else {
        await window.api.logbook.create({
          date: data.complete ? data.end : data.today, // a finished period is dated its last day, a running one today
          title: data.title, body: value.body, mood: value.mood,
          tags: [REVIEW_TAG, data.kind === 'week' ? 'weekly' : 'monthly']
        })
      }
      await onSaved() // reload first, so the saved text is already shown when the unsaved copy is dropped
      onDraft(null)
      setNote('Saved to your logbook.')
    } catch (e) {
      setError(errMsg(e))
    }
    setSaving(false)
  }

  return (
    <section className="card card-pad mt-4" aria-labelledby="reflection-title">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="reflection-title" className="section-title">
          <BookOpen size={15} /> Reflection
          {saved && <span className="badge badge-pos ml-1">Saved</span>}
        </h2>
        {saved && <button className="section-link" onClick={() => onOpen({ module: 'logbook', entry: saved })}>Open in Logbook <ChevronRight size={12} /></button>}
      </div>
      <p className="page-sub mt-1">
        {saved ? `Your reflection for this ${word} is saved. Edit it here any time.` : `Take two minutes to write down how this ${word} went. Start from a question, or just write.`}
      </p>

      <div className="mt-4 grid gap-5 lg:grid-cols-5">
        <div className="lg:col-span-2">
          <div className="meta font-medium">Questions to start from</div>
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
              <div className="meta mt-4 font-medium">
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
            <textarea ref={box} className="field mt-1 min-h-[12rem] resize-y leading-relaxed" value={value.body}
              placeholder="What stood out? What will you keep, and what will you change?"
              onChange={(e) => setBody(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && e.ctrlKey) { e.preventDefault(); save() } }} />
          </label>

          <div>
            <div className="text-xs text-muted">How are you feeling about it? (optional)</div>
            <div className="mt-1 flex flex-wrap gap-2">
              {MOODS.map((m) => (
                <button key={m} aria-pressed={value.mood === m} onClick={() => { setNote(''); onDraft({ ...value, mood: value.mood === m ? null : m }) }}
                  className={`flex items-center gap-2 rounded-xl border px-3 py-1.5 text-sm ${value.mood === m ? 'border-accent bg-accent/15' : 'border-line text-muted hover:text-fg'}`}>
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
            <button className="btn-primary" onClick={save} aria-busy={saving} disabled={saving || !value.body.trim() || (saved !== null && !dirty)}>
              {saved ? 'Update reflection' : 'Save reflection'}
            </button>
          </div>
        </div>
      </div>
    </section>
  )
}
