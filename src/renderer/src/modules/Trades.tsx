import { useCallback, useEffect, useMemo, useState } from 'react'
import { Plus, Search } from 'lucide-react'
import type { Direction, Trade, TradeFilter, TradeMeta } from '../../../shared/types'
import { computeStats } from '../../../shared/trades'
import { formatDate } from '../lib/dates'
import { fmtNum, fmtPnl, pnlColor } from '../lib/format'
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
    <div className="rounded-2xl border border-line bg-card p-4 shadow-card">
      <div className="text-xs text-muted">{label}</div>
      <div className={`mt-1 text-2xl font-semibold tabular-nums ${color}`}>{value}</div>
      <div className="mt-1 text-xs text-muted">{sub}</div>
    </div>
  )

  return (
    <div className="mx-auto max-w-5xl px-10 py-10">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Trade Tracker</h1>
        <button className="btn-primary" onClick={() => setEditing('new')} title="Ctrl+N">
          <Plus size={16} /> New trade
        </button>
      </div>

      {stats.total > 0 && (
        <div className="mt-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
          {card('Total P&L', fmtPnl(stats.totalPnl), `after ${fmtNum(stats.totalFees)} in fees`, pnlColor(stats.totalPnl))}
          {card('Win rate', stats.winRate === null ? '-' : `${stats.winRate.toFixed(0)}%`, `${stats.wins} wins, ${stats.losses} losses`)}
          {card('Trades', String(stats.closed), `${stats.open} still open`)}
          {card('Profit factor', stats.profitFactor === null ? '-' : stats.profitFactor.toFixed(2),
            stats.avgWin === null && stats.avgLoss === null ? 'Needs a win and a loss'
              : `avg win ${stats.avgWin === null ? '-' : fmtPnl(stats.avgWin)}, avg loss ${stats.avgLoss === null ? '-' : fmtPnl(stats.avgLoss)}`)}
        </div>
      )}

      <div className="mt-6 flex flex-wrap items-center gap-2">
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
        {loaded && trades.length === 0 && (
          <div className="rounded-2xl border border-dashed border-line bg-card/50 p-10 text-center">
            {hasFilter ? (
              <p className="text-muted">No trades match these filters.</p>
            ) : (
              <>
                <p className="font-medium">No trades yet. Your first entry starts the track record.</p>
                <p className="mt-1 text-sm text-muted">Log a trade, including the ones still open, and your stats build themselves.</p>
                <button className="btn-primary mt-5" onClick={() => setEditing('new')}>
                  <Plus size={16} /> Log your first trade
                </button>
              </>
            )}
          </div>
        )}

        {trades.length > 0 && (
          <div className="overflow-x-auto rounded-2xl border border-line bg-card shadow-card">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-line text-left text-xs text-muted">
                  <th className="px-4 py-3 font-medium">Date</th>
                  <th className="px-4 py-3 font-medium">Asset</th>
                  <th className="px-4 py-3 font-medium">Side</th>
                  <th className="px-4 py-3 text-right font-medium">Entry</th>
                  <th className="px-4 py-3 text-right font-medium">Exit</th>
                  <th className="px-4 py-3 text-right font-medium">Size</th>
                  <th className="px-4 py-3 text-right font-medium">Fees</th>
                  <th className="px-4 py-3 text-right font-medium">P&L</th>
                </tr>
              </thead>
              <tbody>
                {trades.map((t) => (
                  <tr key={t.id} onClick={() => setEditing(t)} tabIndex={0}
                    onKeyDown={(k) => k.key === 'Enter' && setEditing(t)}
                    className="cursor-pointer border-b border-line last:border-0 hover:bg-fg/5">
                    <td className="whitespace-nowrap px-4 py-3 text-muted">{formatDate(t.date)}</td>
                    <td className="px-4 py-3 font-medium">
                      {t.asset}
                      {t.tags.length > 0 && <span className="ml-2 inline-flex flex-wrap gap-1 align-middle font-normal">{t.tags.map((x) => <TagChip key={x} tag={x} />)}</span>}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`rounded-lg px-2 py-0.5 text-xs capitalize ${
                        t.direction === 'long' ? 'bg-emerald-500/10 text-emerald-500' : 'bg-rose-500/10 text-rose-500'}`}>{t.direction}</span>
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums">{fmtNum(t.entryPrice)}</td>
                    <td className="px-4 py-3 text-right tabular-nums">{t.exitPrice === null ? <span className="text-muted">Open</span> : fmtNum(t.exitPrice)}</td>
                    <td className="px-4 py-3 text-right tabular-nums">{fmtNum(t.quantity)}</td>
                    <td className="px-4 py-3 text-right tabular-nums text-muted">{fmtNum(t.fees)}</td>
                    <td className={`px-4 py-3 text-right font-medium tabular-nums ${pnlColor(t.pnl)}`}>{t.pnl === null ? '-' : fmtPnl(t.pnl)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
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
