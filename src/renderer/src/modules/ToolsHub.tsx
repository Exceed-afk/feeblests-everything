// Tools hub (Phase 5). One page, one tab per tool:
//   Loan · Stopwatch · Scratchpad · Snippets
//
// Everything works offline. Math lives in src/shared/tools-math.ts (unit
// tested); this file is the UI only. Copy actions go through Electron's
// clipboard via window.api.tools.copyText, never the network.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Calculator, Check, ClipboardCopy, Copy, Clock, FileText, Pin, PinOff,
  Plus, Scissors, Square, Timer, Trash2
} from 'lucide-react'
import type { ModuleProps } from '../lib/navigation'
import type { SnippetDTO, ScratchpadDTO } from '../../../shared/toolsData'
import {
  addDateAmount, calculateLoan, calculatePercent, daysBetween, monthsToTarget,
  monthlyPayment, splitBill, type DateUnit, type PercentMode
} from '../../../shared/tools-math'
import { PageHeader } from '../components/PageHeader'
import { EmptyState } from '../components/EmptyState'
import { Dialog, Field, FormMessage } from '../components/EditorBits'
import { TagInput } from '../components/TagInput'
import { fmtAmount } from '../lib/format'
import { errMsg } from '../lib/errors'
import { today, formatDate } from '../lib/dates'
import { useSettings, updateSettings } from '../lib/settingsStore'
import { useRefreshOnCapture } from '../lib/dataChanged'

type ToolTab = 'loan' | 'stopwatch' | 'scratchpad' | 'snippets'

const TABS: { id: ToolTab; label: string; icon: typeof Calculator }[] = [
  { id: 'loan', label: 'Loan', icon: Calculator },
  { id: 'stopwatch', label: 'Stopwatch', icon: Clock },
  { id: 'scratchpad', label: 'Scratchpad', icon: FileText },
  { id: 'snippets', label: 'Snippets', icon: Scissors }
]

// Money input is typed in major units and converted to integer cents once.
const cents = (text: string): number | null => {
  const clean = text.replace(/,/g, '').trim()
  if (!/^\d+(\.\d{0,2})?$/.test(clean)) return null
  return Math.round(Number(clean) * 100)
}

async function copyToClipboard(text: string): Promise<boolean> {
  try {
    await window.api.tools.copyText(text)
    return true
  } catch {
    return false
  }
}

export function Tools(_props: ModuleProps) {
  const [tab, setTab] = useState<ToolTab>('loan')
  const settings = useSettings()
  const pinned = settings.pinnedTools ?? []
  const hubPinned = pinned.filter((id) => id.startsWith('tools:'))

  // Tab strip order: pinned tools first, in pin order (the plan's "pin
  // favourites to the top"), then the rest.
  const ordered = useMemo(() => {
    const pinnedTabs = hubPinned
      .map((id) => TABS.find((t) => `tools:${t.id}` === id))
      .filter((t): t is (typeof TABS)[number] => Boolean(t))
    return [...pinnedTabs, ...TABS.filter((t) => !pinnedTabs.includes(t))]
  }, [hubPinned])

  const togglePin = (id: ToolTab) => {
    const key = `tools:${id}`
    const next = hubPinned.includes(key) ? pinned.filter((p) => p !== key) : [key, ...pinned]
    updateSettings({ pinnedTools: next })
  }

  const onTabKey = (e: React.KeyboardEvent, index: number) => {
    const last = ordered.length - 1
    let next: number | null = null
    if (e.key === 'ArrowRight') next = index === last ? 0 : index + 1
    else if (e.key === 'ArrowLeft') next = index === 0 ? last : index - 1
    else if (e.key === 'Home') next = 0
    else if (e.key === 'End') next = last
    if (next === null) return
    e.preventDefault()
    setTab(ordered[next].id)
    const el = document.getElementById(`tools-tab-${ordered[next].id}`)
    el?.focus()
  }

  return (
    <div className="page">
      <PageHeader title="Tools" subtitle="Small offline tools that work while everything else is closed." />

      <div className="seg mb-5" role="tablist" aria-label="Tools">
        {ordered.map((t, i) => {
          const Icon = t.icon
          const isPinned = hubPinned.includes(`tools:${t.id}`)
          return (
            <button
              key={t.id}
              id={`tools-tab-${t.id}`}
              role="tab"
              aria-selected={tab === t.id}
              aria-controls={`tools-panel-${t.id}`}
              tabIndex={tab === t.id ? 0 : -1}
              onClick={() => setTab(t.id)}
              onKeyDown={(e) => onTabKey(e, i)}
              className="inline-flex items-center gap-1.5"
            >
              <Icon size={14} aria-hidden="true" />
              {t.label}
              {isPinned && <Pin size={10} className="text-accent" aria-label="Pinned" />}
            </button>
          )
        })}
      </div>

      <div className="mb-4 flex items-center gap-2">
        <button className="btn btn-sm" onClick={() => togglePin(tab)} aria-pressed={hubPinned.includes(`tools:${tab}`)}>
          {hubPinned.includes(`tools:${tab}`) ? <PinOff size={13} aria-hidden="true" /> : <Pin size={13} aria-hidden="true" />}
          {hubPinned.includes(`tools:${tab}`) ? 'Unpin this tool' : 'Pin this tool'}
        </button>
        <span className="meta">Pinned tools sit first in the strip.</span>
      </div>

      <div role="tabpanel" id={`tools-panel-${tab}`} aria-labelledby={`tools-tab-${tab}`}>
        {tab === 'loan' && <LoanTool />}
        {tab === 'stopwatch' && <StopwatchTool />}
        {tab === 'scratchpad' && <ScratchpadTool />}
        {tab === 'snippets' && <SnippetsTool />}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Loan calculator (+ percentage, bill split and dates live underneath it so
// the hub stays four tabs rather than seven)
// ---------------------------------------------------------------------------

function LoanTool() {
  const [principal, setPrincipal] = useState('200000')
  const [rate, setRate] = useState('6')
  const [years, setYears] = useState('30')
  const [extra, setExtra] = useState('0')
  const [startDate, setStartDate] = useState('')
  const [error, setError] = useState('')
  const [copied, setCopied] = useState(false)

  const result = useMemo(() => {
    const p = cents(principal)
    const r = Number(rate)
    const y = Number(years)
    const e = cents(extra)
    if (p === null || p <= 0) return { error: 'Enter a principal above 0.' }
    if (!Number.isFinite(r) || r < 0) return { error: 'Enter an interest rate of 0 or more.' }
    if (!Number.isFinite(y) || y <= 0) return { error: 'Enter a term above 0 years.' }
    if (e === null) return { error: 'The extra payment must be 0.00 or more.' }
    try {
      return { loan: calculateLoan({ principalCents: p, annualRatePercent: r, termMonths: Math.round(y * 12), extraMonthlyCents: e }, startDate || null) }
    } catch (err) {
      return { error: errMsg(err) }
    }
  }, [principal, rate, years, extra, startDate])

  const summaryText = result.loan
    ? [
      `Monthly payment: ${fmtAmount(result.loan.monthlyPaymentCents / 100)}`,
      `Total interest: ${fmtAmount(result.loan.totalInterestCents / 100)}`,
      `Total paid: ${fmtAmount(result.loan.totalPaidCents / 100)}`,
      `Payoff: ${result.loan.payoffMonths} months${result.loan.payoffDate ? ` (${result.loan.payoffDate})` : ''}`
    ].join('\n')
    : ''

  return (
    <div className="space-y-5">
      {error && <FormMessage error={error} />}

      <div className="grid gap-5 lg:grid-cols-[22rem_minmax(0,1fr)]">
        <section className="card card-pad-lg space-y-3">
          <h2 className="section-title">Loan calculator</h2>
          <Field label="Principal"><input className="field num" inputMode="decimal" value={principal} onChange={(e) => { setPrincipal(e.target.value); setError('') }} /></Field>
          <Field label="Annual interest rate (%)"><input className="field num" inputMode="decimal" value={rate} onChange={(e) => { setRate(e.target.value); setError('') }} /></Field>
          <Field label="Term (years)"><input className="field num" inputMode="decimal" value={years} onChange={(e) => { setYears(e.target.value); setError('') }} /></Field>
          <Field label="Extra each month (optional)"><input className="field num" inputMode="decimal" value={extra} onChange={(e) => { setExtra(e.target.value); setError('') }} /></Field>
          <Field label="First payment date (optional)"><input type="date" className="field" value={startDate} onChange={(e) => setStartDate(e.target.value)} /></Field>
          <p className="meta">Rounding: payments and interest are rounded to the whole cent; the final payment clears the balance.</p>
        </section>

        <section className="space-y-4">
          {result.error ? (
            <div className="card card-pad-lg"><FormMessage error={result.error} /></div>
          ) : result.loan && (
            <>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="card card-pad">
                  <div className="stat-label">Monthly payment</div>
                  <div className="stat-value">{fmtAmount(result.loan.monthlyPaymentCents / 100)}</div>
                </div>
                <div className="card card-pad">
                  <div className="stat-label">Total interest</div>
                  <div className="stat-value">{fmtAmount(result.loan.totalInterestCents / 100)}</div>
                </div>
                <div className="card card-pad">
                  <div className="stat-label">Total paid</div>
                  <div className="stat-value">{fmtAmount(result.loan.totalPaidCents / 100)}</div>
                </div>
                <div className="card card-pad">
                  <div className="stat-label">Paid off in</div>
                  <div className="stat-value">{result.loan.payoffMonths} months</div>
                  {result.loan.payoffDate && <div className="stat-sub">by {formatDate(result.loan.payoffDate)}</div>}
                </div>
              </div>

              {result.loan.savedInterestCents > 0 && (
                <p role="status" className="text-sm text-pos">
                  The extra payment saves {fmtAmount(result.loan.savedInterestCents / 100)} in interest
                  and finishes {result.loan.savedMonths} {result.loan.savedMonths === 1 ? 'month' : 'months'} sooner.
                </p>
              )}

              <div className="flex items-center gap-2">
                <button className="btn btn-sm" onClick={async () => { setCopied(await copyToClipboard(summaryText)); setTimeout(() => setCopied(false), 2000) }}>
                  {copied ? <Check size={13} aria-hidden="true" /> : <Copy size={13} aria-hidden="true" />}
                  {copied ? 'Copied' : 'Copy summary'}
                </button>
                <span className="meta">Copy the numbers to paste anywhere.</span>
              </div>

              <div className="card overflow-hidden">
                <div className="max-h-[24rem] overflow-y-auto">
                  <table className="tbl">
                    <caption className="sr-only">Amortization schedule</caption>
                    <thead>
                      <tr>
                        <th scope="col">#</th>
                        <th scope="col" className="r">Payment</th>
                        <th scope="col" className="r">Interest</th>
                        <th scope="col" className="r">Principal</th>
                        <th scope="col" className="r">Balance</th>
                      </tr>
                    </thead>
                    <tbody>
                      {result.loan.schedule.map((row) => (
                        <tr key={row.period}>
                          <td className="num">{row.period}</td>
                          <td className="r num">{fmtAmount(row.paymentCents / 100)}</td>
                          <td className="r num secondary">{fmtAmount(row.interestCents / 100)}</td>
                          <td className="r num secondary">{fmtAmount(row.principalCents / 100)}</td>
                          <td className="r num">{fmtAmount(row.balanceCents / 100)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          )}
        </section>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <PercentCard />
        <BillSplitCard />
        <DateCard />
      </div>
      <SavingsProjection />
    </div>
  )
}

function PercentCard() {
  const [mode, setMode] = useState<PercentMode>('of')
  const [a, setA] = useState('15')
  const [b, setB] = useState('200')
  const [copied, setCopied] = useState(false)

  const out = useMemo(() => {
    const x = Number(a); const y = Number(b)
    if (!Number.isFinite(x) || !Number.isFinite(y)) return { error: 'Enter two numbers.' }
    try { return { result: calculatePercent(mode, x, y) } } catch (e) { return { error: errMsg(e) } }
  }, [mode, a, b])

  const label = out.result ? out.result.label : ''
  const value = out.result ? Number(out.result.value.toFixed(6)) : 0
  const isPercentOut = mode === 'is-what-percent' || mode === 'change'
  const text = `${label} = ${value.toLocaleString(undefined, { maximumFractionDigits: 6 })}${isPercentOut ? '%' : ''}`

  return (
    <section className="card card-pad-lg space-y-3">
      <h2 className="section-title"><Calculator size={14} aria-hidden="true" /> Percentage</h2>
      <Field label="Mode">
        <select className="field" value={mode} onChange={(e) => setMode(e.target.value as PercentMode)}>
          <option value="of">X% of Y</option>
          <option value="is-what-percent">X is what % of Y</option>
          <option value="change">Change from X to Y</option>
          <option value="add">X plus Y%</option>
          <option value="subtract">X minus Y%</option>
        </select>
      </Field>
      <div className="grid grid-cols-2 gap-2">
        <Field label={mode === 'of' || mode === 'add' || mode === 'subtract' ? 'X' : 'From / X'}>
          <input className="field num" inputMode="decimal" value={a} onChange={(e) => setA(e.target.value)} />
        </Field>
        <Field label={mode === 'is-what-percent' ? 'Y' : mode === 'change' ? 'To / Y' : 'Y / percent'}>
          <input className="field num" inputMode="decimal" value={b} onChange={(e) => setB(e.target.value)} />
        </Field>
      </div>
      {out.error ? <FormMessage error={out.error} /> : (
        <div className="flex items-center justify-between gap-2">
          <div>
            <div className="num text-2xl font-semibold">
              {value.toLocaleString(undefined, { maximumFractionDigits: 6 })}{isPercentOut ? '%' : ''}
            </div>
            <p className="meta">{label}</p>
          </div>
          <button className="btn-icon" aria-label="Copy the result" onClick={async () => { setCopied(await copyToClipboard(text)); setTimeout(() => setCopied(false), 2000) }}>
            {copied ? <Check size={14} aria-hidden="true" /> : <ClipboardCopy size={14} aria-hidden="true" />}
          </button>
        </div>
      )}
    </section>
  )
}

function BillSplitCard() {
  const [subtotal, setSubtotal] = useState('100.00')
  const [tip, setTip] = useState('15')
  const [people, setPeople] = useState('3')
  const [copied, setCopied] = useState(false)

  const out = useMemo(() => {
    const s = cents(subtotal)
    const t = Number(tip)
    const p = Number(people)
    if (s === null) return { error: 'Enter a valid subtotal.' }
    try {
      return { result: splitBill(s, t, Math.round(p)) }
    } catch (e) {
      return { error: errMsg(e) }
    }
  }, [subtotal, tip, people])

  const summary = out.result
    ? `Tip: ${fmtAmount(out.result.tipCents / 100)} · Total: ${fmtAmount(out.result.totalCents / 100)} · Each: ${fmtAmount(out.result.perPersonCents / 100)}`
    : ''

  return (
    <section className="card card-pad-lg space-y-3">
      <h2 className="section-title">Bill split &amp; tip</h2>
      <Field label="Subtotal"><input className="field num" inputMode="decimal" value={subtotal} onChange={(e) => setSubtotal(e.target.value)} /></Field>
      <div className="grid grid-cols-2 gap-2">
        <Field label="Tip %"><input className="field num" inputMode="decimal" value={tip} onChange={(e) => setTip(e.target.value)} /></Field>
        <Field label="People"><input className="field num" inputMode="numeric" value={people} onChange={(e) => setPeople(e.target.value)} /></Field>
      </div>
      {out.error ? <FormMessage error={out.error} /> : out.result && (
        <>
          <div>
            <div className="num text-2xl font-semibold">{fmtAmount(out.result.perPersonCents / 100)}</div>
            <p className="meta">each · total {fmtAmount(out.result.totalCents / 100)} (tip {fmtAmount(out.result.tipCents / 100)})</p>
          </div>
          <div className="flex justify-end">
            <button className="btn-icon" aria-label="Copy the split" onClick={async () => { setCopied(await copyToClipboard(summary)); setTimeout(() => setCopied(false), 2000) }}>
              {copied ? <Check size={14} aria-hidden="true" /> : <ClipboardCopy size={14} aria-hidden="true" />}
            </button>
          </div>
        </>
      )}
    </section>
  )
}

function DateCard() {
  const [from, setFrom] = useState(today())
  const [to, setTo] = useState(today())
  const [amount, setAmount] = useState('30')
  const [unit, setUnit] = useState<DateUnit>('days')

  const diff = daysBetween(from, to)
  const added = (() => {
    try { return addDateAmount(from, Number(amount), unit) } catch { return null }
  })()

  return (
    <section className="card card-pad space-y-3">
      <h2 className="section-title">Dates</h2>
      <div className="grid grid-cols-2 gap-2">
        <Field label="From"><input type="date" className="field" value={from} onChange={(e) => setFrom(e.target.value)} /></Field>
        <Field label="To"><input type="date" className="field" value={to} onChange={(e) => setTo(e.target.value)} /></Field>
      </div>
      <p className="text-sm"><strong className="num">{Math.abs(diff)}</strong> {Math.abs(diff) === 1 ? 'day' : 'days'} {diff < 0 ? 'before' : 'after'}</p>
      <div className="grid grid-cols-[1fr_1fr] gap-2">
        <Field label="Add"><input className="field num" inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value)} /></Field>
        <Field label="Unit">
          <select className="field" value={unit} onChange={(e) => setUnit(e.target.value as DateUnit)}>
            <option value="days">Days</option>
            <option value="weeks">Weeks</option>
            <option value="months">Months</option>
            <option value="years">Years</option>
          </select>
        </Field>
      </div>
      {added && <p className="meta">From date + {amount} {unit} = <strong className="text-fg">{added}</strong></p>}
    </section>
  )
}

// ---------------------------------------------------------------------------
// Stopwatch: laps and splits, runs while you switch pages, can log to Focus
// ---------------------------------------------------------------------------

interface Lap { index: number; totalMs: number; splitMs: number }

function StopwatchTool() {
  const [running, setRunning] = useState(false)
  const [elapsedMs, setElapsedMs] = useState(0)
  const [laps, setLaps] = useState<Lap[]>([])
  const startedAt = useRef<number | null>(null)
  const accumulated = useRef(0)
  const lastLapMs = useRef(0)
  // Kept in the module-level ref below so switching tabs does not reset it.

  const tick = useCallback(() => {
    if (startedAt.current === null) return
    setElapsedMs(accumulated.current + (Date.now() - startedAt.current))
  }, [])

  useEffect(() => {
    if (!running) return
    const timer = setInterval(tick, 100)
    return () => clearInterval(timer)
  }, [running, tick])

  const start = () => {
    startedAt.current = Date.now()
    setRunning(true)
  }

  const stop = () => {
    if (startedAt.current !== null) accumulated.current += Date.now() - startedAt.current
    startedAt.current = null
    setRunning(false)
    setElapsedMs(accumulated.current)
  }

  const reset = () => {
    startedAt.current = null
    accumulated.current = 0
    lastLapMs.current = 0
    setRunning(false)
    setElapsedMs(0)
    setLaps([])
  }

  const lap = () => {
    const total = startedAt.current === null ? accumulated.current : accumulated.current + (Date.now() - startedAt.current)
    const split = total - lastLapMs.current
    lastLapMs.current = total
    setLaps((all) => [{ index: all.length + 1, totalMs: total, splitMs: split }, ...all])
  }

  // Space starts/stops, L laps, R resets. Only when this tab is on screen and
  // the user is not typing.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT' || target.isContentEditable)) return
      if (e.code === 'Space') { e.preventDefault(); running ? stop() : start() }
      else if (e.key.toLowerCase() === 'l') { e.preventDefault(); lap() }
      else if (e.key.toLowerCase() === 'r') { e.preventDefault(); reset() }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  const [logError, setLogError] = useState('')
  const [logged, setLogged] = useState('')

  const logToFocus = async () => {
    setLogError(''); setLogged('')
    if (elapsedMs < 1000) return setLogError('Run the stopwatch for at least a second first.')
    const end = new Date()
    const start = new Date(end.getTime() - elapsedMs)
    try {
      await window.api.focus.logManual({
        startedAt: start.toISOString(),
        endedAt: end.toISOString(),
        actualSeconds: Math.round(elapsedMs / 1000),
        type: 'count-up',
        note: 'From the stopwatch'
      })
      setLogged(`Logged ${formatTimer(elapsedMs)} to Focus.`)
      void window.api.capture.saved()
    } catch (e) {
      setLogError(errMsg(e))
    }
  }

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_20rem]">
      <section className="card card-pad-lg flex flex-col items-center justify-center py-10">
        <div className="font-mono text-6xl font-bold tabular-nums tracking-tight">{formatTimer(elapsedMs)}</div>
        <p className="meta mt-2">Space starts and stops · L laps · R resets</p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          {running ? (
            <button className="btn-primary" onClick={stop}><Square size={15} className="mr-1.5 inline" aria-hidden="true" /> Stop</button>
          ) : (
            <button className="btn-primary" onClick={start}><Timer size={15} className="mr-1.5 inline" aria-hidden="true" /> Start</button>
          )}
          <button className="btn" onClick={lap} disabled={elapsedMs === 0}>Lap</button>
          <button className="btn" onClick={reset} disabled={elapsedMs === 0}>Reset</button>
        </div>
      </section>

      <aside className="space-y-4">
        <section className="card card-pad-lg">
          <h2 className="section-title">Log to Focus</h2>
          <p className="meta mt-1">Turns the stopwatch time into a Focus session.</p>
          <button className="btn-primary mt-3 w-full" onClick={() => void logToFocus()} disabled={elapsedMs < 1000}>
            Log to a Focus session
          </button>
          <div className="mt-2"><FormMessage error={logError} note={logged} /></div>
        </section>

        <section className="card card-pad-lg">
          <h2 className="section-title">Laps</h2>
          {laps.length === 0 ? (
            <p className="meta mt-2">No laps yet. Press L or the Lap button.</p>
          ) : (
            <ul className="mt-3 max-h-[18rem] divide-y divide-line/60 overflow-y-auto">
              {laps.map((l) => (
                <li key={l.index} className="flex items-center justify-between py-1.5 text-sm">
                  <span className="num text-muted">#{l.index}</span>
                  <span className="num">{formatTimer(l.totalMs)}</span>
                  <span className="num text-muted">+{formatTimer(l.splitMs)}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </aside>
    </div>
  )
}

function formatTimer(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000))
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  const pad = (n: number) => String(n).padStart(2, '0')
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`
}

// ---------------------------------------------------------------------------
// Scratchpad: plain-text pads that autosave
// ---------------------------------------------------------------------------

function ScratchpadTool() {
  const [pads, setPads] = useState<ScratchpadDTO[]>([])
  const [activeId, setActiveId] = useState<number | null>(null)
  const [text, setText] = useState('')
  const [name, setName] = useState('')
  const [saving, setSaving] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const [error, setError] = useState('')
  const [note, setNote] = useState('')
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const load = useCallback(async () => {
    try {
      const pad = await window.api.scratchpads.ensure()
      const all = await window.api.scratchpads.list()
      setPads(all)
      setActiveId(pad.id)
      setName(pad.name)
      setText(pad.content)
    } catch (e) {
      setError(errMsg(e))
    }
  }, [])

  useEffect(() => { void load() }, [load])
  useRefreshOnCapture(load)

  const persist = useCallback(async (id: number, next: { name?: string; content?: string }) => {
    setSaving('saving')
    try {
      await window.api.scratchpads.update(id, next)
      setSaving('saved')
    } catch (e) {
      setSaving('error')
      setError(errMsg(e))
    }
  }, [])

  const change = (patch: { name?: string; content?: string }) => {
    if (patch.content !== undefined) setText(patch.content)
    if (patch.name !== undefined) setName(patch.name)
    if (activeId === null) return
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => void persist(activeId, patch), 500)
  }

  const select = (pad: ScratchpadDTO) => {
    if (timer.current) clearTimeout(timer.current)
    setActiveId(pad.id); setName(pad.name); setText(pad.content); setSaving('idle'); setNote('')
  }

  const addPad = async () => {
    try {
      const pad = await window.api.scratchpads.create({ name: `Pad ${pads.length + 1}`, content: '' })
      setPads((all) => [...all, pad])
      select(pad)
    } catch (e) {
      setError(errMsg(e))
    }
  }

  const removePad = async (pad: ScratchpadDTO) => {
    try {
      await window.api.scratchpads.remove(pad.id)
      const rest = pads.filter((p) => p.id !== pad.id)
      setPads(rest)
      if (rest.length > 0) select(rest[0])
      else await load()
    } catch (e) {
      setError(errMsg(e))
    }
  }

  const saveAsNote = async () => {
    if (activeId === null) return
    try {
      const created = await window.api.scratchpads.saveAsNote(activeId)
      setNote(`Saved as the note "${created.title}".`)
      void window.api.capture.saved()
    } catch (e) {
      setError(errMsg(e))
    }
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[14rem_minmax(0,1fr)]">
      <aside className="card card-pad">
        <div className="flex items-center justify-between">
          <h2 className="section-title">Pads</h2>
          <button className="btn-icon" onClick={() => void addPad()} aria-label="New scratchpad"><Plus size={15} aria-hidden="true" /></button>
        </div>
        <ul className="mt-2 flex flex-col gap-1">
          {pads.map((p) => (
            <li key={p.id}>
              <button onClick={() => select(p)} aria-current={p.id === activeId ? 'true' : undefined}
                className={`w-full truncate rounded-lg px-2 py-1.5 text-left text-sm ${p.id === activeId ? 'bg-accent/10' : 'hover:bg-fg/5'}`}>
                {p.name || 'Untitled pad'}
              </button>
            </li>
          ))}
        </ul>
      </aside>

      <section className="card card-pad-lg">
        <div className="flex flex-wrap items-center gap-2">
          <input className="field max-w-[18rem] flex-1" aria-label="Pad name" value={name} onChange={(e) => change({ name: e.target.value })} />
          <span className={`meta ${saving === 'saved' ? 'text-pos' : saving === 'error' ? 'text-neg' : ''}`} aria-live="polite" role="status">
            {saving === 'saving' ? 'Saving…' : saving === 'saved' ? '✓ Saved' : saving === 'error' ? 'Not saved' : ''}
          </span>
          <span className="ml-auto flex items-center gap-1">
            <button className="btn btn-sm" onClick={() => void saveAsNote()}>Save as note</button>
            {activeId !== null && pads.length > 1 && (
              <button className="btn-icon hover:text-neg" aria-label="Delete this pad" onClick={() => { const p = pads.find((x) => x.id === activeId); if (p) void removePad(p) }}>
                <Trash2 size={14} aria-hidden="true" />
              </button>
            )}
          </span>
        </div>
        <textarea
          className="field mt-3 min-h-[24rem] w-full resize-y font-mono text-sm leading-relaxed"
          value={text}
          placeholder="Type anything here. It saves as you go."
          aria-label="Scratchpad text"
          onChange={(e) => change({ content: e.target.value })}
        />
        <div className="mt-2 flex items-center justify-between">
          <span className="meta">{text.length} characters · {text.split(/\s+/).filter(Boolean).length} words</span>
          <FormMessage error={error} note={note} />
        </div>
      </section>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Snippets
// ---------------------------------------------------------------------------

function SnippetsTool() {
  const [snippets, setSnippets] = useState<SnippetDTO[]>([])
  const [loaded, setLoaded] = useState(false)
  const [editing, setEditing] = useState<SnippetDTO | 'new' | null>(null)
  const [copiedId, setCopiedId] = useState<number | null>(null)
  const [error, setError] = useState('')
  const [search, setSearch] = useState('')

  const load = useCallback(async () => {
    try {
      setSnippets(await window.api.snippets.list())
      setError('')
    } catch (e) {
      setError(errMsg(e))
    }
    setLoaded(true)
  }, [])

  useEffect(() => { void load() }, [load])
  useRefreshOnCapture(load)

  // Command palette "Copy snippet…": copy the most recently edited snippet and
  // say so, so the action works without opening the Tools page first.
  useEffect(() => {
    const onCopy = () => {
      const newest = snippets[0]
      if (!newest) return
      void copyToClipboard(newest.body).then((ok) => {
        if (!ok) return
        setCopiedId(newest.id)
        setTimeout(() => setCopiedId(null), 2000)
      })
    }
    window.addEventListener('snippets:copy', onCopy)
    return () => window.removeEventListener('snippets:copy', onCopy)
  }, [snippets])

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return snippets
    return snippets.filter((s) => s.title.toLowerCase().includes(q) || s.body.toLowerCase().includes(q) || s.tags.some((t) => t.includes(q)))
  }, [snippets, search])

  const copy = async (s: SnippetDTO) => {
    if (await copyToClipboard(s.body)) {
      setCopiedId(s.id)
      setTimeout(() => setCopiedId(null), 2000)
    }
  }

  const remove = async (s: SnippetDTO) => {
    try {
      await window.api.snippets.remove(s.id)
      await load()
    } catch (e) {
      setError(errMsg(e))
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <input className="field min-w-[12rem] flex-1" placeholder="Search snippets" aria-label="Search snippets" value={search} onChange={(e) => setSearch(e.target.value)} />
        <button className="btn-primary" onClick={() => setEditing('new')}><Plus size={15} aria-hidden="true" /> New snippet</button>
      </div>

      {error && <FormMessage error={error} />}

      {loaded && snippets.length === 0 ? (
        <EmptyState icon={Scissors} title="No snippets yet"
          text="Save text you paste often — commands, addresses, replies — and copy it in one click."
          action={<button className="btn-primary" onClick={() => setEditing('new')}><Plus size={15} aria-hidden="true" /> Add your first snippet</button>} />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {visible.map((s) => (
            <article key={s.id} className="card card-pad flex flex-col">
              <div className="flex items-start justify-between gap-2">
                <h3 className="truncate font-semibold">{s.title}</h3>
                <span className="flex shrink-0 items-center gap-1">
                  <button className="btn-icon" aria-label={`Copy ${s.title}`} onClick={() => void copy(s)}>
                    {copiedId === s.id ? <Check size={14} aria-hidden="true" /> : <Copy size={14} aria-hidden="true" />}
                  </button>
                  <button className="btn-icon hover:text-neg" aria-label={`Delete ${s.title}`} onClick={() => void remove(s)}>
                    <Trash2 size={14} aria-hidden="true" />
                  </button>
                </span>
              </div>
              <pre className="mt-2 max-h-24 overflow-hidden whitespace-pre-wrap break-words text-xs text-muted">{s.body}</pre>
              <div className="mt-auto flex items-center justify-between pt-2">
                <span className="meta">{s.tags.map((t) => `#${t}`).join(' ') || 'No tags'}</span>
                <button className="btn btn-sm" onClick={() => setEditing(s)}>Edit</button>
              </div>
            </article>
          ))}
          {visible.length === 0 && snippets.length > 0 && <p className="meta">Nothing matches that search.</p>}
        </div>
      )}

      {editing && (
        <SnippetEditor
          snippet={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); void load() }}
        />
      )}
    </div>
  )
}

function SnippetEditor({ snippet, onClose, onSaved }: { snippet: SnippetDTO | null; onClose: () => void; onSaved: () => void }) {
  const [title, setTitle] = useState(snippet?.title ?? '')
  const [body, setBody] = useState(snippet?.body ?? '')
  const [tags, setTags] = useState<string[]>(snippet?.tags ?? [])
  const [tagInput, setTagInput] = useState('')
  const [error, setError] = useState('')

  const save = async () => {
    setError('')
    if (!title.trim()) return setError('Give the snippet a title.')
    try {
      if (snippet) await window.api.snippets.update(snippet.id, { title, body, tags })
      else await window.api.snippets.create({ title, body, tags })
      onSaved()
    } catch (e) {
      setError(errMsg(e))
    }
  }

  return (
    <Dialog title={snippet ? 'Edit snippet' : 'New snippet'} onClose={onClose} onSave={() => void save()} wide>
      <div className="space-y-4">
        <Field label="Title"><input className="field" autoFocus value={title} onChange={(e) => setTitle(e.target.value)} /></Field>
        <Field label="Body">
          <textarea className="field min-h-[10rem] resize-y font-mono text-sm" value={body} onChange={(e) => setBody(e.target.value)} />
        </Field>
        <TagInput tags={tags} onTagsChange={setTags} input={tagInput} onInputChange={setTagInput} suggestions={[]} />
        <FormMessage error={error} />
        <div className="flex justify-end gap-2">
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn-primary" onClick={() => void save()}>{snippet ? 'Save changes' : 'Add snippet'}</button>
        </div>
      </div>
    </Dialog>
  )
}

// ---------- savings projection (uses the Savings module in Phase 6) ----------

function SavingsProjection() {
  const [current, setCurrent] = useState('0')
  const [target, setTarget] = useState('5000')
  const [monthly, setMonthly] = useState('200')

  const months = useMemo(() => {
    const c = cents(current); const t = cents(target); const m = cents(monthly)
    if (c === null || t === null || m === null) return null
    return monthsToTarget(c, t, m)
  }, [current, target, monthly])

  return (
    <section className="card card-pad-lg space-y-3">
      <h2 className="section-title">Savings projection</h2>
      <div className="grid grid-cols-3 gap-2">
        <Field label="Saved so far"><input className="field num" inputMode="decimal" value={current} onChange={(e) => setCurrent(e.target.value)} /></Field>
        <Field label="Target"><input className="field num" inputMode="decimal" value={target} onChange={(e) => setTarget(e.target.value)} /></Field>
        <Field label="Each month"><input className="field num" inputMode="decimal" value={monthly} onChange={(e) => setMonthly(e.target.value)} /></Field>
      </div>
      <p className="text-sm">
        {months === null ? 'Add a monthly amount to see a date.'
          : months === 0 ? 'That target is already reached.'
            : `About ${months} ${months === 1 ? 'month' : 'months'} — by ${formatDate(addDateAmount(today(), months, 'months'))}.`}
      </p>
      <p className="meta">Simple arithmetic: no interest is assumed on the savings.</p>
    </section>
  )
}

export { SavingsProjection, monthlyPayment }
