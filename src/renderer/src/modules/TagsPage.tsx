// Tags page (Phase 2, Utilities): every tag with counts per tool. Pick a tag to
// see the live items carrying it, grouped by tool; rename, merge, recolour or
// delete it (which only removes the tag from items, never the items).
//
// Tags are stored in two places in this app (JSON columns on journal entries,
// trades and tasks; the `taggings` table for goals, notes and content), so the
// service merges both — the page stays uninvolved in that.
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Tags as TagsIcon } from 'lucide-react'
import type { ModuleProps } from '../../../renderer/src/lib/navigation'
import type { TagCountEntry } from '../../../shared/types'
import type { TagEntityType } from '../../../shared/tags'
import { PageHeader } from '../../../renderer/src/components/PageHeader'
import { EmptyState } from '../../../renderer/src/components/EmptyState'
import { TagChip } from '../../../renderer/src/components/TagChip'
import { errMsg } from '../../../renderer/src/lib/errors'
import { useRefreshOnCapture } from '../../../renderer/src/lib/dataChanged'
import { normalizeTagName } from '../../../shared/tags'

interface TaggedItem { type: TagEntityType; id: number; label: string; sublabel?: string }

const TOOL_LABEL: Record<TagEntityType, string> = {
  logbook: 'Journal',
  trade: 'Trades',
  goal: 'Savings goals',
  task: 'Tasks',
  note: 'Notes',
  content: 'Content'
}

const TOOL_ORDER: TagEntityType[] = ['logbook', 'trade', 'goal', 'task', 'note', 'content']

// A one-pixel SVG of the tag's own colour, used as a background image so the
// swatch shows the real colour without an inline colour style.
const swatch = (hex: string): string =>
  `url("data:image/svg+xml,${encodeURIComponent(`<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 1 1'><rect width='1' height='1' fill='${hex.replace(/'/g, '')}'/></svg>`)}")`

const total = (counts: Record<TagEntityType, number>): number => TOOL_ORDER.reduce((sum, t) => sum + counts[t], 0)

export function TagsPage({ onNavigate, onOpen }: ModuleProps) {
  const [entries, setEntries] = useState<TagCountEntry[]>([])
  const [selected, setSelected] = useState<string | null>(null)
  const [items, setItems] = useState<TaggedItem[]>([])
  const [loaded, setLoaded] = useState(false)
  const [error, setError] = useState('')
  const [note, setNote] = useState('')
  const [renaming, setRenaming] = useState<string | null>(null)
  const [renameText, setRenameText] = useState('')
  const [merging, setMerging] = useState(false)
  const [mergeInto, setMergeInto] = useState('')
  const [confirmDelete, setConfirmDelete] = useState(false)

  const refresh = useCallback(async () => {
    try {
      const list = await window.api.tags.counts()
      setEntries([...list].sort((a, b) => total(b.counts) - total(a.counts) || a.tag.name.localeCompare(b.tag.name)))
      setError('')
    } catch (e) {
      setError(errMsg(e))
    }
    setLoaded(true)
  }, [])

  useEffect(() => { void refresh() }, [refresh])
  useRefreshOnCapture(refresh)

  const loadItems = useCallback(async (name: string) => {
    try {
      setItems(await window.api.tags.items(name))
    } catch (e) {
      setError(errMsg(e))
    }
  }, [])

  useEffect(() => { if (selected) void loadItems(selected) }, [selected, loadItems])

  const grouped = useMemo(() => {
    const map = new Map<TagEntityType, TaggedItem[]>()
    for (const item of items) {
      const list = map.get(item.type) ?? []
      list.push(item)
      map.set(item.type, list)
    }
    return TOOL_ORDER.filter((t) => map.has(t)).map((t) => ({ type: t, items: map.get(t)! }))
  }, [items])

  const current = selected ? entries.find((e) => e.tag.name === selected) ?? null : null

  // ------------------------------------------------------------------ actions

  const rename = async () => {
    if (!selected) return
    const to = normalizeTagName(renameText)
    setError(''); setNote('')
    if (!to) { setError('Give the tag a name.'); return }
    if (to === selected) { setRenaming(null); return }
    try {
      await window.api.tags.rename(selected, to)
      setRenaming(null)
      setSelected(to)
      setNote(`Renamed to #${to} everywhere.`)
      await refresh()
      void loadItems(to)
      void window.api.capture.saved()
    } catch (e) {
      setError(errMsg(e))
    }
  }

  const merge = async () => {
    if (!selected || !mergeInto) return
    setError(''); setNote('')
    try {
      await window.api.tags.merge(selected, mergeInto)
      setMerging(false)
      setSelected(mergeInto)
      setNote(`Merged #${selected} into #${mergeInto}.`)
      await refresh()
      void loadItems(mergeInto)
      void window.api.capture.saved()
    } catch (e) {
      setError(errMsg(e))
    }
  }

  const remove = async () => {
    if (!selected) return
    setError(''); setNote('')
    try {
      const touched = await window.api.tags.delete(selected)
      setNote(`Removed #${selected} from ${touched} ${touched === 1 ? 'item' : 'items'}. The items themselves are untouched.`)
      setConfirmDelete(false)
      setSelected(null)
      setItems([])
      await refresh()
      void window.api.capture.saved()
    } catch (e) {
      setError(errMsg(e))
    }
  }

  const recolour = async (name: string, colour: string | null) => {
    try {
      await window.api.tags.setColour(name, colour)
      await refresh()
    } catch (e) {
      setError(errMsg(e))
    }
  }

  // Open an item in the tool that owns it.
  const openItem = async (item: TaggedItem) => {
    if (item.type === 'logbook') {
      const entry = await window.api.logbook.list({ text: '' }).then((list) => list.find((e) => e.id === item.id))
      if (entry) onOpen({ module: 'logbook', entry })
      return
    }
    if (item.type === 'trade') {
      const trade = await window.api.trades.list({}).then((list) => list.find((t) => t.id === item.id))
      if (trade) onOpen({ module: 'trades', trade })
      return
    }
    if (item.type === 'task') {
      const task = await window.api.tasks.list({ view: 'all' }).then((list) => list.find((t) => t.id === item.id))
      if (task) onOpen({ module: 'tasks', task })
      return
    }
    if (item.type === 'goal') { onOpen({ module: 'savings', goalId: item.id }); return }
    if (item.type === 'note') { onNavigate('notes'); return }
    if (item.type === 'content') { onNavigate('content'); return }
  }

  return (
    <div className="page">
      <PageHeader title="Tags" subtitle="Every tag in one place, across every tool. Renaming or merging applies everywhere." />
      {error && <p role="alert" className="mb-3 text-sm text-neg">{error}</p>}
      {note && <p role="status" className="mb-3 text-sm text-muted">{note}</p>}

      {loaded && entries.length === 0 ? (
        <EmptyState icon={TagsIcon} title="No tags yet"
          text="Add a tag to a journal entry, a trade, a task or a note and it appears here, with counts for every tool." />
      ) : (
        <div className="grid gap-4 lg:grid-cols-[22rem_minmax(0,1fr)]">
          <section className="card card-pad-lg">
            <h2 className="section-title">All tags <span className="meta">({entries.length})</span></h2>
            <ul className="mt-3 flex flex-col divide-y divide-line/60">
              {entries.map((e) => {
                const n = total(e.counts)
                return (
                  <li key={e.tag.id}>
                    <button
                      onClick={() => { setSelected(e.tag.name); setRenaming(null); setMerging(false); setConfirmDelete(false); setNote('') }}
                      aria-current={selected === e.tag.name ? 'true' : undefined}
                      className={`flex w-full items-center justify-between gap-2 rounded-lg px-2 py-2 text-left ${selected === e.tag.name ? 'bg-accent/10' : 'hover:bg-fg/5'}`}
                    >
                      <span className="min-w-0"><TagChip tag={e.tag.name} /></span>
                      <span className="shrink-0 num text-xs text-muted">{n}</span>
                    </button>
                  </li>
                )
              })}
            </ul>
          </section>

          <section className="card card-pad-lg">
            {!current ? (
              <EmptyState compact icon={TagsIcon} title="Pick a tag" text="Its items appear here, grouped by tool, with rename, merge, colour and delete." />
            ) : (
              <div className="flex flex-col gap-4">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <h2 className="text-lg font-semibold"><TagChip tag={current.tag.name} /></h2>
                    <p className="meta mt-1">
                      {TOOL_ORDER.filter((t) => current.counts[t] > 0).map((t) => {
                        const n = current.counts[t]
                        return `${n} ${n === 1 ? TOOL_LABEL[t].replace(/s$/, '').toLowerCase() : TOOL_LABEL[t].toLowerCase()}`
                      }).join(' · ') || 'Not used anywhere right now'}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button className="btn btn-sm" onClick={() => { setRenaming(current.tag.name); setRenameText(current.tag.name); setMerging(false); setConfirmDelete(false) }}>Rename</button>
                    <button className="btn btn-sm" onClick={() => { setMerging(true); setRenaming(null); setMergeInto(''); setConfirmDelete(false) }}>Merge</button>
                    <button className="btn btn-sm text-neg" onClick={() => { setConfirmDelete(true); setRenaming(null); setMerging(false) }}>Delete</button>
                  </div>
                </div>

                {renaming !== null && (
                  <form className="flex flex-wrap items-end gap-2" onSubmit={(e) => { e.preventDefault(); void rename() }}>
                    <label className="block text-xs text-muted">New name
                      <input className="field mt-1" autoFocus value={renameText} onChange={(e) => setRenameText(e.target.value)} aria-label="New tag name" />
                    </label>
                    <button className="btn-primary btn-sm" type="submit">Rename everywhere</button>
                    <button className="btn btn-sm" type="button" onClick={() => setRenaming(null)}>Cancel</button>
                  </form>
                )}

                {merging && (
                  <form className="flex flex-wrap items-end gap-2" onSubmit={(e) => { e.preventDefault(); void merge() }}>
                    <label className="block text-xs text-muted">Merge #{current.tag.name} into
                      <select className="field mt-1" value={mergeInto} onChange={(e) => setMergeInto(e.target.value)} aria-label="Tag to merge into">
                        <option value="">Pick a tag…</option>
                        {entries.filter((e) => e.tag.name !== current.tag.name).map((e) => (
                          <option key={e.tag.id} value={e.tag.name}>{e.tag.name}</option>
                        ))}
                      </select>
                    </label>
                    <button className="btn-primary btn-sm" type="submit" disabled={!mergeInto}>Merge</button>
                    <button className="btn btn-sm" type="button" onClick={() => setMerging(false)}>Cancel</button>
                  </form>
                )}

                {confirmDelete && (
                  <div className="rounded-xl border border-line p-3 text-sm">
                    <p>Remove <strong>#{current.tag.name}</strong> from every item?</p>
                    <p className="meta mt-1">The items stay exactly as they are — only the tag goes.</p>
                    <div className="mt-3 flex gap-2">
                      <button className="btn-danger btn-sm" onClick={() => void remove()}>Remove the tag</button>
                      <button className="btn btn-sm" onClick={() => setConfirmDelete(false)}>Keep it</button>
                    </div>
                  </div>
                )}

                <div>
                  <h3 className="section-title">Colour</h3>
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    {/* The swatch colour is the tag's stored value (data, not a design
                        token), so it is drawn as a data-URI fill - an inline style
                        colour would be a hardcoded colour, which the UI rules forbid. */}
                    {[null, '#ef4444', '#f97316', '#eab308', '#10b981', '#3b82f6', '#8b5cf6', '#ec4899'].map((c) => (
                      <button key={c ?? 'default'} onClick={() => void recolour(current.tag.name, c)}
                        aria-label={c === null ? `Default colour for ${current.tag.name}` : `Colour ${c}`}
                        title={c ?? 'Default'}
                        aria-pressed={(current.tag.colour ?? null) === c}
                        className={`h-6 w-6 rounded-full border border-line bg-accent ${(current.tag.colour ?? null) === c ? 'ring-2 ring-fg ring-offset-2 ring-offset-card' : ''}`}
                        data-colour={c ?? 'default'}>
                        {c !== null && <span className="block h-full w-full rounded-full" style={{ backgroundImage: swatch(c) }} />}
                        {c === null && <span className="sr-only">Default colour</span>}
                      </button>
                    ))}
                    <span className="meta">A colour set here is used wherever the tag is shown.</span>
                  </div>
                </div>

                <div>
                  <h3 className="section-title">Items</h3>
                  {grouped.length === 0 ? (
                    <p className="mt-2 text-sm text-muted">Nothing carries this tag right now.</p>
                  ) : (
                    grouped.map((group) => (
                      <div key={group.type} className="mt-3">
                        <h4 className="meta uppercase tracking-wide">{TOOL_LABEL[group.type]}</h4>
                        <ul className="mt-1 flex flex-col divide-y divide-line/60">
                          {group.items.map((item) => (
                            <li key={`${item.type}-${item.id}`} className="flex items-center justify-between gap-2 py-2">
                              <span className="min-w-0">
                                <span className="block truncate text-sm">{item.label || 'Untitled'}</span>
                                {item.sublabel && <span className="meta">{item.sublabel}</span>}
                              </span>
                              <button className="btn btn-sm" onClick={() => void openItem(item)}>Open</button>
                            </li>
                          ))}
                        </ul>
                      </div>
                    ))
                  )}
                </div>
              </div>
            )}
          </section>
        </div>
      )}
    </div>
  )
}
