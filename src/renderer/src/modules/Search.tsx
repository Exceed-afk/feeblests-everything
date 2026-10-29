import { PageHeader } from '../components/PageHeader'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { BookOpen, CandlestickChart, PiggyBank, Receipt, Search as SearchIcon, X } from 'lucide-react'
import type { SearchGroup, SearchResults } from '../../../shared/types'
import { isEmptyQuery, parseQuery } from '../../../shared/search'
import { progressPercent } from '../../../shared/savings'
import { moodStyle } from '../lib/moods'
import { formatDate } from '../lib/dates'
import { fmtAmount, fmtNum, fmtPnl, pnlColor } from '../lib/format'
import { errMsg } from '../lib/errors'
import { makeSnippet } from '../lib/snippet'
import type { ModuleProps } from '../lib/navigation'
import { TagChip } from '../components/TagChip'
import { Highlight } from '../components/Highlight'
import { ProgressBar } from '../components/ProgressBar'

const PAGE = 8 // results shown per group before "Show more"
const MORE = 16 // how many extra each "Show more" click adds

// Remembered while the app is open, so coming back from a result shows the same search.
let lastQuery = ''

const rowClass =
  'w-full card card-pad-sm text-left hover:border-accent/50'

export function Search({ onOpen }: ModuleProps) {
  const [query, setQuery] = useState(lastQuery)
  const [limit, setLimit] = useState(PAGE)
  const [results, setResults] = useState<SearchResults | null>(null)
  const [error, setError] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  const requestId = useRef(0) // lets us ignore an answer that arrives after a newer search

  const parsed = useMemo(() => parseQuery(query), [query])
  const terms = parsed.terms
  const searching = !isEmptyQuery(parsed)

  useEffect(() => { lastQuery = query }, [query])

  // Focus the box when the page opens. (Ctrl+K belongs to the command palette now, see App.tsx.)
  useEffect(() => {
    inputRef.current?.focus()
    inputRef.current?.select()
  }, [])

  // Re-run shortly after typing stops (same feel as the filters on the other pages).
  useEffect(() => {
    if (!searching) { requestId.current++; setResults(null); setError(''); return }
    const timer = setTimeout(async () => {
      const mine = ++requestId.current
      try {
        const r = await window.api.search.run(query, limit)
        if (mine === requestId.current) { setResults(r); setError('') }
      } catch (e) {
        if (mine === requestId.current) setError(errMsg(e))
      }
    }, 150)
    return () => clearTimeout(timer)
  }, [query, limit, searching])

  const change = (text: string) => { setQuery(text); setLimit(PAGE) }
  const more = () => setLimit((n) => n + MORE)

  const grandTotal = results
    ? results.logbook.total + results.trades.total + results.goals.total + results.transactions.total
    : 0

  return (
    <div className="page page-sm">
      <PageHeader title="Search" subtitle="Logbook, trades and savings in one place." />

      <div className="relative">
        <SearchIcon size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-muted" />
        <input ref={inputRef} className="field py-3 pl-11 pr-10 text-base" value={query}
          placeholder="Search your logbook, trades and savings" aria-label="Search everything"
          onChange={(e) => change(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Escape' && query) { e.preventDefault(); change('') } }} />
        {query && (
          <button onClick={() => { change(''); inputRef.current?.focus() }} aria-label="Clear search"
            className="absolute right-3 top-1/2 -translate-y-1/2 rounded-lg p-1 text-muted hover:bg-fg/5 hover:text-fg">
            <X size={16} />
          </button>
        )}
      </div>

      {!searching && (
        <div className="empty mt-6 items-start text-left">
          <p className="font-medium">Find anything you have written or tracked.</p>
          <ul className="mt-3 space-y-1.5 text-sm text-muted">
            <li><code className="text-fg">gold breakout</code> finds items containing both words</li>
            <li><code className="text-fg">#risk</code> finds items tagged risk</li>
            <li><code className="text-fg">2026-10</code> finds items from October 2026</li>
          </ul>
          <p className="mt-3 text-sm text-muted">Tip: Ctrl+K opens the command palette, to jump to any tool from anywhere.</p>
        </div>
      )}

      {error && <p role="alert" className="mt-4 text-sm text-neg">{error}</p>}

      {results && grandTotal === 0 && (
        <div className="empty mt-6">
          <p className="text-muted">Nothing matches “{query.trim()}”.</p>
          <p className="mt-1 text-sm text-muted">Try fewer words, or check the spelling.</p>
        </div>
      )}

      {results && grandTotal > 0 && (
        <>
          <p className="mt-4 text-sm text-muted" aria-live="polite">
            {grandTotal} {grandTotal === 1 ? 'result' : 'results'}
          </p>

          <Group title="Logbook" icon={<BookOpen size={14} />} group={results.logbook} onMore={more}>
            {results.logbook.items.map((e) => (
              <button key={e.id} className={rowClass} onClick={() => onOpen({ module: 'logbook', entry: e })}>
                <div className="flex items-center gap-2 text-xs text-muted">
                  {e.mood && <span title={moodStyle(e.mood).label} className={`h-2.5 w-2.5 rounded-full ${moodStyle(e.mood).dot}`} />}
                  {formatDate(e.date)}
                </div>
                <div className="mt-1 font-medium"><Highlight text={e.title} terms={terms} /></div>
                {e.body && (
                  <p className="mt-1 line-clamp-2 text-sm text-muted"><Highlight text={makeSnippet(e.body, terms)} terms={terms} /></p>
                )}
                <TagList tags={e.tags} />
              </button>
            ))}
          </Group>

          <Group title="Trades" icon={<CandlestickChart size={14} />} group={results.trades} onMore={more}>
            {results.trades.items.map((t) => (
              <button key={t.id} className={rowClass} onClick={() => onOpen({ module: 'trades', trade: t })}>
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <span className="font-medium"><Highlight text={t.asset} terms={terms} /></span>
                    <span className={`badge capitalize ${t.direction === 'long' ? 'badge-pos' : 'badge-neg'}`}>{t.direction}</span>
                  </div>
                  <span className={`text-sm font-medium tabular-nums ${pnlColor(t.pnl)}`}>{t.pnl === null ? 'Open' : fmtPnl(t.pnl)}</span>
                </div>
                <div className="mt-1 text-xs text-muted">
                  {formatDate(t.date)} · {fmtNum(t.entryPrice)} → {t.exitPrice === null ? 'open' : fmtNum(t.exitPrice)}
                </div>
                {t.notes && (
                  <p className="mt-1 line-clamp-2 text-sm text-muted"><Highlight text={makeSnippet(t.notes, terms)} terms={terms} /></p>
                )}
                <TagList tags={t.tags} />
              </button>
            ))}
          </Group>

          <Group title="Savings goals" icon={<PiggyBank size={14} />} group={results.goals} onMore={more}>
            {results.goals.items.map((g) => {
              const pct = progressPercent(g.balance, g.target)
              return (
                <button key={g.id} className={rowClass} onClick={() => onOpen({ module: 'savings', goalId: g.id })}>
                  <div className="flex items-center justify-between gap-3">
                    <span className="font-medium"><Highlight text={g.name} terms={terms} /></span>
                    <span className="text-sm font-medium tabular-nums">{fmtAmount(g.balance)}</span>
                  </div>
                  {g.notes && (
                    <p className="mt-1 line-clamp-2 text-sm text-muted"><Highlight text={makeSnippet(g.notes, terms)} terms={terms} /></p>
                  )}
                  {g.target !== null && pct !== null && (
                    <div className="mt-3">
                      <ProgressBar percent={pct} />
                      <div className="mt-1.5 text-xs text-muted">{pct >= 100 ? 'Goal reached' : `${Math.floor(pct)}%`} of {fmtAmount(g.target)}</div>
                    </div>
                  )}
                </button>
              )
            })}
          </Group>

          <Group title="Savings transactions" icon={<Receipt size={14} />} group={results.transactions} onMore={more}>
            {results.transactions.items.map((t) => (
              <button key={t.id} className={rowClass} onClick={() => onOpen({ module: 'savings', goalId: t.goalId })}>
                <div className="flex items-center justify-between gap-3">
                  <span className="font-medium">{t.goalName}</span>
                  <span className={`text-sm font-medium tabular-nums ${t.kind === 'deposit' ? 'text-pos' : 'text-neg'}`}>
                    {t.kind === 'deposit' ? '+' : '-'}{fmtAmount(t.amount)}
                  </span>
                </div>
                <div className="mt-1 text-xs capitalize text-muted">{formatDate(t.date)} · {t.kind}</div>
                {t.note && <p className="mt-1 text-sm text-muted"><Highlight text={t.note} terms={terms} /></p>}
              </button>
            ))}
          </Group>
        </>
      )}
    </div>
  )
}

function TagList({ tags }: { tags: string[] }) {
  if (tags.length === 0) return null
  return (
    <div className="mt-3 flex flex-wrap gap-1.5">
      {tags.map((t) => <TagChip key={t} tag={t} />)}
    </div>
  )
}

// One titled section of results. Hidden when that type has no matches.
function Group<T>({ title, icon, group, onMore, children }: {
  title: string; icon: ReactNode; group: SearchGroup<T>; onMore: () => void; children: ReactNode
}) {
  if (group.total === 0) return null
  const hidden = group.total - group.items.length
  return (
    <section className="mt-8">
      <h2 className="section-title">
        {icon} {title} <span className="badge badge-muted">{group.total}</span>
      </h2>
      <div className="mt-3 flex flex-col gap-3">{children}</div>
      {hidden > 0 && (
        <button className="btn mt-3" onClick={onMore}>Show more ({hidden} left)</button>
      )}
    </section>
  )
}
