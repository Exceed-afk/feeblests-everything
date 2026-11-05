// The item picker (Phase 0): a small palette-style dialog that finds an item
// with the shared search and returns it to the caller. Reuses the search
// groups' shapes; no new data paths. Keyboard first: type to search,
// Up/Down to move, Enter to pick, Esc to close.
import { useEffect, useRef, useState } from 'react'
import { Search, X } from 'lucide-react'
import type { LinkType } from '../../../shared/links'

export interface PickedItem { type: LinkType; id: number; label: string; sublabel?: string }

interface Props {
  title: string
  onPick: (item: PickedItem) => void
  onClose: () => void
}

// Flattens the search results into pickable rows, mapped to their link types.
// A logbook entry stays a logbook link; a savings transaction is deliberately
// not pickable (transactions link through their goal; see the assumptions in
// the Phase 0 report).
type SearchResults = Awaited<ReturnType<typeof window.api.search.run>>

interface Row { type: LinkType; id: number; label: string; sublabel?: string; group: string }

function collect(results: SearchResults): Row[] {
  const rows: Row[] = []
  for (const entry of results.logbook.items) rows.push({ type: 'logbook', id: entry.id, label: entry.title || 'Untitled', sublabel: entry.date, group: 'Journal' })
  for (const trade of results.trades.items) rows.push({ type: 'trade', id: trade.id, label: trade.asset, sublabel: `${trade.date} · ${trade.direction}`, group: 'Trades' })
  for (const goal of results.goals.items) rows.push({ type: 'goal', id: goal.id, label: goal.name, sublabel: 'Savings goal', group: 'Savings' })
  for (const task of results.tasks.items) rows.push({ type: 'task', id: task.id, label: task.title, sublabel: task.dueDate ?? undefined, group: 'Tasks' })
  // Phase 2/3: notes and content items are linkable too.
  for (const note of results.notes.items) rows.push({ type: 'note', id: note.id, label: note.title || 'Untitled note', sublabel: 'Note', group: 'Notes' })
  for (const item of results.content.items) rows.push({ type: 'content', id: item.id, label: item.title, sublabel: item.platform || item.stage, group: 'Content' })
  return rows
}

export function ItemPicker({ title, onPick, onClose }: Props) {
  const [text, setText] = useState('')
  const [rows, setRows] = useState<Row[]>([])
  const [cursor, setCursor] = useState(0)
  const input = useRef<HTMLInputElement>(null)

  useEffect(() => { input.current?.focus() }, [])

  useEffect(() => {
    const timer = setTimeout(async () => {
      const q = text.trim()
      if (!q) return setRows([])
      try {
        const results = await window.api.search.run(q, 6)
        setRows(collect(results))
        setCursor(0)
      } catch {
        setRows([])
      }
    }, 150)
    return () => clearTimeout(timer)
  }, [text])

  // Escape closes; typing filters; Up/Down move; Enter picks the highlighted row.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
      if (e.key === 'ArrowDown') { e.preventDefault(); setCursor((c) => Math.min(c + 1, Math.max(rows.length - 1, 0))) }
      if (e.key === 'ArrowUp') { e.preventDefault(); setCursor((c) => Math.max(c - 1, 0)) }
      if (e.key === 'Enter' && rows[cursor]) { e.preventDefault(); onPick(rows[cursor]) }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [rows, cursor, onPick, onClose])

  return (
    <div className="scrim fixed inset-0 z-30 flex items-start justify-center pt-24" onMouseDown={onClose}>
      <div role="dialog" aria-modal="true" aria-label={title} onMouseDown={(e) => e.stopPropagation()}
        className="w-[min(32rem,90%)] overflow-hidden rounded-2xl border border-line bg-panel shadow-card">
        <div className="relative flex items-center border-b border-line px-4 py-3">
          <Search size={15} className="mr-3 text-muted" />
          <input ref={input} className="min-w-0 flex-1 bg-transparent outline-none" placeholder="Find an item to link…"
            value={text} onChange={(e) => setText(e.target.value)} />
          <button className="btn-icon" onClick={onClose} aria-label="Close"><X size={16} /></button>
        </div>
        <ul className="max-h-[20rem] overflow-y-auto py-1">
          {rows.length === 0 && (
            <li className="px-4 py-6 text-center text-sm text-muted">{text.trim() ? 'Nothing matches that.' : 'Start typing to search everything.'}</li>
          )}
          {rows.map((row, index) => (
            <li key={`${row.type}-${row.id}`}>
              <button className={`flex w-full flex-col px-4 py-2 text-left ${index === cursor ? 'bg-accent/10' : 'hover:bg-accent/5'}`}
                onMouseEnter={() => setCursor(index)} onClick={() => onPick(row)}>
                <span className="text-sm font-medium">{row.label}</span>
                <span className="text-xs text-muted">{row.group}{row.sublabel ? ` · ${row.sublabel}` : ''}</span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}
