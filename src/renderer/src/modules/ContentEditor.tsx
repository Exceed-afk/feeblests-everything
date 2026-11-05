// The content item editor (Phase 3): everything about one video, short, stream
// or post. Opened by clicking a card or "New item".
//
// Sections: the basics, the script (a Note, created in one click), per-stage
// checklists, optional stage dates, local assets by path, and — once published
// — the manual view counts.
import { useEffect, useMemo, useState } from 'react'
import { FileWarning, FolderOpen, Trash2 } from 'lucide-react'
import { Dialog, Field, FormMessage } from '../../../renderer/src/components/EditorBits'
import { TagInput } from '../../../renderer/src/components/TagInput'
import { MarkdownView } from '../../../renderer/src/components/MarkdownView'
import { errMsg } from '../../../renderer/src/lib/errors'
import type { ContentStage, ContentItemDTO, ContentInputDTO, ContentAsset } from '../../../shared/notesBridge'
import {
  CONTENT_STAGES, CONTENT_STAGE_LABELS, CONTENT_TYPES, CONTENT_TYPE_LABELS
} from '../../../shared/content'
import { isWebUrl } from '../../../shared/url'

export function ContentEditor({ item, onClose, onSaved, onDeleted }: {
  item: ContentItemDTO | null
  onClose: () => void
  onSaved: () => void
  onDeleted: (item: ContentItemDTO) => void
}) {
  const [draft, setDraft] = useState<ContentInputDTO>(() => toInput(item))
  const [tagInput, setTagInput] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [lineText, setLineText] = useState('')
  const [assetPath, setAssetPath] = useState('')
  const [assetLabel, setAssetLabel] = useState('')
  const [missing, setMissing] = useState<string[]>([])
  const [script, setScript] = useState<{ title: string; body: string } | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [section, setSection] = useState<'details' | 'script' | 'checklist' | 'assets' | 'published'>('details')

  const stage: ContentStage = draft.stage ?? 'idea'

  useEffect(() => {
    if (!item?.scriptNoteId) { setScript(null); return }
    let alive = true
    window.api.notes.get(item.scriptNoteId)
      .then((n) => { if (alive) setScript({ title: n.title, body: n.body }) })
      .catch(() => { if (alive) setScript(null) })
    return () => { alive = false }
  }, [item?.scriptNoteId, item?.updatedAt])

  // Warn about asset paths that have gone missing (a path check only: nothing
  // is read, opened or copied).
  useEffect(() => {
    const paths = (draft.assets ?? []).map((a) => a.path)
    if (paths.length === 0) { setMissing([]); return }
    let alive = true
    window.api.content.missingAssets(paths).then((list) => { if (alive) setMissing(list) }).catch(() => { })
    return () => { alive = false }
  }, [draft.assets])

  const stageLines = useMemo(
    () => (draft.checklist ?? []).filter((l) => l.stage === stage),
    [draft.checklist, stage]
  )

  const patch = (p: Partial<ContentInputDTO>) => { setDraft((d) => ({ ...d, ...p })); setError('') }

  const save = async () => {
    setError('')
    if (!draft.title.trim()) { setError('Give the item a title, even a rough one.'); return }
    setBusy(true)
    try {
      if (item) await window.api.content.update(item.id, draft)
      else await window.api.content.create(draft)
      onSaved()
    } catch (e) {
      setError(errMsg(e))
      setBusy(false)
    }
  }

  const createScript = async () => {
    if (!item) { setError('Save the item first, then create its script.'); return }
    try {
      const updated = await window.api.content.createScript(item.id, draft.title)
      setScript({ title: `Script: ${updated.title}`, body: '' })
      const fresh = await window.api.notes.get(updated.scriptNoteId!)
      setScript({ title: fresh.title, body: fresh.body })
      onSaved()
    } catch (e) {
      setError(errMsg(e))
    }
  }

  const addLine = async () => {
    const text = lineText.trim()
    if (!text) return
    patch({ checklist: [...(draft.checklist ?? []), { id: `tmp-${Date.now()}`, stage, text, done: false }] })
    setLineText('')
    if (!item) return
    try {
      const updated = await window.api.content.addChecklistLine(item.id, stage, text)
      setDraft((d) => ({ ...d, checklist: updated.checklist }))
    } catch (e) {
      setError(errMsg(e))
    }
  }

  const toggleLine = async (lineId: string, done: boolean) => {
    patch({ checklist: (draft.checklist ?? []).map((l) => (l.id === lineId ? { ...l, done } : l)) })
    if (!item) return
    // A locally added line has not been persisted yet; the save below fixes it.
    if (lineId.startsWith('tmp-')) return
    try {
      const updated = await window.api.content.setChecklistDone(item.id, lineId, done)
      setDraft((d) => ({ ...d, checklist: updated.checklist }))
    } catch (e) {
      setError(errMsg(e))
    }
  }

  const removeLine = async (lineId: string) => {
    patch({ checklist: (draft.checklist ?? []).filter((l) => l.id !== lineId) })
    if (!item || lineId.startsWith('tmp-')) return
    try {
      const updated = await window.api.content.removeChecklistLine(item.id, lineId)
      setDraft((d) => ({ ...d, checklist: updated.checklist }))
    } catch (e) {
      setError(errMsg(e))
    }
  }

  const setStageDate = (stage: ContentStage, date: string) => {
    const next = { ...(draft.stageDates ?? {}) }
    if (date) next[stage] = date
    else delete next[stage]
    patch({ stageDates: next })
  }

  const addAsset = () => {
    const path = assetPath.trim()
    if (!path) { setError('Paste the file path first.'); return }
    if ((draft.assets ?? []).some((a) => a.path === path)) { setError('That file is already attached.'); return }
    const ext = path.split('.').pop()?.toLowerCase() ?? ''
    const kind: ContentAsset['kind'] = ['mp4', 'mov', 'mkv', 'webm', 'avi'].includes(ext) ? 'video'
      : ['wav', 'mp3', 'm4a', 'flac'].includes(ext) ? 'audio'
        : ['png', 'jpg', 'jpeg', 'webp', 'gif'].includes(ext) ? 'image' : 'file'
    patch({ assets: [...(draft.assets ?? []), { path, label: assetLabel.trim() || path.split(/[\\/]/).pop() || path, kind }] })
    setAssetPath(''); setAssetLabel('')
  }

  const openFolder = async () => {
    // The data folder button lives in Settings; here we only ever reveal a path
    // check. Opening files is deliberately out of scope for this MVP.
    await window.api.app.openDataFolder()
  }

  return (
    <Dialog title={item ? 'Edit content item' : 'New content item'} onClose={onClose} onSave={() => void save()} wide>
      <div className="seg mb-4" role="tablist" aria-label="Editor sections">
        {([['details', 'Details'], ['script', 'Script'], ['checklist', 'Checklist'], ['assets', 'Assets'], ['published', 'Published']] as const).map(([id, label]) => (
          <button key={id} role="tab" aria-selected={section === id} aria-controls={`content-section-${id}`}
            tabIndex={section === id ? 0 : -1} onClick={() => setSection(id)}>{label}</button>
        ))}
      </div>

      <div id={`content-section-${section}`} role="tabpanel" className="space-y-4">
        {section === 'details' && (
          <>
            <Field label="Title">
              <input className="field" autoFocus value={draft.title} onChange={(e) => patch({ title: e.target.value })} placeholder="Working title" />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Type">
                <select className="field" value={draft.type} onChange={(e) => patch({ type: e.target.value as ContentInputDTO['type'] })}>
                  {CONTENT_TYPES.map((t) => <option key={t} value={t}>{CONTENT_TYPE_LABELS[t]}</option>)}
                </select>
              </Field>
              <Field label="Stage">
                <select className="field" value={stage} onChange={(e) => patch({ stage: e.target.value as ContentStage })}>
                  {CONTENT_STAGES.map((s) => <option key={s} value={s}>{CONTENT_STAGE_LABELS[s]}</option>)}
                </select>
              </Field>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Platform"><input className="field" value={draft.platform ?? ''} onChange={(e) => patch({ platform: e.target.value })} placeholder="YouTube, TikTok…" /></Field>
              <Field label="Series"><input className="field" value={draft.series ?? ''} onChange={(e) => patch({ series: e.target.value })} placeholder="Optional" /></Field>
            </div>
            <Field label="Hook" hint="The one line that makes someone watch.">
              <input className="field" value={draft.hook ?? ''} onChange={(e) => patch({ hook: e.target.value })} />
            </Field>
            <Field label="Target publish date">
              <input type="date" className="field" value={draft.targetPublishDate ?? ''} onChange={(e) => patch({ targetPublishDate: e.target.value || null })} />
            </Field>
            <TagInput tags={draft.tags ?? []} onTagsChange={(tags) => patch({ tags })}
              input={tagInput} onInputChange={setTagInput} suggestions={[]} />
            {draft.type === 'stream' && (
              <div className="grid grid-cols-2 gap-3">
                <Field label="Stream starts">
                  <input type="datetime-local" className="field" value={draft.streamStart ?? ''} onChange={(e) => patch({ streamStart: e.target.value || null })} />
                </Field>
                <Field label="Length (minutes)">
                  <input type="number" min={0} className="field num" value={draft.streamMinutes ?? ''} onChange={(e) => patch({ streamMinutes: e.target.value === '' ? null : Number(e.target.value) })} />
                </Field>
              </div>
            )}
          </>
        )}

        {section === 'script' && (
          <div className="space-y-3">
            {script ? (
              <>
                <p className="meta">Linked note: <strong>{script.title}</strong>. Edit it in Notes; backlinks work both ways.</p>
                <div className="card card-pad max-h-[24rem] overflow-y-auto"><MarkdownView markdown={script.body} /></div>
              </>
            ) : item?.scriptNoteId ? (
              <p className="text-sm text-neg">The linked script note is missing (it was deleted). Create a new one below.</p>
            ) : (
              <p className="text-sm text-muted">No script yet. Create one in a click: it is a normal note, so markdown, tags and backlinks all work.</p>
            )}
            <button className="btn-primary" onClick={() => void createScript()} disabled={!item}>
              {item?.scriptNoteId ? 'Create a new script note' : 'Create script note'}
            </button>
          </div>
        )}

        {section === 'checklist' && (
          <div className="space-y-3">
            <p className="meta">Showing the <strong>{CONTENT_STAGE_LABELS[stage]}</strong> checklist. Each stage keeps its own.</p>
            {stageLines.length === 0 && <p className="text-sm text-muted">No checklist for this stage yet — add a line below.</p>}
            <ul className="flex flex-col divide-y divide-line/60">
              {stageLines.map((line) => (
                <li key={line.id} className="flex items-center gap-2 py-2">
                  <input type="checkbox" checked={line.done} onChange={(e) => void toggleLine(line.id, e.target.checked)} aria-label={line.text} />
                  <span className={`min-w-0 flex-1 text-sm ${line.done ? 'text-muted line-through' : ''}`}>{line.text}</span>
                  <button className="btn-icon" aria-label={`Remove ${line.text}`} onClick={() => void removeLine(line.id)}><Trash2 size={13} aria-hidden="true" /></button>
                </li>
              ))}
            </ul>
            <div className="flex gap-2">
              <input className="field flex-1" value={lineText} placeholder={`Add a ${CONTENT_STAGE_LABELS[stage].toLowerCase()} line`}
                onChange={(e) => setLineText(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void addLine() } }} />
              <button className="btn" onClick={() => void addLine()}>Add</button>
            </div>

            <div>
              <h3 className="section-title">Stage dates</h3>
              <p className="meta mt-1">Optional. "Record day" and the like can be planned ahead.</p>
              <div className="mt-2 grid grid-cols-2 gap-2">
                {CONTENT_STAGES.filter((s) => s !== 'published').map((s) => (
                  <Field key={s} label={CONTENT_STAGE_LABELS[s]}>
                    <input type="date" className="field" value={draft.stageDates?.[s] ?? ''} onChange={(e) => setStageDate(s, e.target.value)} />
                  </Field>
                ))}
              </div>
            </div>
          </div>
        )}

        {section === 'assets' && (
          <div className="space-y-3">
            <p className="meta">Local files are stored by PATH only — nothing is copied, so large videos stay where they are.</p>
            {(draft.assets ?? []).length === 0 && <p className="text-sm text-muted">No files attached yet.</p>}
            <ul className="flex flex-col divide-y divide-line/60">
              {(draft.assets ?? []).map((asset) => {
                const gone = missing.includes(asset.path)
                return (
                  <li key={asset.path} className="flex items-center gap-2 py-2">
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm">{asset.label}</span>
                      <span className="meta block truncate">{asset.path}</span>
                    </span>
                    {gone && <span className="badge badge-neg"><FileWarning size={11} aria-hidden="true" /> Missing</span>}
                    <button className="btn-icon" aria-label={`Remove ${asset.label}`}
                      onClick={() => patch({ assets: (draft.assets ?? []).filter((a) => a.path !== asset.path) })}>
                      <Trash2 size={13} aria-hidden="true" />
                    </button>
                  </li>
                )
              })}
            </ul>
            <div className="flex flex-wrap items-end gap-2">
              <Field label="File path" className="min-w-[16rem] flex-1">
                <input className="field" value={assetPath} onChange={(e) => setAssetPath(e.target.value)} placeholder="D:\Videos\episode-01.mp4" />
              </Field>
              <Field label="Label" className="w-40">
                <input className="field" value={assetLabel} onChange={(e) => setAssetLabel(e.target.value)} placeholder="Raw footage" />
              </Field>
              <button className="btn" onClick={addAsset}>Attach</button>
            </div>
            {missing.length > 0 && (
              <p className="text-sm text-neg">{missing.length} referenced {missing.length === 1 ? 'file is' : 'files are'} no longer at its path. Nothing was changed — re-attach it if it moved.</p>
            )}
            <button className="btn btn-sm" onClick={() => void openFolder()}><FolderOpen size={13} aria-hidden="true" /> Open the data folder</button>
          </div>
        )}

        {section === 'published' && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <Field label="Published date">
                <input type="date" className="field" value={draft.publishedDate ?? ''}
                  onChange={(e) => {
                    const value = e.target.value || null
                    patch({ publishedDate: value, stage: value && stage !== 'published' ? 'published' : draft.stage })
                  }} />
              </Field>
              <Field label="Published URL" hint="http(s) only.">
                <input className="field" value={draft.publishedUrl ?? ''}
                  aria-invalid={(draft.publishedUrl ?? '') !== '' && !isWebUrl(draft.publishedUrl ?? '')}
                  onChange={(e) => patch({ publishedUrl: e.target.value })} placeholder="https://…" />
              </Field>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Views at 24 hours"><input type="number" min={0} className="field num" value={draft.views24h ?? ''} onChange={(e) => patch({ views24h: e.target.value === '' ? null : Number(e.target.value) })} /></Field>
              <Field label="Views at 7 days"><input type="number" min={0} className="field num" value={draft.views7d ?? ''} onChange={(e) => patch({ views7d: e.target.value === '' ? null : Number(e.target.value) })} /></Field>
            </div>
            <Field label="What to do differently next time">
              <textarea className="field min-h-[6rem] resize-y" value={draft.postNotes ?? ''} onChange={(e) => patch({ postNotes: e.target.value })} />
            </Field>
          </div>
        )}
      </div>

      <div className="mt-5">
        <FormMessage error={error} />
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        {item && (confirmDelete ? (
          <>
            <button className="btn-danger" onClick={() => onDeleted(item)}>Delete item</button>
            <button className="btn" onClick={() => setConfirmDelete(false)}>Keep it</button>
          </>
        ) : (
          <button className="btn text-neg" onClick={() => setConfirmDelete(true)}>Delete</button>
        ))}
        <span className="ml-auto text-xs text-muted">Ctrl+Enter to save · Esc to close</span>
        <button className="btn" onClick={onClose} disabled={busy}>Cancel</button>
        <button className="btn-primary" onClick={() => void save()} disabled={busy}>
          {item ? 'Save changes' : 'Add item'}
        </button>
      </div>
    </Dialog>
  )
}

function toInput(item: ContentItemDTO | null): ContentInputDTO {
  if (!item) return { title: '', type: 'video', stage: 'idea', tags: [], checklist: [] }
  return {
    title: item.title, type: item.type, platform: item.platform, hook: item.hook, stage: item.stage,
    series: item.series, tags: item.tags, targetPublishDate: item.targetPublishDate,
    publishedDate: item.publishedDate, publishedUrl: item.publishedUrl, scriptNoteId: item.scriptNoteId,
    checklist: item.checklist, stageDates: item.stageDates, assets: item.assets,
    streamStart: item.streamStart, streamMinutes: item.streamMinutes,
    views24h: item.views24h, views7d: item.views7d, postNotes: item.postNotes
  }
}


