// Content planner queries (Phase 3). Owns `content_items`: the pipeline board,
// per-stage checklists, stage dates, assets by path and the post-publish views.
//
// Deletes are soft (Trash + Undo), writes keep the shared search index and the
// tag rows in step, and a stage move seeds that stage's checklist once.
import type Database from 'better-sqlite3'
import {
  CONTENT_STAGES, CONTENT_TYPES, checklistId, isContentStage, isContentType, moveToStage, seedStageChecklist,
  stageProgress, type ContentAsset, type ContentInput, type ContentItem, type ContentStage, type StageChecklistItem,
  type StageDates
} from '../shared/content'
import { normalizeTags } from '../shared/tags'
import { LIVE, newBatchId, nowIso, trashByWhere } from './repo'
import { indexOne, removeOne } from './searchIndex'
import { setEntityTags } from './tags'
import { pruneLinks } from './links'
import type { TrashEntry } from '../shared/trash'
import { isDate, isRealDate } from './util'

interface ContentRow {
  id: number
  title: string
  type: string
  platform: string
  hook: string
  stage: string
  position: number
  series: string
  tags: string
  target_publish_date: string | null
  published_date: string | null
  published_url: string | null
  script_note_id: number | null
  checklist: string
  stage_dates: string
  assets: string
  stream_start: string | null
  stream_minutes: number | null
  views_24h: number | null
  views_7d: number | null
  post_notes: string
  created_at: string
  updated_at: string
  deleted_at: string | null
  delete_batch_id: string | null
}

const parseJson = <T>(raw: string, fallback: T): T => {
  try { return JSON.parse(raw) as T } catch { return fallback }
}

const toItem = (r: ContentRow): ContentItem => {
  const checklist = parseJson<StageChecklistItem[]>(r.checklist, [])
  const stage = isContentStage(r.stage) ? r.stage : 'idea'
  const progress = stageProgress(checklist, stage)
  return {
    id: r.id,
    title: r.title,
    type: isContentType(r.type) ? r.type : 'video',
    platform: r.platform,
    hook: r.hook,
    stage,
    position: r.position,
    series: r.series,
    tags: parseJson<string[]>(r.tags, []),
    targetPublishDate: r.target_publish_date,
    publishedDate: r.published_date,
    publishedUrl: r.published_url,
    scriptNoteId: r.script_note_id,
    checklist,
    stageDates: parseJson<StageDates>(r.stage_dates, {}),
    assets: parseJson<ContentAsset[]>(r.assets, []),
    streamStart: r.stream_start,
    streamMinutes: r.stream_minutes,
    views24h: r.views_24h,
    views7d: r.views_7d,
    postNotes: r.post_notes,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    checklistDone: progress.done,
    checklistTotal: progress.total
  }
}

// The script note's live title, or null when it was deleted or trashed. The UI
// shows a "script missing" hint instead of a dead link.
function scriptTitle(db: Database.Database, noteId: number | null): string | null {
  if (noteId === null) return null
  const row = db.prepare('SELECT title FROM notes WHERE id = ? AND deleted_at IS NULL').get(noteId) as { title: string } | undefined
  return row?.title ?? null
}

const withScript = (db: Database.Database, item: ContentItem): ContentItem =>
  ({ ...item, scriptNoteTitle: scriptTitle(db, item.scriptNoteId) })

export function getContentItem(db: Database.Database, id: number): ContentItem {
  const row = db.prepare(`SELECT * FROM content_items WHERE id = ? AND ${LIVE()}`).get(id) as ContentRow | undefined
  if (!row) throw new Error('Content item not found')
  return withScript(db, toItem(row))
}

// The board: every live item, in stage order then position (cards keep their
// manual order inside a column).
export function listContentItems(db: Database.Database): ContentItem[] {
  const rows = db.prepare(
    `SELECT * FROM content_items WHERE ${LIVE()} ORDER BY position ASC, id ASC`
  ).all() as ContentRow[]
  return rows.map((r) => withScript(db, toItem(r)))
}

// Published items dated inside a range, for the Calendar. Uses the PUBLISHED
// date (what actually happened), not the target.
export function listPublishedBetween(db: Database.Database, from: string, to: string): ContentItem[] {
  const rows = db.prepare(
    `SELECT * FROM content_items WHERE ${LIVE()} AND published_date IS NOT NULL
       AND published_date >= ? AND published_date <= ? ORDER BY published_date`
  ).all(from, to) as ContentRow[]
  return rows.map((r) => withScript(db, toItem(r)))
}

// Items with a target publish date in a range who are NOT published yet: the
// "what is coming up" side of the calendar.
export function listPlannedBetween(db: Database.Database, from: string, to: string): ContentItem[] {
  const rows = db.prepare(
    `SELECT * FROM content_items WHERE ${LIVE()} AND published_date IS NULL
       AND target_publish_date IS NOT NULL AND target_publish_date >= ? AND target_publish_date <= ?
     ORDER BY target_publish_date`
  ).all(from, to) as ContentRow[]
  return rows.map((r) => withScript(db, toItem(r)))
}

const dateOrNull = (v: string | null | undefined, field: string): string | null => {
  if (v === null || v === undefined || v === '') return null
  if (!isDate(v) || !isRealDate(v)) throw new Error(`${field} must be a real date like 2026-11-05`)
  return v
}

function normalizeChecklist(items: StageChecklistItem[] | undefined, stage: ContentStage): StageChecklistItem[] {
  if (!items) return seedStageChecklist([], stage)
  const taken = new Set<string>()
  return items.map((i) => {
    const s: ContentStage = isContentStage(i.stage) ? i.stage : stage
    const text = String(i.text ?? '').trim()
    return { stage: s, text, done: i.done === true, id: i.id && !taken.has(i.id) ? (taken.add(i.id), i.id) : checklistId(s, text || 'item', taken) }
  }).filter((i) => i.text !== '')
}

function prepare(input: ContentInput) {
  const title = input.title.trim()
  if (!title) throw new Error('Give the item a title, even a rough one.')
  if (!isContentType(input.type)) throw new Error('Type must be video, short, stream or post')
  const stage: ContentStage = input.stage && isContentStage(input.stage) ? input.stage : 'idea'
  const streamMinutes = input.streamMinutes === null || input.streamMinutes === undefined ? null : Math.floor(input.streamMinutes)
  if (streamMinutes !== null && (!Number.isFinite(streamMinutes) || streamMinutes <= 0)) throw new Error('Stream length must be a positive number of minutes')
  const views = (v: number | null | undefined, label: string): number | null => {
    if (v === null || v === undefined) return null
    const n = Math.floor(v)
    if (!Number.isFinite(n) || n < 0) throw new Error(`${label} must be 0 or more`)
    return n
  }
  return {
    title,
    type: input.type,
    platform: (input.platform ?? '').trim(),
    hook: (input.hook ?? '').trim(),
    stage,
    series: (input.series ?? '').trim(),
    tags: JSON.stringify(normalizeTags(input.tags ?? [])),
    target: dateOrNull(input.targetPublishDate, 'Target publish date'),
    published: dateOrNull(input.publishedDate, 'Published date'),
    url: input.publishedUrl?.trim() || null,
    scriptNoteId: input.scriptNoteId ?? null,
    checklist: JSON.stringify(normalizeChecklist(input.checklist, stage)),
    stageDates: JSON.stringify(input.stageDates ?? {}),
    assets: JSON.stringify(input.assets ?? []),
    streamStart: input.streamStart?.trim() || null,
    streamMinutes,
    views24h: views(input.views24h, 'Views at 24 hours'),
    views7d: views(input.views7d, 'Views at 7 days'),
    postNotes: (input.postNotes ?? '').trim()
  }
}

// The next free position at the end of a stage column.
function nextPosition(db: Database.Database, stage: ContentStage): number {
  const row = db.prepare(`SELECT MAX(position) AS p FROM content_items WHERE stage = ? AND ${LIVE()}`).get(stage) as { p: number | null }
  return row.p === null ? 0 : row.p + 1
}

export function createContentItem(db: Database.Database, input: ContentInput): ContentItem {
  const c = prepare(input)
  const now = nowIso()
  const id = db.transaction(() => {
    const info = db.prepare(
      `INSERT INTO content_items
       (title, type, platform, hook, stage, position, series, tags, target_publish_date, published_date, published_url,
        script_note_id, checklist, stage_dates, assets, stream_start, stream_minutes, views_24h, views_7d, post_notes,
        created_at, updated_at)
       VALUES (@title, @type, @platform, @hook, @stage, @position, @series, @tags, @target, @published, @url,
        @scriptNoteId, @checklist, @stageDates, @assets, @streamStart, @streamMinutes, @views24h, @views7d, @postNotes,
        @now, @now)`
    ).run({ ...c, position: nextPosition(db, c.stage), now })
    const newId = Number(info.lastInsertRowid)
    afterWrite(db, newId)
    return newId
  })()
  return getContentItem(db, id)
}

export function updateContentItem(db: Database.Database, id: number, input: ContentInput): ContentItem {
  getContentItem(db, id)
  const c = prepare(input)
  db.transaction(() => {
    const changes = db.prepare(
      `UPDATE content_items SET title=@title, type=@type, platform=@platform, hook=@hook, stage=@stage,
        series=@series, tags=@tags, target_publish_date=@target, published_date=@published, published_url=@url,
        script_note_id=@scriptNoteId, checklist=@checklist, stage_dates=@stageDates, assets=@assets,
        stream_start=@streamStart, stream_minutes=@streamMinutes, views_24h=@views24h, views_7d=@views7d,
        post_notes=@postNotes, updated_at=@now WHERE id=@id AND ${LIVE()}`
    ).run({ ...c, id, now: nowIso() }).changes
    if (changes === 0) throw new Error('Content item not found')
    afterWrite(db, id)
  })()
  return getContentItem(db, id)
}

// Moves a card to a stage. Seeds that stage's checklist the first time (so
// "Record" always arrives with audio/lighting/backups), and stamps the published
// date when it reaches Published. Idempotent: moving to the same stage is a no-op.
export function moveContentItem(db: Database.Database, id: number, stage: ContentStage): ContentItem {
  const item = getContentItem(db, id)
  if (!isContentStage(stage)) throw new Error('Unknown stage')
  if (item.stage === stage) return item
  const { checklist } = moveToStage(item, stage)
  const publishedDate = stage === 'published' && item.publishedDate === null ? new Date().toISOString().slice(0, 10) : item.publishedDate
  db.transaction(() => {
    db.prepare(
      `UPDATE content_items SET stage = ?, checklist = ?, published_date = ?, position = ?, updated_at = ? WHERE id = ? AND ${LIVE()}`
    ).run(stage, JSON.stringify(checklist), publishedDate, nextPosition(db, stage), nowIso(), id)
    afterWrite(db, id)
  })()
  return getContentItem(db, id)
}

// Saves a manual board order for one stage (the ids as dropped, top to bottom).
export function reorderContentItems(db: Database.Database, stage: ContentStage, ids: number[]): void {
  db.transaction(() => {
    const update = db.prepare(`UPDATE content_items SET position = ?, updated_at = ? WHERE id = ? AND stage = ? AND ${LIVE()}`)
    ids.forEach((id, index) => update.run(index, nowIso(), id, stage))
  })()
}

// Ticks one checklist line. `itemId` in the checklist id identifies the line.
export function setChecklistDone(db: Database.Database, id: number, lineId: string, done: boolean): ContentItem {
  const item = getContentItem(db, id)
  const checklist = item.checklist.map((i) => (i.id === lineId ? { ...i, done } : i))
  return updateContentItem(db, id, { ...item, checklist })
}

export function addChecklistLine(db: Database.Database, id: number, stage: ContentStage, text: string): ContentItem {
  const item = getContentItem(db, id)
  const taken = new Set(item.checklist.map((i) => i.id))
  const line = { id: checklistId(stage, text, taken), stage, text: text.trim(), done: false }
  if (!line.text) throw new Error('The checklist line is empty')
  return updateContentItem(db, id, { ...item, checklist: [...item.checklist, line] })
}

export function removeChecklistLine(db: Database.Database, id: number, lineId: string): ContentItem {
  const item = getContentItem(db, id)
  return updateContentItem(db, id, { ...item, checklist: item.checklist.filter((i) => i.id !== lineId) })
}

// ---------- script ----------

// Attaches a note as the script (or detaches with null). The link itself is the
// `links` relation created by the caller, so backlinks work from both sides.
export function setScriptNote(db: Database.Database, id: number, noteId: number | null): ContentItem {
  const item = getContentItem(db, id)
  if (noteId !== null) {
    const note = db.prepare(`SELECT id FROM notes WHERE id = ? AND ${LIVE()}`).get(noteId)
    if (!note) throw new Error('Note not found')
  }
  db.prepare(`UPDATE content_items SET script_note_id = ?, updated_at = ? WHERE id = ? AND ${LIVE()}`).run(noteId, nowIso(), id)
  return getContentItem(db, item.id)
}

// ---------- assets by path ----------

// Adds a local file reference. The path is stored as typed; the browser renderer
// never reads the file itself, the UI only warns when the path is gone.
export function addAsset(db: Database.Database, id: number, asset: ContentAsset): ContentItem {
  if (!asset.path.trim()) throw new Error('Pick a file path')
  const item = getContentItem(db, id)
  if (item.assets.some((a) => a.path === asset.path)) return item
  return updateContentItem(db, id, { ...item, assets: [...item.assets, asset] })
}

export function removeAsset(db: Database.Database, id: number, path: string): ContentItem {
  const item = getContentItem(db, id)
  return updateContentItem(db, id, { ...item, assets: item.assets.filter((a) => a.path !== path) })
}

// ---------- lifecycle ----------

export function deleteContentItem(db: Database.Database, id: number): string {
  getContentItem(db, id)
  const batch = newBatchId()
  db.transaction(() => {
    const trashed = trashByWhere(db, 'content_items', `id = ? AND ${LIVE()}`, [id], batch)
    if (trashed === 0) throw new Error('Content item not found')
    removeOne(db, 'content', id)
  })()
  return batch
}

export function describeTrashed(db: Database.Database): TrashEntry[] {
  return (db.prepare('SELECT id, title, stage, deleted_at, delete_batch_id FROM content_items WHERE deleted_at IS NOT NULL').all() as {
    id: number; title: string; stage: string; deleted_at: string; delete_batch_id: string | null
  }[]).map((r) => ({
    type: 'content' as const,
    id: r.id,
    batchId: r.delete_batch_id,
    trashedAt: r.deleted_at,
    label: r.title,
    sublabel: `Content · ${r.stage}`
  }))
}

export function deleteContentItemForever(db: Database.Database, id: number): void {
  const changes = db.prepare('DELETE FROM content_items WHERE id = ? AND deleted_at IS NOT NULL').run(id).changes
  if (changes === 0) throw new Error('Content item is not in Trash')
  pruneLinks(db, 'content', [id])
  db.prepare(`DELETE FROM taggings WHERE entity_type = 'content' AND entity_id = ?`).run(id)
}

export function getContentByIds(db: Database.Database, ids: number[]): ContentItem[] {
  if (ids.length === 0) return []
  const marks = ids.map(() => '?').join(',')
  return (db.prepare(`SELECT * FROM content_items WHERE id IN (${marks}) AND ${LIVE()}`).all(...ids) as ContentRow[])
    .map(toItem)
}

// What a write changes besides the row: the search index and the tag rows.
function afterWrite(db: Database.Database, id: number): void {
  indexOne(db, 'content', id)
  const item = getContentItem(db, id)
  setEntityTags(db, 'content', id, item.tags)
}

// Per-stage counts for the board headers (published included).
export function stageCounts(items: ContentItem[]): Record<ContentStage, number> {
  const counts = Object.fromEntries(CONTENT_STAGES.map((s) => [s, 0])) as Record<ContentStage, number>
  for (const item of items) counts[item.stage]++
  return counts
}

// Items published per month ("2026-11" -> n), for Insights/Review later.
export function publishedPerMonth(db: Database.Database, from: string, to: string): { month: string; count: number }[] {
  return db.prepare(
    `SELECT substr(published_date, 1, 7) AS month, COUNT(*) AS count FROM content_items
     WHERE ${LIVE()} AND published_date IS NOT NULL AND published_date >= ? AND published_date <= ?
     GROUP BY month ORDER BY month`
  ).all(from, to) as { month: string; count: number }[]
}

export const CONTENT_TYPES_FOR_UI = CONTENT_TYPES
