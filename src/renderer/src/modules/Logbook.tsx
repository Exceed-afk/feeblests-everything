import { useCallback, useEffect, useState } from 'react'
import { Plus, Search } from 'lucide-react'
import type { LogEntry, LogFilter, TagCount } from '../../../shared/types'
import { MOOD_STYLE } from '../lib/moods'
import { formatDate } from '../lib/dates'
import type { ModuleProps } from '../lib/navigation'
import { EntryEditor } from './EntryEditor'
import { TagChip } from '../components/TagChip'

export function Logbook({ target, onTargetHandled }: ModuleProps) {
  const [entries, setEntries] = useState<LogEntry[]>([])
  const [tags, setTags] = useState<TagCount[]>([])
  const [filter, setFilter] = useState<LogFilter>({})
  const [editing, setEditing] = useState<LogEntry | 'new' | null>(null)
  const [loaded, setLoaded] = useState(false)

  const hasFilter = Boolean(filter.text || filter.tag || filter.from || filter.to)
  const setF = (patch: LogFilter) => setFilter({ ...filter, ...patch })

  const refresh = useCallback(async () => {
    const [e, t] = await Promise.all([window.api.logbook.list(filter), window.api.logbook.tags()])
    setEntries(e); setTags(t); setLoaded(true)
  }, [filter])

  // Re-run the query shortly after the filter changes (so typing feels smooth).
  useEffect(() => {
    const id = setTimeout(refresh, 150)
    return () => clearTimeout(id)
  }, [refresh])

  // Opened from Search: show that entry's editor straight away.
  useEffect(() => {
    if (target?.module === 'logbook') { setEditing(target.entry); onTargetHandled() }
  }, [target, onTargetHandled])

  // Ctrl+N starts a new entry.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.key.toLowerCase() === 'n') { e.preventDefault(); setEditing('new') }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  return (
    <div className="mx-auto max-w-3xl px-10 py-10">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Logbook</h1>
        <button className="btn-primary" onClick={() => setEditing('new')} title="Ctrl+N">
          <Plus size={16} /> New entry
        </button>
      </div>

      <div className="mt-6 flex flex-wrap items-center gap-2">
        <div className="relative min-w-[12rem] flex-1">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
          <input className="field pl-9" placeholder="Search your entries" value={filter.text ?? ''}
            onChange={(e) => setF({ text: e.target.value })} />
        </div>
        <select className="field w-40" value={filter.tag ?? ''} aria-label="Filter by tag"
          onChange={(e) => setF({ tag: e.target.value || undefined })}>
          <option value="">All tags</option>
          {tags.map((t) => <option key={t.tag} value={t.tag}>#{t.tag} ({t.count})</option>)}
        </select>
        <input type="date" className="field w-40" aria-label="From date" value={filter.from ?? ''}
          onChange={(e) => setF({ from: e.target.value || undefined })} />
        <input type="date" className="field w-40" aria-label="To date" value={filter.to ?? ''}
          onChange={(e) => setF({ to: e.target.value || undefined })} />
        {hasFilter && <button className="btn" onClick={() => setFilter({})}>Clear</button>}
      </div>

      <div className="mt-6 flex flex-col gap-3">
        {loaded && entries.length === 0 && (
          <div className="rounded-2xl border border-dashed border-line bg-card/50 p-10 text-center">
            {hasFilter ? (
              <p className="text-muted">No entries match these filters.</p>
            ) : (
              <>
                <p className="font-medium">Your logbook is empty, and that's a good place to start.</p>
                <p className="mt-1 text-sm text-muted">Write a line about today. Future you will be glad you did.</p>
                <button className="btn-primary mt-5" onClick={() => setEditing('new')}>
                  <Plus size={16} /> Write your first entry
                </button>
              </>
            )}
          </div>
        )}

        {entries.map((e) => (
          <article key={e.id} onClick={() => setEditing(e)} tabIndex={0}
            onKeyDown={(k) => k.key === 'Enter' && setEditing(e)}
            className="cursor-pointer rounded-2xl border border-line bg-card p-5 shadow-card hover:border-accent/50">
            <div className="flex items-center gap-2 text-xs text-muted">
              {e.mood && <span title={MOOD_STYLE[e.mood].label} className={`h-2.5 w-2.5 rounded-full ${MOOD_STYLE[e.mood].dot}`} />}
              {formatDate(e.date)}
            </div>
            <h2 className="mt-1 font-medium">{e.title}</h2>
            {e.body && <p className="mt-1 line-clamp-2 whitespace-pre-line text-sm text-muted">{e.body}</p>}
            {e.tags.length > 0 && (
              <div className="mt-3 flex flex-wrap gap-1.5">
                {e.tags.map((t) => (
                  <TagChip key={t} tag={t} onClick={(ev) => { ev.stopPropagation(); setF({ tag: t }) }} />
                ))}
              </div>
            )}
          </article>
        ))}
      </div>

      {editing && (
        <EntryEditor key={editing === 'new' ? 'new' : editing.id}
          entry={editing === 'new' ? null : editing} knownTags={tags.map((t) => t.tag)}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); refresh() }} />
      )}
    </div>
  )
}
