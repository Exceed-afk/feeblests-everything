import { useEffect, useState } from 'react'
import { X } from 'lucide-react'
import type { Direction, Trade } from '../../../shared/types'
import { calcPnl } from '../../../shared/trades'
import { today } from '../lib/dates'
import { fmtPnl, pnlColor } from '../lib/format'
import { TagInput, addTag } from '../components/TagInput'

interface Props {
  trade: Trade | null // null = logging a new trade
  assets: string[]
  knownTags: string[]
  onSaved: () => void
  onClose: () => void
}

// Text boxes give us strings; these turn them into numbers.
// Empty -> NaN (invalid), except where noted at the call site.
const num = (s: string): number => (s.trim() === '' ? NaN : Number(s))

export function TradeEditor({ trade, assets, knownTags, onSaved, onClose }: Props) {
  const [date, setDate] = useState(trade?.date ?? today())
  const [asset, setAsset] = useState(trade?.asset ?? '')
  const [direction, setDirection] = useState<Direction>(trade?.direction ?? 'long')
  const [entry, setEntry] = useState(trade ? String(trade.entryPrice) : '')
  const [exit, setExit] = useState(trade?.exitPrice != null ? String(trade.exitPrice) : '')
  const [qty, setQty] = useState(trade ? String(trade.quantity) : '')
  const [fees, setFees] = useState(trade ? String(trade.fees) : '')
  const [notes, setNotes] = useState(trade?.notes ?? '')
  const [tags, setTags] = useState<string[]>(trade?.tags ?? [])
  const [tagInput, setTagInput] = useState('')
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [error, setError] = useState('')

  // Blank exit = trade still open. Blank fees = 0.
  const exitPrice = exit.trim() === '' ? null : Number(exit)
  const feesN = fees.trim() === '' ? 0 : Number(fees)

  // Live preview, using the same calcPnl function the database uses.
  const preview =
    num(entry) > 0 && num(qty) > 0 && feesN >= 0 && exitPrice !== null && exitPrice > 0
      ? calcPnl({ direction, entryPrice: num(entry), exitPrice, quantity: num(qty), fees: feesN })
      : null

  const save = async () => {
    if (!asset.trim()) return setError('Enter the asset or pair, for example XAUUSD.')
    if (!(num(entry) > 0)) return setError('Entry price must be a number above 0.')
    if (exitPrice !== null && !(exitPrice > 0)) return setError('Exit price must be a number above 0, or left empty if the trade is open.')
    if (!(num(qty) > 0)) return setError('Size must be a number above 0.')
    if (!(feesN >= 0)) return setError('Fees must be 0 or more.')
    try {
      const input = { date, asset, direction, entryPrice: num(entry), exitPrice, quantity: num(qty),
        fees: feesN, notes, tags: addTag(tags, tagInput) }
      if (trade) await window.api.trades.update(trade.id, input)
      else await window.api.trades.create(input)
      onSaved()
    } catch {
      setError('Could not save this trade. Check the date and try again.')
    }
  }

  const remove = async () => {
    if (!trade) return
    await window.api.trades.remove(trade.id)
    onSaved()
  }

  // Escape closes, Ctrl+Enter saves.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
      if (e.key === 'Enter' && e.ctrlKey) { e.preventDefault(); save() }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  const numberField = (label: string, value: string, set: (v: string) => void, placeholder = '') => (
    <label className="text-xs text-muted">{label}
      <input type="number" step="any" min="0" inputMode="decimal" className="field mt-1" value={value}
        placeholder={placeholder} onChange={(e) => { set(e.target.value); setError('') }} />
    </label>
  )

  return (
    <div className="scrim fixed inset-0 z-10 flex justify-end" onMouseDown={onClose}>
      <aside onMouseDown={(e) => e.stopPropagation()}
        className="flex h-full w-[min(34rem,100%)] flex-col gap-4 overflow-y-auto border-l border-line bg-panel p-6 shadow-card">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">{trade ? 'Edit trade' : 'New trade'}</h2>
          <button className="btn-icon" onClick={onClose} aria-label="Close">
            <X size={18} />
          </button>
        </div>

        <div className="flex gap-3">
          <label className="w-44 shrink-0 text-xs text-muted">Date
            <input type="date" className="field mt-1" value={date} onChange={(e) => setDate(e.target.value)} />
          </label>
          <label className="flex-1 text-xs text-muted">Asset / pair
            <input list="known-assets" className="field mt-1 uppercase" value={asset} placeholder="XAUUSD" autoFocus
              onChange={(e) => { setAsset(e.target.value); setError('') }} />
            <datalist id="known-assets">{assets.map((a) => <option key={a} value={a} />)}</datalist>
          </label>
        </div>

        <div>
          <div className="text-xs text-muted">Direction</div>
          <div className="mt-1 inline-flex rounded-xl border border-line p-1">
            {(['long', 'short'] as Direction[]).map((d) => (
              <button key={d} onClick={() => setDirection(d)} aria-pressed={direction === d}
                className={`rounded-lg px-5 py-1.5 text-sm capitalize ${
                  direction === d ? (d === 'long' ? 'bg-pos text-bg' : 'bg-neg text-bg') : 'text-muted hover:text-fg'}`}>
                {d}
              </button>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          {numberField('Entry price', entry, setEntry)}
          {numberField('Exit price', exit, setExit, 'Empty if still open')}
          {numberField('Size', qty, setQty)}
          {numberField('Fees (total)', fees, setFees, '0')}
        </div>

        <div className="rounded-xl border border-line bg-bg px-4 py-3 text-sm">
          <span className="text-muted">Profit / loss: </span>
          {preview !== null
            ? <span className={`font-medium tabular-nums ${pnlColor(preview)}`}>{fmtPnl(preview)}</span>
            : <span className="text-muted">{exitPrice === null ? 'Open trade, no result yet' : 'Fill in the numbers above'}</span>}
        </div>

        <TagInput tags={tags} onTagsChange={setTags} input={tagInput} onInputChange={setTagInput} suggestions={knownTags} />

        <label className="flex min-h-[6rem] flex-1 flex-col text-xs text-muted">Notes
          <textarea className="field mt-1 flex-1 resize-none leading-relaxed" value={notes}
            placeholder="Why did you take this trade? What did you learn?" onChange={(e) => setNotes(e.target.value)} />
        </label>

        {error && <p className="text-sm text-neg">{error}</p>}

        <div className="flex items-center gap-2">
          {trade && !confirmDelete && <button className="btn text-neg" onClick={() => setConfirmDelete(true)}>Delete</button>}
          {trade && confirmDelete && (
            <>
              <button className="btn-danger" onClick={remove}>Yes, delete</button>
              <button className="btn" onClick={() => setConfirmDelete(false)}>Keep it</button>
            </>
          )}
          <span className="ml-auto text-xs text-muted">Ctrl+Enter to save</span>
          <button className="btn-primary" onClick={save}>Save trade</button>
        </div>
      </aside>
    </div>
  )
}
