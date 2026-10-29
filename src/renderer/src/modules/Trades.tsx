import { useCallback, useEffect, useMemo, useState } from 'react'
import { useRefreshOnCapture } from '../lib/dataChanged'
import { CandlestickChart, Plus, Search } from 'lucide-react'
import type { Direction, Trade, TradeFilter, TradeMeta } from '../../../shared/types'
import { computeStats } from '../../../shared/trades'
import { formatDate } from '../lib/dates'
import { fmtNum, fmtPnl, pnlColor } from '../lib/format'
import { PageHeader } from '../components/PageHeader'
import { EmptyState } from '../components/EmptyState'
import { Pnl } from '../components/Pnl'
import type { ModuleProps } from '../lib/navigation'
import { TradeEditor } from './TradeEditor'
import { TagChip } from '../components/TagChip'

export function Trades({ target, onTargetHandled }: ModuleProps) {
  const [trades, setTrades] = useState<Trade[]>([])
  const [meta, setMeta] = useState<TradeMeta>({ assets: [], tags: [] })
  const [filter, setFilter] = useState<TradeFilter>({})
  const [editing, setEditing] = useState<Trade | 'new' | null>(null)
  const [loaded, setLoaded] = useState(false)

  const hasFilter = Boolean(filter.text || filter.tag || filter.direction || filter.from || filter.to)
  const setF = (patch: TradeFilter) => setFilter({ ...filter, ...patch })
  // Stats follow the filters, so you can see e.g. your win rate on one asset.
  const stats = useMemo(() => computeStats(trades), [trades])

  const refresh = useCallback(async () => {
    const [t, m] = await Promise.all([window.api.trades.list(filter), window.api.trades.meta()])
    setTrades(t); setMeta(m); setLoaded(true)
  }, [filter])

  useEffect(() => {
    const id = setTimeout(refresh, 150)
    return () => clearTimeout(id)
  }, [refresh])
  useRefreshOnCapture(refresh) // something was saved from the Quick capture window

  // Opened from Search: show that trade's editor straight away.
  useEffect(() => {
    if (target?.module === 'trades') { setEditing(target.trade); onTargetHandled() }
  }, [target, onTargetHandled])

  // Ctrl+N logs a new trade.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.key.toLowerCase() === 'n') { e.preventDefault(); setEditing('new') }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const card = (label: string, value: string, sub: string, color = '') => (
    <div className="card card-pad-sm">
      <div className="stat-label">{label}</div>
      <div className={`stat-value ${color}`}>{value}</div>
      <div className="stat-sub">{sub}</div>
    </div>
  )

  return (
    <div className="page">
      <PageHeader title="Trades" subtitle={stats.total === 0 ? 'Track every trade, open or closed.' : `${stats.closed} closed, ${stats.open} open${hasFilter ? ' (filtered)' : ''}`}>
        <button className="btn-primary" onClick={() => setEditing('new')} title="Ctrl+N">
          <Plus size={16} /> New trade
        </button>
      </PageHeader>

      {stats.total > 0 && (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {card('Total P&L', fmtPnl(stats.totalPnl), `after ${fmtNum(stats.totalFees)} in fees`, pnlColor(stats.totalPnl))}
          {card('Win rate', stats.winRate === null ? '-' : `${stats.winRate.toFixed(0)}%`, `${stats.wins} wins, ${stats.losses} losses`)}
          {card('Closed trades', String(stats.closed), `${stats.open} still open`)}
          {card('Profit factor', stats.profitFactor === null ? '-' : stats.profitFactor.toFixed(2),
            stats.avgWin === null && stats.avgLoss === null ? 'Needs a win and a loss'
              : `avg win ${stats.avgWin === null ? '-' : fmtPnl(stats.avgWin)}, avg loss ${stats.avgLoss === null ? '-' : fmtPnl(stats.avgLoss)}`)}
        </div>
      )}

      <div className="mt-5 flex flex-wrap items-center gap-2">
        <div className="relative min-w-[12rem] flex-1">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
          <input className="field pl-9" placeholder="Search asset or notes" value={filter.text ?? ''}
            onChange={(e) => setF({ text: e.target.value })} />
        </div>
        <select className="field w-32" value={filter.direction ?? ''} aria-label="Filter by direction"
          onChange={(e) => setF({ direction: (e.target.value || undefined) as Direction | undefined })}>
          <option value="">Long + short</option>
          <option value="long">Long</option>
          <option value="short">Short</option>
        </select>
        <select className="field w-40" value={filter.tag ?? ''} aria-label="Filter by tag"
          onChange={(e) => setF({ tag: e.target.value || undefined })}>
          <option value="">All tags</option>
          {meta.tags.map((t) => <option key={t.tag} value={t.tag}>#{t.tag} ({t.count})</option>)}
        </select>
        <input type="date" className="field w-40" aria-label="From date" value={filter.from ?? ''}
          onChange={(e) => setF({ from: e.target.value || undefined })} />
        <input type="date" className="field w-40" aria-label="To date" value={filter.to ?? ''}
          onChange={(e) => setF({ to: e.target.value || undefined })} />
        {hasFilter && <button className="btn" onClick={() => setFilter({})}>Clear</button>}
      </div>

      <div className="mt-6">
        {loaded && trades.length === 0 && (hasFilter ? (
          <EmptyState title="No trades match these filters" text="Try a different asset or clear the filters."
            action={<button className="btn mt-4" onClick={() => setFilter({})}>Clear filters</button>} />
        ) : (
          <EmptyState icon={CandlestickChart} title="No trades yet. Your first entry starts the track record."
            text="Log a trade, including the ones still open, and your stats build themselves."
            action={<button className="btn-primary" onClick={() => setEditing('new')}><Plus size={16} /> Log your first trade</button>} />
        ))}

        {trades.length > 0 && (
          <div className="card overflow-hidden">
            <div className="tbl-wrap">
              <table className="tbl">
                <thead>
                  <tr>
                    <th>Date</th><th>Asset</th><th>Side</th><th>Status</th>
                    <th className="r">Entry</th><th className="r">Exit</th><th className="r">Size</th><th className="r">Fees</th><th className="r">P&L</th>
                  </tr>
                </thead>
                <tbody>
                  {trades.map((t) => (
                    <tr key={t.id} onClick={() => setEditing(t)} tabIndex={0} onKeyDown={(k) => k.key === 'Enter' && setEditing(t)}>
                      <td className="secondary whitespace-nowrap">{formatDate(t.date)}</td>
                      <td className="font-medium">
                        {t.asset}
                        {t.tags.length > 0 && <span className="ml-2 inline-flex flex-wrap gap-1 align-middle font-normal">{t.tags.map((x) => <TagChip key={x} tag={x} />)}</span>}
                      </td>
                      <td><span className={`badge capitalize ${t.direction === 'long' ? 'badge-pos' : 'badge-neg'}`}>{t.direction}</span></td>
                      <td>{t.exitPrice === null ? <span className="badge badge-open">Open</span> : <span className="badge badge-muted">Closed</span>}</td>
                      <td className="r">{fmtNum(t.entryPrice)}</td>
                      <td className="r">{t.exitPrice === null ? <span className="text-muted">-</span> : fmtNum(t.exitPrice)}</td>
                      <td className="r">{fmtNum(t.quantity)}</td>
                      <td className="r secondary">{fmtNum(t.fees)}</td>
                      <td className="r font-medium"><Pnl value={t.pnl} open="-" /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      {editing && (
        <TradeEditor key={editing === 'new' ? 'new' : editing.id}
          trade={editing === 'new' ? null : editing} assets={meta.assets} knownTags={meta.tags.map((t) => t.tag)}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); refresh() }} />
      )}
    </div>
  )
}
