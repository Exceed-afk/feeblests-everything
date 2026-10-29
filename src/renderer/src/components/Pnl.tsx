import { ArrowDownRight, ArrowUpRight } from 'lucide-react'
import { fmtPnl } from '../lib/format'

// A profit or loss figure. The sign and an arrow carry the meaning, so colour is never the only cue.
// `null` means the trade is still open.
export function Pnl({ value, open = 'Open' }: { value: number | null; open?: string }) {
  if (value === null) return <span className="text-muted">{open}</span>
  const cls = value > 0 ? 'pos' : value < 0 ? 'neg' : 'text-muted'
  return (
    <span className={`pnl ${cls}`}>
      {value > 0 ? <ArrowUpRight size={13} aria-hidden="true" /> : value < 0 ? <ArrowDownRight size={13} aria-hidden="true" /> : null}
      {fmtPnl(value)}
    </span>
  )
}
