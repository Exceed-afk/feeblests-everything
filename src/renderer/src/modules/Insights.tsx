// The Insights page: pattern cards across tools, simple statistics only.
// Every card carries the numbers behind its sentence (and the sample size) —
// nothing claims causation, and a dismissal is remembered.
import { useCallback, useEffect, useState } from 'react'
import { BarChart3, Lightbulb, X } from 'lucide-react'
import type { InsightsPayload } from '../../../shared/types'
import { MIN_DAYS } from '../../../shared/insights'
import { MOOD_STYLE } from '../lib/moods'
import { today } from '../lib/dates'
import { fmtAmount, fmtPnl } from '../lib/format'
import { errMsg } from '../lib/errors'
import { PageHeader } from '../components/PageHeader'
import { Sparkline } from '../components/InsightCharts'

export function Insights() {
  const [data, setData] = useState<InsightsPayload | null>(null)
  const [error, setError] = useState('')

  const load = useCallback(() => {
    window.api.intelligence.insights.build(today()).then(setData).catch((e) => setError(errMsg(e)))
  }, [])
  useEffect(() => { load() }, [load])

  const dismiss = async (id: string, dismissed: boolean, mode: 'snooze' | 'hide' | 'restore' = 'hide'): Promise<void> => {
    await window.api.intelligence.insights.dismiss(id, dismissed, mode, today())
    load()
  }

  return (
    <div className="page page-sm">
      <PageHeader title="Insights" subtitle="Patterns across your tools, from simple averages and correlations. Descriptive, never causal.">
        <Lightbulb size={20} className="text-accent" />
      </PageHeader>
      {error && <p role="alert" className="text-sm text-neg">{error}</p>}

      {data && (
        <div className="mt-5 flex flex-col gap-4">
          {!data.enoughData && (
            <section className="card card-pad" aria-live="polite">
              <h2 className="section-title">Not enough history yet</h2>
              <p className="mt-2 text-sm leading-relaxed">{data.needText}</p>
              <p className="meta mt-2">
                Comparisons also need at least {MIN_DAYS} days on each side before a sentence is shown.
              </p>
            </section>
          )}

          {data.comparisons.filter((c) => c.ok && !data.dismissed.some((d) => d.id === c.id)).map((c) => (
            <Card key={c.id} id={c.id} text={c.text} detail={c.detail} onDismiss={dismiss} snoozeWeeks={data.snoozeWeeks}
              aLabel="Higher side" bLabel="Lower side" a={c.a} b={c.b} />
          ))}
          {data.correlations.filter((c) => c.ok && !data.dismissed.some((d) => d.id === c.id)).map((c) => (
            <Card key={c.id} id={c.id} text={c.text} detail={c.detail} onDismiss={dismiss} snoozeWeeks={data.snoozeWeeks} />
          ))}

          <WeekdayTables insights={data} />
          <HonestyFooter />
        </div>
      )}
    </div>
  )
}

// A two-group bar pair drawn with plain CSS widths (no chart library).
function GroupBars({ a, b, aLabel, bLabel, format }: {
  a: { n: number; average: number | null }
  b: { n: number; average: number | null }
  aLabel: string
  bLabel: string
  format: (n: number) => string
}) {
  const max = Math.max(Math.abs(a.average ?? 0), Math.abs(b.average ?? 0), 1)
  const bar = (v: number | null): React.ReactNode => (
    <div className="h-2.5 w-full overflow-hidden rounded bg-muted/30">
      {v !== null && <div className="h-full rounded bg-accent" style={{ width: `${Math.max(3, (Math.abs(v) / max) * 100)}%` }} />}
    </div>
  )
  return (
    <div className="mt-3 flex flex-col gap-2 text-xs" role="img"
      aria-label={`${aLabel}: ${a.average === null ? 'no data' : format(a.average)} over ${a.n} days. ${bLabel}: ${b.average === null ? 'no data' : format(b.average)} over ${b.n} days.`}>
      <div className="flex items-center gap-2">
        <span className="meta w-24 shrink-0">{aLabel} ({a.n}d)</span>
        <div className="min-w-0 flex-1">{bar(a.average)}</div>
        <span className="num w-16 shrink-0 text-right">{a.average === null ? '-' : format(a.average)}</span>
      </div>
      <div className="flex items-center gap-2">
        <span className="meta w-24 shrink-0">{bLabel} ({b.n}d)</span>
        <div className="min-w-0 flex-1">{bar(b.average)}</div>
        <span className="num w-16 shrink-0 text-right">{b.average === null ? '-' : format(b.average)}</span>
      </div>
    </div>
  )
}

function Card({ id, text, detail, onDismiss, snoozeWeeks, aLabel, bLabel, a, b }: {
  id: string
  text: string
  detail: string
  onDismiss: (id: string, dismissed: boolean, mode?: 'snooze' | 'hide' | 'restore') => Promise<void>
  snoozeWeeks: number
  aLabel?: string
  bLabel?: string
  a?: { n: number; average: number | null }
  b?: { n: number; average: number | null }
}) {
  const [gone, setGone] = useState(false)
  if (gone) return null
  return (
    <section className="card card-pad" aria-label={text}>
      <div className="flex items-start justify-between gap-3">
        <h2 className="section-title"><Lightbulb size={15} /> Insight</h2>
        <div className="flex items-center gap-1">
          <button className="btn btn-sm" title={`Bring it back in ${snoozeWeeks} weeks`}
            onClick={() => { setGone(true); void onDismiss(id, true, 'snooze') }}>
            Snooze {snoozeWeeks} weeks
          </button>
          <button className="btn-icon hover:text-neg" aria-label="Hide this insight until restored"
            onClick={() => { setGone(true); void onDismiss(id, true, 'hide') }}>
            <X size={15} />
          </button>
        </div>
      </div>
      <p className="mt-2 text-sm leading-relaxed">{text}</p>
      {a && b && aLabel && bLabel && <GroupBars a={a} b={b} aLabel={aLabel} bLabel={bLabel} format={fmtAmount} />}
      <p className="meta mt-2">{detail}</p>
    </section>
  )
}

// I5: the honesty footer. Descriptive wording, never causal — the sentence
// keeps the reader, not the app, in charge of the conclusion.
function HonestyFooter(): React.ReactNode {
  return (
    <p className="meta mt-2">
      Several comparisons are checked at once, so some patterns will be chance.
      Treat these as questions to explore, not conclusions.
    </p>
  )
}

// The three honest tables behind the headline insights: rates per weekday, P&L per weekday, P&L per mood.
function WeekdayTables({ insights }: { insights: InsightsPayload }) {
  const hb = insights.habitByWeekday
  const tb = insights.tradeByWeekday
  const mb = insights.tradeByMood
  if (hb.length === 0 && tb.length === 0 && mb.length === 0) return null
  return (
    <section className="card card-pad" aria-label="The numbers behind the insights">
      <h2 className="section-title"><BarChart3 size={15} /> The numbers behind them</h2>
      {hb.length > 0 && (
        <>
          {/* I2: the same rate series as the table, drawn as a plain SVG line. */}
          <Sparkline ariaLabel={`Habit completion rate by weekday, from ${Math.round(Math.min(...hb.map((r) => r.rate ?? 0)))}% to ${Math.round(Math.max(...hb.map((r) => r.rate ?? 0)))}%.`}
            values={hb.map((r) => r.rate ?? 0)} className="text-accent mt-3" />
          <table className="tbl mt-3">
          <caption className="sr-only">Habit completion rate by weekday</caption>
          <thead><tr><th scope="col">Weekday</th><th scope="col">Scheduled</th><th scope="col">Done</th><th scope="col">Rate</th></tr></thead>
          <tbody>
            {hb.map((w) => (
              <tr key={w.weekday}>
                <th scope="row">{w.weekday}</th><td className="num">{w.scheduled}</td><td className="num">{w.done}</td>
                <td className="num">{w.rate === null ? '-' : `${Math.round(w.rate)}%`}</td>
              </tr>
            ))}
          </tbody>
        </table>
        </>
      )}
      {tb.length > 0 && (
        <>
          <Sparkline ariaLabel={`Closed-trade P&L by weekday, from ${fmtPnl(Math.min(...tb.map((r) => r.pnl)))} to ${fmtPnl(Math.max(...tb.map((r) => r.pnl)))}.`}
            values={tb.map((r) => r.pnl)} className={Math.max(...tb.map((r) => r.pnl)) >= 0 ? 'text-pos mt-4' : 'text-neg mt-4'} />
          <table className="tbl mt-3">
          <caption className="sr-only">Closed-trade P&L by weekday</caption>
          <thead><tr><th scope="col">Weekday</th><th scope="col">Closed</th><th scope="col">P&L</th></tr></thead>
          <tbody>
            {tb.map((w) => (
              <tr key={w.weekday}><th scope="row">{w.weekday}</th><td className="num">{w.closed}</td><td className="num">{fmtPnl(w.pnl)}</td></tr>
            ))}
          </tbody>
        </table>
        </>
      )}
      {mb.length > 0 && (
        <>
          <Sparkline ariaLabel={`Closed-trade average P&L by the day's mood, from ${fmtPnl(Math.min(...mb.map((m) => m.avgPnl ?? 0)))} to ${fmtPnl(Math.max(...mb.map((m) => m.avgPnl ?? 0)))}.`}
            values={mb.map((m) => m.avgPnl ?? 0)} className="text-accent mt-4" />
          <table className="tbl mt-3">
          <caption className="sr-only">Closed-trade P&L by the day's mood</caption>
          <thead><tr><th scope="col">Mood</th><th scope="col">Days</th><th scope="col">Average P&L</th></tr></thead>
          <tbody>
            {mb.map((m) => (
              <tr key={m.mood}>
                <th scope="row"><span className={`mr-1.5 inline-block h-2.5 w-2.5 rounded-full ${MOOD_STYLE[m.mood].dot}`} aria-hidden="true" />{MOOD_STYLE[m.mood].label}</th>
                <td className="num">{m.days}</td>
                <td className="num">{m.avgPnl === null ? '-' : fmtPnl(m.avgPnl)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        </>
      )}
      <p className="meta mt-3">Weekdays are Monday to Sunday. Only scheduled days count for habit rates; only closed trades count for P&L.</p>
    </section>
  )
}
