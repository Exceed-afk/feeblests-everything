// Settings > Templates (Phase 6): the manager for every kind of template.
//
// Covers journal entries, tasks (subtasks, default tags, priority, recurrence),
// notes, content stage checklists and trade checklists (pre-trade and
// post-trade).
//
// The engine and the templates are Phase 0's: this panel only lists, renames
// (save under a new name), edits trade checklists, removes user templates and
// restores the built-ins. "Save as template" inside an editor is unchanged;
// whatever it saved shows up here.
import { useCallback, useEffect, useRef, useState } from 'react'
import { Check, Pencil, RotateCcw, Trash2, X } from 'lucide-react'
import type { Template, TemplateKind } from '../../../shared/templates'
import { TEMPLATE_VARIABLES } from '../../../shared/templates'
import {
  TEMPLATE_KIND_LABELS, canRemoveTemplate, filledFields, groupTemplates, joinLines, splitLines, summaryOf, tradeChecklists
} from '../../../shared/templateManager'
import { errMsg } from '../lib/errors'
import { EmptyState } from '../components/EmptyState'

type Notice = { ok: boolean; text: string } | null

export function TemplatesSettings() {
  const [templates, setTemplates] = useState<Template[] | null>(null)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState<Notice>(null)
  const [busy, setBusy] = useState(false)
  const [editing, setEditing] = useState<number | null>(null)
  const [confirmRemove, setConfirmRemove] = useState<number | null>(null)

  const load = useCallback(() => {
    window.api.templates.list()
      .then((list) => { setTemplates(list); setError('') })
      .catch((e) => setError(errMsg(e)))
  }, [])
  useEffect(load, [load])

  const restore = async () => {
    setBusy(true); setNotice(null)
    try {
      setTemplates(await window.api.templates.restoreBuiltins())
      setNotice({ ok: true, text: 'The built-in templates are back. Your own templates were not touched.' })
    } catch (e) { setNotice({ ok: false, text: errMsg(e) }) }
    setBusy(false)
  }

  const remove = async (t: Template) => {
    setBusy(true); setNotice(null)
    try {
      await window.api.templates.remove(t.id)
      setTemplates((list) => (list ?? []).filter((x) => x.id !== t.id))
      setNotice({ ok: true, text: `"${t.name}" was removed. Items already made from it keep everything they copied.` })
    } catch (e) { setNotice({ ok: false, text: errMsg(e) }) }
    setBusy(false); setConfirmRemove(null)
  }

  const rename = async (t: Template, name: string) => {
    setBusy(true); setNotice(null)
    try {
      await window.api.templates.save(t.kind, name, t.payload)
      load()
      setNotice({ ok: true, text: `Saved as "${name.trim()}".` })
      setEditing(null)
    } catch (e) { setNotice({ ok: false, text: errMsg(e) }) }
    setBusy(false)
  }

  const savePayload = async (t: Template, payload: Record<string, unknown>) => {
    setBusy(true); setNotice(null)
    try {
      await window.api.templates.save(t.kind, t.name, payload)
      load()
      setNotice({ ok: true, text: `"${t.name}" was updated.` })
      setEditing(null)
    } catch (e) { setNotice({ ok: false, text: errMsg(e) }) }
    setBusy(false)
  }

  if (error) return <p role="alert" className="text-sm text-neg">{error}</p>
  if (templates === null) return <p className="text-sm text-muted">Loading templates…</p>

  const groups = groupTemplates(templates)

  return (
    <div className="space-y-4">
      <section className="card card-pad-lg">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="section-title">Templates</h2>
            <p className="mt-2 text-sm text-muted">
              A template is a saved starting point: a journal entry, a task with its subtasks and repeat rule, a note,
              a content stage checklist, or a trade checklist. Pick one in a tool's New menu; "Save as template" in any
              editor adds one here.
            </p>
            <p className="mt-1 flex flex-wrap items-center gap-1.5 text-sm text-muted">
              {TEMPLATE_VARIABLES.map((v) => (
                <code key={v} className="kbd">{v}</code>
              ))}
              <span>are filled in when a template is used.</span>
            </p>
          </div>
          <button className="btn btn-sm" onClick={restore} disabled={busy}>
            <RotateCcw size={14} aria-hidden="true" /> Restore built-ins
          </button>
        </div>
        {notice && <p role="status" className={`mt-3 text-sm ${notice.ok ? 'text-muted' : 'text-neg'}`}>{notice.text}</p>}
      </section>

      {groups.map(({ kind, items }) => (
        <KindSection
          key={kind} kind={kind} items={items} busy={busy}
          editingId={editing} confirmId={confirmRemove}
          onEdit={(id) => setEditing(id)}
          onCancel={() => { setEditing(null); setConfirmRemove(null) }}
          onRemoveClick={(id) => setConfirmRemove(id)}
          onRemove={(t) => void remove(t)}
          onRename={(t, name) => void rename(t, name)}
          onSavePayload={(t, payload) => void savePayload(t, payload)}
        />
      ))}
    </div>
  )
}

function KindSection({ kind, items, busy, editingId, confirmId, onEdit, onCancel, onRemoveClick, onRemove, onRename, onSavePayload }: {
  kind: TemplateKind
  items: Template[]
  busy: boolean
  editingId: number | null
  confirmId: number | null
  onEdit: (id: number) => void
  onCancel: () => void
  onRemoveClick: (id: number | null) => void
  onRemove: (t: Template) => void
  onRename: (t: Template, name: string) => void
  onSavePayload: (t: Template, payload: Record<string, unknown>) => void
}) {
  const mine = items.filter((t) => !t.isBuiltin)
  const builtins = items.filter((t) => t.isBuiltin)

  return (
    <section className="card card-pad-lg" aria-labelledby={`templates-${kind}`}>
      <div className="flex items-baseline justify-between gap-3">
        <h3 id={`templates-${kind}`} className="text-sm font-medium">{TEMPLATE_KIND_LABELS[kind]}</h3>
        <span className="meta">{mine.length} {mine.length === 1 ? 'template' : 'templates'} of yours</span>
      </div>

      {items.length === 0 ? (
        <EmptyState compact title={`No ${TEMPLATE_KIND_LABELS[kind].toLowerCase()} templates`}
          text="Use “Save as template” in this tool, or restore the built-in starters." />
      ) : (
        <ul className="mt-3 flex flex-col divide-y divide-line/60">
          {[...mine, ...builtins].map((t) => (
            <li key={t.id} className="py-3">
              {editingId === t.id ? (
                <TemplateEditor t={t} busy={busy} onCancel={onCancel} onRename={onRename} onSavePayload={onSavePayload} />
              ) : (
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-medium">{t.name}</span>
                      {t.isBuiltin && <span className="badge">Built in</span>}
                    </div>
                    <p className="meta mt-0.5">{summaryOf(t)}</p>
                    {kind === 'trade' && <TradeChecklistPreview payload={t.payload} />}
                  </div>
                  <div className="flex shrink-0 items-center gap-1.5">
                    {confirmId === t.id ? (
                      <>
                        <span className="meta">Remove "{t.name}"?</span>
                        <button className="btn btn-sm btn-danger" onClick={() => onRemove(t)} disabled={busy}>Remove</button>
                        <button className="btn btn-sm" onClick={() => onRemoveClick(null)} disabled={busy}>Cancel</button>
                      </>
                    ) : (
                      <>
                        <button className="btn btn-sm" onClick={() => onEdit(t.id)} disabled={busy} aria-label={`Edit ${t.name}`}>
                          <Pencil size={13} aria-hidden="true" /> Edit
                        </button>
                        {canRemoveTemplate(t) && (
                          <button className="btn btn-sm" onClick={() => onRemoveClick(t.id)} disabled={busy} aria-label={`Remove ${t.name}`}>
                            <Trash2 size={13} aria-hidden="true" />
                          </button>
                        )}
                      </>
                    )}
                  </div>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

// What a trade template copies onto a new trade, as two short lists.
function TradeChecklistPreview({ payload }: { payload: unknown }) {
  const { preTrade, postTrade } = tradeChecklists(payload)
  if (preTrade.length === 0 && postTrade.length === 0) return null
  const list = (title: string, lines: string[]) => lines.length === 0 ? null : (
    <div>
      <div className="meta font-medium">{title}</div>
      <ul className="mt-0.5 list-disc pl-4 text-xs text-muted">
        {lines.slice(0, 4).map((l, i) => <li key={`${l}-${i}`}>{l}</li>)}
        {lines.length > 4 && <li>+ {lines.length - 4} more</li>}
      </ul>
    </div>
  )
  return (
    <div className="mt-2 grid gap-2 sm:grid-cols-2">
      {list('Before the trade', preTrade)}
      {list('After the trade', postTrade)}
    </div>
  )
}

// Editing one template. A rename saves the same payload under the new name
// (the engine updates a template with the same name, so renaming to a name
// already used replaces that one). A trade template also edits its two
// checklists here; other kinds are edited best from the tool itself.
function TemplateEditor({ t, busy, onCancel, onRename, onSavePayload }: {
  t: Template
  busy: boolean
  onCancel: () => void
  onRename: (t: Template, name: string) => void
  onSavePayload: (t: Template, payload: Record<string, unknown>) => void
}) {
  const nameRef = useRef<HTMLInputElement>(null)
  const [name, setName] = useState(t.name)
  const lists = tradeChecklists(t.payload)
  const [pre, setPre] = useState(joinLines(lists.preTrade))
  const [post, setPost] = useState(joinLines(lists.postTrade))
  const fields = filledFields(t.kind, t.payload)

  useEffect(() => { nameRef.current?.focus(); nameRef.current?.select() }, [])

  const dirtyName = name.trim() !== t.name && name.trim() !== ''
  const dirtyLists = t.kind === 'trade' && (pre !== joinLines(lists.preTrade) || post !== joinLines(lists.postTrade))

  const save = () => {
    if (t.kind === 'trade' && dirtyLists) {
      const payload = { ...(t.payload as Record<string, unknown>), preTrade: splitLines(pre), postTrade: splitLines(post) }
      onSavePayload(t, payload)
      return
    }
    if (dirtyName) onRename(t, name)
  }

  return (
    <form className="flex flex-col gap-3" onSubmit={(e) => { e.preventDefault(); save() }}>
      <div className="flex flex-wrap items-end gap-2">
        <label className="flex min-w-0 flex-1 flex-col gap-1 text-xs text-muted">
          Name
          <input ref={nameRef} className="field py-1" value={name} maxLength={80} onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); onCancel() } }} />
        </label>
        <button type="submit" className="btn-primary btn-sm" disabled={busy || (!dirtyName && !dirtyLists)}>
          <Check size={14} aria-hidden="true" /> Save
        </button>
        <button type="button" className="btn btn-sm" onClick={onCancel} disabled={busy}>
          <X size={14} aria-hidden="true" /> Cancel
        </button>
      </div>

      {fields.length > 0 && (
        <p className="meta">Sets: {fields.map((f) => f.label.toLowerCase()).join(', ')}.</p>
      )}

      {t.kind === 'trade' ? (
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="flex flex-col gap-1 text-xs text-muted">
            Before the trade (one line each)
            <textarea className="field min-h-24 py-1 font-mono text-xs" value={pre} onChange={(e) => setPre(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); onCancel() } }} />
          </label>
          <label className="flex flex-col gap-1 text-xs text-muted">
            After the trade (one line each)
            <textarea className="field min-h-24 py-1 font-mono text-xs" value={post} onChange={(e) => setPost(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); onCancel() } }} />
          </label>
        </div>
      ) : (
        <p className="meta">
          Edit this template's content in {TEMPLATE_KIND_LABELS[t.kind].toLowerCase()} itself, then save it as a template again with this name.
        </p>
      )}
    </form>
  )
}
