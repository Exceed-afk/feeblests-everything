// Content planner (Phase 3): a pipeline board for videos, shorts, streams and
// posts, from first idea to published.
//
// The board is plain HTML5 drag-and-drop, the same technique the Tasks list
// uses (no new dependency), and every card also has keyboard-accessible
// "move back / move forward" buttons, so a card can be driven without a mouse.
//
// A card shows the CURRENT stage's checklist progress, the publish date and a
// missing-script or missing-asset warning. Opening a card gives the full editor.
import { useCallback, useEffect, useMemo, useState } from 'react'
import { ArrowLeft, ArrowRight, CalendarClock, Clapperboard, FileWarning, Link2, Plus, Search } from 'lucide-react'
import type { ModuleProps } from '../../../renderer/src/lib/navigation'
import { PageHeader } from '../../../renderer/src/components/PageHeader'
import { EmptyState } from '../../../renderer/src/components/EmptyState'
import { errMsg } from '../../../renderer/src/lib/errors'
import { today } from '../../../renderer/src/lib/dates'
import { useRefreshOnCapture } from '../../../renderer/src/lib/dataChanged'
import { noteUndoableDelete } from '../../../renderer/src/lib/undo'
import type { ContentItemDTO, ContentStage } from '../../../shared/notesBridge'
import {
  CONTENT_STAGES, CONTENT_STAGE_LABELS, CONTENT_TYPE_LABELS, nextStage, previousStage
} from '../../../shared/content'
import { ContentEditor } from './ContentEditor'

const stageTone = (stage: ContentStage): string =>
  stage === 'published' ? 'badge-pos' : stage === 'idea' ? 'badge' : 'badge'

export function Content(_props: ModuleProps) {
  const [items, setItems] = useState<ContentItemDTO[]>([])
  const [loaded, setLoaded] = useState(false)
  const [error, setError] = useState('')
  const [search, setSearch] = useState('')
  const [editing, setEditing] = useState<ContentItemDTO | 'new' | null>(null)
  const [dragId, setDragId] = useState<number | null>(null)
  const [busyId, setBusyId] = useState<number | null>(null)

  const refresh = useCallback(async () => {
    try {
      setItems(await window.api.content.list())
      setError('')
    } catch (e) {
      setError(errMsg(e))
    }
    setLoaded(true)
  }, [])

  useEffect(() => { void refresh() }, [refresh])
  useRefreshOnCapture(refresh)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'n') { e.preventDefault(); setEditing('new') }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase()
    if (!needle) return items
    return items.filter((i) =>
      i.title.toLowerCase().includes(needle) ||
      i.series.toLowerCase().includes(needle) ||
      i.platform.toLowerCase().includes(needle) ||
      i.tags.some((t) => t.includes(needle)))
  }, [items, search])

  const byStage = useMemo(() => {
    const map = new Map<ContentStage, ContentItemDTO[]>()
    for (const stage of CONTENT_STAGES) map.set(stage, [])
    for (const item of filtered) map.get(item.stage)?.push(item)
    return map
  }, [filtered])

  const move = async (item: ContentItemDTO, stage: ContentStage) => {
    setBusyId(item.id)
    try {
      await window.api.content.move(item.id, stage)
      await refresh()
      void window.api.capture.saved()
    } catch (e) {
      setError(errMsg(e))
    }
    setBusyId(null)
  }

  // Dropping card A on card B puts A into B's stage, then re-saves that stage's
  // order so the drop position is kept.
  const dropOn = async (target: ContentItemDTO) => {
    if (dragId === null || dragId === target.id) return
    const dragged = items.find((i) => i.id === dragId)
    setDragId(null)
    if (!dragged) return
    try {
      if (dragged.stage !== target.stage) {
        await window.api.content.move(dragged.id, target.stage)
        const order = [...(byStage.get(target.stage) ?? []).filter((i) => i.id !== dragged.id).map((i) => i.id)]
        const at = order.indexOf(target.id)
        order.splice(at === -1 ? order.length : at, 0, dragged.id)
        await window.api.content.reorder(target.stage, order)
      } else {
        const order = (byStage.get(target.stage) ?? []).map((i) => i.id).filter((id) => id !== dragged.id)
        const at = order.indexOf(target.id)
        order.splice(at === -1 ? order.length : at, 0, dragged.id)
        await window.api.content.reorder(target.stage, order)
      }
      await refresh()
    } catch (e) {
      setError(errMsg(e))
    }
  }

  const remove = async (item: ContentItemDTO) => {
    try {
      const batch = await window.api.content.remove(item.id)
      noteUndoableDelete({ label: `content item "${item.title}"`, batchId: batch })
      setEditing(null)
      await refresh()
    } catch (e) {
      setError(errMsg(e))
    }
  }

  const publishedThisMonth = items.filter((i) => i.publishedDate && i.publishedDate.slice(0, 7) === today().slice(0, 7)).length

  return (
    <div className="page">
      <PageHeader
        title="Content"
        subtitle={items.length > 0
          ? `${items.length} ${items.length === 1 ? 'item' : 'items'} in the pipeline · ${publishedThisMonth} published this month`
          : 'A pipeline for videos, shorts, streams and posts, from first idea to published.'}
      >
        <button className="btn-primary" onClick={() => setEditing('new')} title="Ctrl+N">
          <Plus size={16} aria-hidden="true" /> New item
        </button>
      </PageHeader>

      {error && <p role="alert" className="mb-3 text-sm text-neg">{error}</p>}

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="relative min-w-[14rem] flex-1">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" aria-hidden="true" />
          <input className="field pl-9" placeholder="Search title, series, platform or tag" aria-label="Search content"
            value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <p className="meta">Drag a card, or use the arrows on it, to move it along the pipeline.</p>
      </div>

      {loaded && items.length === 0 ? (
        <EmptyState
          icon={Clapperboard}
          title="Your content pipeline starts with one idea"
          text="Capture an idea now, move it through Script, Record, Edit and Publish, then log views after it goes out."
          action={<button className="btn-primary" onClick={() => setEditing('new')}><Plus size={16} aria-hidden="true" /> Add your first idea</button>}
        />
      ) : (
        <div className="flex w-full min-w-0 gap-3 overflow-x-auto pb-3">
          {CONTENT_STAGES.map((stage) => {
            const cards = byStage.get(stage) ?? []
            return (
              <section
                key={stage}
                aria-label={CONTENT_STAGE_LABELS[stage]}
                className="flex w-60 shrink-0 flex-col rounded-2xl border border-line bg-card/60 p-2"
                onDragOver={(e) => e.preventDefault()}
                onDrop={() => { if (dragId !== null) { const dragged = items.find((i) => i.id === dragId); if (dragged && dragged.stage !== stage) void move(dragged, stage) } }}
              >
                <h2 className="flex items-center justify-between px-1 pb-2 text-xs font-semibold uppercase tracking-wide text-muted">
                  {CONTENT_STAGE_LABELS[stage]}
                  <span className="num">{cards.length}</span>
                </h2>

                <div className="flex min-h-[4rem] flex-col gap-2">
                  {cards.map((item) => (
                    <ContentCard
                      key={item.id}
                      item={item}
                      busy={busyId === item.id}
                      onOpen={() => setEditing(item)}
                      onDraggingChange={(dragging) => setDragId(dragging ? item.id : null)}
                      onDropHere={() => void dropOn(item)}
                      onMove={(to) => void move(item, to)}
                    />
                  ))}
                  {cards.length === 0 && (
                    <p className="rounded-xl border border-dashed border-line px-2 py-4 text-center text-xs text-muted">
                      {stage === 'idea' ? 'No ideas yet — add one.' : 'Nothing here.'}
                    </p>
                  )}
                </div>
              </section>
            )
          })}
        </div>
      )}

      {editing && (
        <ContentEditor
          item={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={async () => { setEditing(null); await refresh(); void window.api.capture.saved() }}
          onDeleted={(item) => void remove(item)}
        />
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------

function ContentCard({ item, busy, onOpen, onDraggingChange, onDropHere, onMove }: {
  item: ContentItemDTO
  busy: boolean
  onOpen: () => void
  onDraggingChange: (dragging: boolean) => void
  onDropHere: () => void
  onMove: (stage: ContentStage) => void
}) {
  const back = previousStage(item.stage)
  const forward = nextStage(item.stage)
  const missingScript = item.scriptNoteId !== null && !item.scriptNoteTitle
  const progress = (item.checklistTotal ?? 0) > 0 ? `${item.checklistDone}/${item.checklistTotal} done` : ''
  const overdueTarget = item.targetPublishDate !== null && item.publishedDate === null && item.targetPublishDate < today()

  return (
    <article
      draggable
      onDragStart={() => onDraggingChange(true)}
      onDragEnd={() => onDraggingChange(false)}
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => { e.stopPropagation(); onDropHere() }}
      className={`card card-pad-sm cursor-grab ${busy ? 'opacity-60' : ''} ${overdueTarget ? 'border-neg/60' : ''}`}
    >
      <button className="block w-full text-left" onClick={onOpen}>
        <span className="block text-sm font-medium leading-snug">{item.title}</span>
        <span className="meta mt-1 flex flex-wrap items-center gap-x-2">
          <span className={`badge ${stageTone(item.stage)}`}>{CONTENT_TYPE_LABELS[item.type]}</span>
          {item.platform && <span>{item.platform}</span>}
          {progress && <span>{progress}</span>}
        </span>
        {item.targetPublishDate && (
          <span className={`meta mt-1 flex items-center gap-1 ${overdueTarget ? 'text-neg' : ''}`}>
            <CalendarClock size={11} aria-hidden="true" /> {overdueTarget ? 'Overdue: ' : ''}{item.targetPublishDate}
          </span>
        )}
        {(missingScript || item.scriptNoteId !== null) && (
          <span className={`meta mt-1 flex items-center gap-1 ${missingScript ? 'text-neg' : ''}`}>
            {missingScript ? <FileWarning size={11} aria-hidden="true" /> : <Link2 size={11} aria-hidden="true" />}
            {missingScript ? 'Script missing' : item.scriptNoteTitle}
          </span>
        )}
      </button>

      <div className="mt-2 flex items-center justify-between gap-1">
        <button className="btn-icon" disabled={!back} aria-label={`Move ${item.title} back`} onClick={() => back && onMove(back)}>
          <ArrowLeft size={13} aria-hidden="true" />
        </button>
        <button className="btn-icon" disabled={!forward} aria-label={`Move ${item.title} forward`} onClick={() => forward && onMove(forward)}>
          <ArrowRight size={13} aria-hidden="true" />
        </button>
      </div>
    </article>
  )
}


