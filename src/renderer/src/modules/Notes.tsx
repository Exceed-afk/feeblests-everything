// Notes (Phase 2): undated markdown material, with tags, pins, an archive,
// checklists, [[wiki links]] and templates.
//
// The list is on the left, the editor on the right. Edits autosave, debounced,
// and the preview renders live next to the text. Everything is keyboard
// reachable: Ctrl+N new, Ctrl+E toggle preview, Esc leaves the fields.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Archive, ArchiveRestore, CheckSquare, Link2, Pin, Plus, Search, StickyNote, Trash2 } from 'lucide-react'
import type { ModuleProps } from '../../../renderer/src/lib/navigation'
import type { Template } from '../../../shared/types'
import type { NoteDTO as Note } from '../../../shared/notesBridge'
import { PageHeader } from '../../../renderer/src/components/PageHeader'
import { EmptyState } from '../../../renderer/src/components/EmptyState'
import { MarkdownView } from '../../../renderer/src/components/MarkdownView'
import { TagInput } from '../../../renderer/src/components/TagInput'
import { LinkedItems } from '../../../renderer/src/components/LinkedItems'
import { errMsg } from '../../../renderer/src/lib/errors'
import { today } from '../../../renderer/src/lib/dates'
import { useRefreshOnCapture } from '../../../renderer/src/lib/dataChanged'
import { noteUndoableDelete } from '../../../renderer/src/lib/undo'
import { renderTemplate } from '../../../shared/templates'
import { findChecklistItems, findHashtags, setChecklistItemDone, wordCount } from '../../../shared/markdown'
import { deriveTitle } from '../../../shared/notes'

type Mode = 'live' | 'edit' | 'preview'

interface Draft {
  title: string
  body: string
  tags: string[]
  pinned: boolean
  archived: boolean
}


const toDraft = (n: Note): Draft => ({ title: n.title, body: n.body, tags: n.tags, pinned: n.pinned, archived: n.archived })

export function Notes({ onNavigate }: ModuleProps) {
  const [notes, setNotes] = useState<Note[]>([])
  const [templates, setTemplates] = useState<Template[]>([])
  const [knownTags, setKnownTags] = useState<string[]>([])
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [showArchive, setShowArchive] = useState(false)
  const [search, setSearch] = useState('')
  const [tagFilter, setTagFilter] = useState('')
  const [loaded, setLoaded] = useState(false)
  const [error, setError] = useState('')
  const [mode, setMode] = useState<Mode>('live')

  const refresh = useCallback(async () => {
    try {
      const [list, tagRows] = await Promise.all([
        window.api.notes.list({ archived: showArchive }),
        window.api.tags.list()
      ])
      setNotes(list)
      setKnownTags(tagRows.map((t) => t.name))
      setError('')
    } catch (e) {
      setError(errMsg(e))
    }
    setLoaded(true)
  }, [showArchive])

  useEffect(() => { void refresh() }, [refresh])
  useRefreshOnCapture(refresh)

  useEffect(() => {
    window.api.templates.list('note').then(setTemplates).catch(() => setTemplates([]))
  }, [])

  // Ctrl+N: a new note. Ctrl+E: cycle the editor layout.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey) return
      const key = e.key.toLowerCase()
      if (key === 'n') { e.preventDefault(); createNote() }
      if (key === 'e') { e.preventDefault(); setMode((m) => (m === 'live' ? 'edit' : m === 'edit' ? 'preview' : 'live')) }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const createNote = async (payload?: { title?: string; body?: string }) => {
    try {
      const created = await window.api.notes.create({
        title: payload?.title ?? '', body: payload?.body ?? '', tags: [], pinned: false, archived: false
      })
      setShowArchive(false)
      await refresh()
      setSelectedId(created.id)
    } catch (e) {
      setError(errMsg(e))
    }
  }

  const useTemplate = async (t: Template) => {
    const vars = { date: today(), weekday: new Date().toLocaleDateString(undefined, { weekday: 'long' }), time: '' }
    const payload = renderTemplate(t.payload, vars) as { title?: string; body?: string }
    await createNote({ title: payload.title ?? '', body: payload.body ?? '' })
  }

  const visible = useMemo(() => {
    const needle = search.trim().toLowerCase()
    return notes.filter((n) => {
      if (tagFilter && !n.tags.includes(tagFilter)) return false
      if (!needle) return true
      return n.title.toLowerCase().includes(needle) || n.body.toLowerCase().includes(needle) || n.tags.some((t) => t.includes(needle))
    })
  }, [notes, search, tagFilter])

  const selected = notes.find((n) => n.id === selectedId) ?? null

  return (
    <div className="page">
      <PageHeader
        title="Notes"
        subtitle="Undated material: ideas, reference, meeting notes and checklists. The Logbook stays your dated journal."
      >
        <div className="seg" role="group" aria-label="Editor layout">
          <button aria-pressed={mode === 'live'} onClick={() => setMode('live')} title="Ctrl+E">Split</button>
          <button aria-pressed={mode === 'edit'} onClick={() => setMode('edit')}>Write</button>
          <button aria-pressed={mode === 'preview'} onClick={() => setMode('preview')}>Read</button>
        </div>
        <button className="btn-primary" onClick={() => void createNote()} title="Ctrl+N">
          <Plus size={16} aria-hidden="true" /> New note
        </button>
      </PageHeader>

      {error && <p role="alert" className="mb-3 text-sm text-neg">{error}</p>}

      {loaded && notes.length === 0 && !showArchive && search === '' ? (
        <>
          <EmptyState
            icon={StickyNote}
            title="Your first note starts here"
            text="Notes hold anything without a date: video ideas, meeting notes, checklists. Type [[Another note]] to link notes together."
            action={<button className="btn-primary" onClick={() => void createNote()}><Plus size={16} aria-hidden="true" /> Create a note</button>}
          />
          {templates.length > 0 && (
            <section className="mt-5">
              <h2 className="section-title">Start from a template</h2>
              <div className="mt-3 flex flex-wrap gap-2">
                {templates.map((t) => (
                  <button key={t.id} className="btn" onClick={() => void useTemplate(t)}>{t.name}</button>
                ))}
              </div>
            </section>
          )}
        </>
      ) : (
        <div className="grid gap-4 lg:grid-cols-[18rem_minmax(0,1fr)]">
          {/* ---------------- list ---------------- */}
          <aside className="min-w-0">
            <div className="relative">
              <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" aria-hidden="true" />
              <input className="field pl-9" placeholder="Search notes" aria-label="Search notes"
                value={search} onChange={(e) => setSearch(e.target.value)} />
            </div>

            <div className="mt-2 flex flex-wrap items-center gap-2">
              <button className="btn btn-sm" aria-pressed={!showArchive} onClick={() => { setShowArchive(false); setSelectedId(null) }}>
                Notes
              </button>
              <button className="btn btn-sm" aria-pressed={showArchive} onClick={() => { setShowArchive(true); setSelectedId(null) }}>
                <Archive size={13} aria-hidden="true" /> Archive
              </button>
              {tagFilter && (
                <button className="btn btn-sm" onClick={() => setTagFilter('')}>#{tagFilter} ✕</button>
              )}
            </div>

            {knownTags.length > 0 && (
              <label className="mt-2 block text-xs text-muted">Filter by tag
                <select className="field mt-1" value={tagFilter} onChange={(e) => setTagFilter(e.target.value)}>
                  <option value="">All tags</option>
                  {knownTags.map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
              </label>
            )}

            <ul className="mt-3 flex max-h-[calc(100vh-19rem)] flex-col gap-1.5 overflow-y-auto pr-1">
              {visible.map((n) => (
                <li key={n.id}>
                  <button
                    onClick={() => setSelectedId(n.id)}
                    aria-current={n.id === selectedId ? 'true' : undefined}
                    className={`w-full rounded-xl border px-3 py-2 text-left ${n.id === selectedId ? 'border-accent bg-accent/10' : 'border-line hover:border-fg/20'}`}
                  >
                    <span className="flex items-center gap-1.5">
                      {n.pinned && <Pin size={12} className="shrink-0 text-accent" aria-label="Pinned" />}
                      <span className="truncate text-sm font-medium">{n.title || 'Untitled note'}</span>
                    </span>
                    <span className="meta block truncate">
                      {(n.checklistTotal ?? 0) > 0 && `${n.checklistDone}/${n.checklistTotal} done · `}
                      {n.wordCount ?? 0} words
                      {n.tags.length > 0 && ` · ${n.tags.map((t) => `#${t}`).join(' ')}`}
                    </span>
                  </button>
                </li>
              ))}
              {visible.length === 0 && <li className="meta px-1 py-2">No notes match.</li>}
            </ul>
          </aside>

          {/* ---------------- editor ---------------- */}
          <section className="min-w-0">
            {selected ? (
              <NoteEditor
                key={selected.id}
                note={selected}
                mode={mode}
                knownTags={knownTags}
                onSaved={(fresh) => setNotes((list) => list.map((n) => (n.id === fresh.id ? fresh : n)))}
                onDeleted={async () => { setSelectedId(null); await refresh() }}
                onOpenNote={async (title) => {
                  const found = await window.api.notes.findByTitle(title)
                  if (found) {
                    setShowArchive(false)
                    await refresh()
                    setSelectedId(found.id)
                  } else {
                    await createNote({ title })
                  }
                }}
                onNavigate={onNavigate}
                onError={setError}
              />
            ) : (
              <div className="card card-pad-lg">
                <EmptyState icon={StickyNote} title="Pick a note or start a new one"
                  text="Notes autosave as you type. Use #tags to organise them and [[Links]] to connect them." />
              </div>
            )}
          </section>
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------

function NoteEditor({ note, mode, knownTags, onSaved, onDeleted, onOpenNote, onNavigate, onError }: {
  note: Note
  mode: Mode
  knownTags: string[]
  onSaved: (note: Note) => void
  onDeleted: () => Promise<void>
  onOpenNote: (title: string) => Promise<void>
  onNavigate: (where: string) => void
  onError: (message: string) => void
}) {
  const [draft, setDraft] = useState<Draft>(toDraft(note))
  const [tagInput, setTagInput] = useState('')
  const [saving, setSaving] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const [backlinks, setBacklinks] = useState<Note[]>([])
  const [confirmDelete, setConfirmDelete] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const isDeleted = useRef(false)
  const latest = useRef<Draft>(draft)
  latest.current = draft

  const save = useCallback(async (next: Draft) => {
    if (isDeleted.current) return
    setSaving('saving')
    try {
      const saved = await window.api.notes.update(note.id, {
        title: next.title,
        body: next.body,
        tags: next.tags,
        pinned: next.pinned,
        archived: next.archived
      })
      if (!isDeleted.current) {
        onSaved(saved)
        setSaving('saved')
      }
    } catch (e) {
      if (!isDeleted.current) {
        setSaving('error')
        onError(errMsg(e))
      }
    }
  }, [note.id, onSaved, onError])

  // Debounced autosave: the DB is the truth, so nothing is held only in memory.
  const update = (patch: Partial<Draft>) => {
    if (isDeleted.current) return
    setDraft((current) => {
      const next = { ...current, ...patch }
      if (timer.current) clearTimeout(timer.current)
      timer.current = setTimeout(() => void save(next), 600)
      return next
    })
  }

  // Flush a pending save when the note changes or the page goes away.
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current)
    if (!isDeleted.current) {
      void save(latest.current)
    }
  }, [save])

  useEffect(() => {
    let alive = true
    window.api.notes.backlinks(note.id).then((list) => { if (alive) setBacklinks(list) }).catch(() => { })
    return () => { alive = false }
  }, [note.id, note.body])

  const checks = useMemo(() => findChecklistItems(draft.body), [draft.body])
  const hashtags = useMemo(() => findHashtags(draft.body), [draft.body])

  const sendToTasks = async (text: string) => {
    try {
      await window.api.tasks.create({
        title: text, notes: `From note: [[${note.title}]]`, status: 'todo', priority: 'medium',
        dueDate: null, dueTime: null, project: null, tags: draft.tags, subtasks: [], recurrenceRule: null, recurrenceNext: null
      })
      onError('')
    } catch (e) {
      onError(errMsg(e))
    }
  }

  const toggleCheck = (index: number, done: boolean) => update({ body: setChecklistItemDone(draft.body, index, done) })

  const remove = async () => {
    isDeleted.current = true
    if (timer.current) clearTimeout(timer.current)
    try {
      const batch = await window.api.notes.remove(note.id)
      noteUndoableDelete({ label: `note "${note.title}"`, batchId: batch })
      await onDeleted()
    } catch (e) {
      isDeleted.current = false
      onError(errMsg(e))
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="card card-pad-lg">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <input
            className="min-w-0 flex-1 bg-transparent text-lg font-semibold outline-none"
            aria-label="Note title"
            placeholder="Note title"
            value={draft.title}
            onChange={(e) => update({ title: e.target.value })}
            onBlur={() => { if (!draft.title.trim()) update({ title: deriveTitle(draft.body) }) }}
          />
          <div className="flex shrink-0 items-center gap-1">
            <button
              aria-pressed={draft.pinned}
              aria-label={draft.pinned ? 'Unpin note' : 'Pin note'}
              onClick={() => update({ pinned: !draft.pinned })}
              className={draft.pinned ? 'btn-icon text-accent' : 'btn-icon'}
            >
              <Pin size={15} aria-hidden="true" />
            </button>
            <button className="btn-icon" aria-label={draft.archived ? 'Unarchive note' : 'Archive note'}
              onClick={() => update({ archived: !draft.archived })}>
              {draft.archived ? <ArchiveRestore size={15} aria-hidden="true" /> : <Archive size={15} aria-hidden="true" />}
            </button>
            {confirmDelete ? (
              <>
                <button className="btn-danger btn-sm" onClick={() => void remove()}>Delete</button>
                <button className="btn btn-sm" onClick={() => setConfirmDelete(false)}>Keep</button>
              </>
            ) : (
              <button className="btn-icon hover:text-neg" aria-label="Delete note" onClick={() => setConfirmDelete(true)}>
                <Trash2 size={15} aria-hidden="true" />
              </button>
            )}
          </div>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
          <span className="num">{wordCount(draft.body)} words</span>
          {checks.length > 0 && <span>{checks.filter((c) => c.done).length}/{checks.length} checked</span>}
          <span aria-live="polite">
            {saving === 'saving' ? 'Saving…' : saving === 'saved' ? 'Saved' : saving === 'error' ? 'Not saved' : ''}
          </span>
        </div>

        <div className="mt-3">
          <TagInput
            tags={draft.tags}
            onTagsChange={(tags) => update({ tags })}
            input={tagInput}
            onInputChange={setTagInput}
            suggestions={knownTags.filter((t) => !draft.tags.includes(t))}
          />
          {hashtags.length > 0 && (
            <p className="meta mt-1">Found in the text: {hashtags.map((t) => `#${t}`).join(' ')}</p>
          )}
        </div>
      </div>

      <div className={`grid gap-3 ${mode === 'live' ? 'lg:grid-cols-2' : ''}`}>
        {mode !== 'preview' && (
          <label className="flex flex-col text-xs text-muted">
            Markdown
            <textarea
              className="field mt-1 min-h-[22rem] flex-1 resize-y font-mono text-sm leading-relaxed"
              value={draft.body}
              placeholder="# Heading&#10;&#10;Text, **bold**, `code`, - lists, - [ ] checklists&#10;Link to another note with [[Its title]]."
              onChange={(e) => update({ body: e.target.value, tags: mergeBodyTags(draft.tags, findHashtags(e.target.value)) })}
              onKeyDown={(e) => {
                if (e.key === 'Tab') {
                  e.preventDefault()
                  const el = e.currentTarget
                  const start = el.selectionStart
                  update({ body: `${draft.body.slice(0, start)}  ${draft.body.slice(el.selectionEnd)}` })
                  requestAnimationFrame(() => el.setSelectionRange(start + 2, start + 2))
                }
              }}
            />
          </label>
        )}
        {mode !== 'edit' && (
          <div className="card card-pad min-h-[22rem] overflow-x-auto">
            {draft.body.trim() ? (
              <MarkdownView markdown={draft.body} onOpenNote={(title) => void onOpenNote(title)} />
            ) : (
              <p className="text-sm text-muted">The preview appears here as you type.</p>
            )}
          </div>
        )}
      </div>

      {checks.length > 0 && (
        <section className="card card-pad-lg">
          <h2 className="section-title"><CheckSquare size={14} aria-hidden="true" /> Checklist</h2>
          <p className="meta mt-1">Tick here, or send an item to Tasks.</p>
          <ul className="mt-3 flex flex-col divide-y divide-line/60">
            {checks.map((item, index) => (
              <li key={`${index}-${item.text}`} className="flex items-center gap-2 py-2">
                <input type="checkbox" checked={item.done} onChange={(e) => toggleCheck(index, e.target.checked)}
                  aria-label={item.text} />
                <span className={`min-w-0 flex-1 text-sm ${item.done ? 'text-muted line-through' : ''}`}>{item.text}</span>
                <button className="btn btn-sm" onClick={() => void sendToTasks(item.text)}>Send to Tasks</button>
              </li>
            ))}
          </ul>
        </section>
      )}

      <LinkedItems type="note" id={note.id} />

      <section className="card card-pad-lg">
        <h2 className="section-title"><Link2 size={14} aria-hidden="true" /> Backlinks</h2>
        {backlinks.length === 0 ? (
          <p className="mt-2 text-sm text-muted">No other note links here yet. Type [[{note.title}]] in another note and it appears here.</p>
        ) : (
          <ul className="mt-3 flex flex-col divide-y divide-line/60">
            {backlinks.map((b) => (
              <li key={b.id} className="py-2">
                <button className="text-sm underline-offset-2 hover:underline" onClick={() => void onOpenNote(b.title)}>{b.title}</button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <p className="meta">
        Tip: the Logbook can turn any journal entry into a note — and you can send this note to the Logbook from{' '}
        <button className="underline" onClick={() => onNavigate('logbook')}>Logbook</button>.
      </p>
    </div>
  )
}

function mergeBodyTags(tags: string[], fromBody: string[]): string[] {
  const out = [...tags]
  for (const t of fromBody) if (!out.includes(t)) out.push(t)
  return out
}


