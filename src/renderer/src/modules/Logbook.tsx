import { useCallback, useEffect, useState } from 'react'
import { useRefreshOnCapture } from '../lib/dataChanged'
import { BookOpen, Plus, Search } from 'lucide-react'
import type { LogEntry, LogFilter, TagCount } from '../../../shared/types'
import { moodStyle } from '../lib/moods'
import { formatDate } from '../lib/dates'
import type { ModuleProps } from '../lib/navigation'
import { EntryEditor } from './EntryEditor'
import { TagChip } from '../components/TagChip'
import { PageHeader } from '../components/PageHeader'
import { EmptyState } from '../components/EmptyState'

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

  useRefreshOnCapture(refresh) // something was saved from the Quick capture window

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
    <div className="page page-sm">
      <PageHeader title="Logbook" subtitle={loaded && entries.length > 0 ? `${entries.length} ${entries.length === 1 ? 'entry' : 'entries'}${hasFilter ? ' match' : ''}` : 'A line a day is plenty.'}>
        <button className="btn-primary" onClick={() => setEditing('new')} title="Ctrl+N">
          <Plus size={16} /> New entry
        </button>
      </PageHeader>

      <div className="flex flex-wrap items-center gap-2">
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

      <div className="mt-5 flex flex-col gap-3">
        {loaded && entries.length === 0 && (hasFilter ? (
          <EmptyState title="No entries match these filters" text="Try a different word or clear the filters."
            action={<button className="btn mt-4" onClick={() => setFilter({})}>Clear filters</button>} />
        ) : (
          <EmptyState icon={BookOpen} title="Your logbook is empty, and that's a good place to start."
            text="Write a line about today. Future you will be glad you did."
            action={<button className="btn-primary" onClick={() => setEditing('new')}><Plus size={16} /> Write your first entry</button>} />
        ))}

        {entries.map((e) => (
          <article key={e.id} onClick={() => setEditing(e)} tabIndex={0}
            onKeyDown={(k) => k.key === 'Enter' && setEditing(e)}
            className="card card-pad card-interactive">
            <div className="meta flex items-center gap-2">
              {e.mood && <span title={moodStyle(e.mood).label} className={`h-2.5 w-2.5 rounded-full ${moodStyle(e.mood).dot}`} />}
              {formatDate(e.date)}
              {e.mood && <span>{moodStyle(e.mood).label}</span>}
            </div>
            <h2 className="mt-1 font-semibold">{e.title}</h2>
            {e.body && <p className="mt-1 line-clamp-2 whitespace-pre-line text-sm leading-relaxed text-muted">{e.body}</p>}
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
