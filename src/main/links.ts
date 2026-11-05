// The links service (Phase 0). Cross-table service like trash.ts: it owns the
// `links` table and reads the endpoint tables only for labels and liveness.
//
// Rules (from the plan):
//  - a link is stored ONCE with a normalised direction, and every read shows
//    it from BOTH sides;
//  - the same link twice is impossible (unique index + idempotent add);
//  - a link whose endpoint is trashed or gone is HIDDEN at read time, and a
//    restored item makes it reappear (nothing here edits the endpoint rows).
import type Database from 'better-sqlite3'
import { DEFAULT_RELATION, LINK_TYPES, type LinkedItemRef, isLinkType, orderLinkPair, type LinkType } from '../shared/links'
import { nowIso } from './repo'

interface LinkRow {
  id: number; source_type: string; source_id: number; target_type: string; target_id: number
  relation: string; created_at: string; deleted_at: string | null
}

// Adds (or replays) a link between two live items. Returns the link id.
export function addLink(
  db: Database.Database,
  a: { type: LinkType; id: number },
  b: { type: LinkType; id: number },
  relation: string = DEFAULT_RELATION
): number {
  if (!isLinkType(a.type) || !isLinkType(b.type)) throw new Error('That kind of item cannot be linked')
  if (!Number.isInteger(a.id) || !Number.isInteger(b.id) || a.id <= 0 || b.id <= 0) throw new Error('Link ids must be positive')
  if (a.type === b.type && a.id === b.id) throw new Error('An item cannot be linked to itself')
  if (relation.trim() === '') relation = DEFAULT_RELATION
  const { source, target } = orderLinkPair(a, b)
  // The unique index covers trashed rows too, so a link that was removed by
  // hand (or a wiki link deleted from a note and typed again) still has a row.
  // Reviving it is what makes re-adding idempotent instead of a UNIQUE error.
  const existing = db.prepare(
    'SELECT id, deleted_at FROM links WHERE source_type = ? AND source_id = ? AND target_type = ? AND target_id = ? AND relation = ?'
  ).get(source.type, source.id, target.type, target.id, relation) as { id: number; deleted_at: string | null } | undefined
  if (existing) {
    if (existing.deleted_at !== null) db.prepare('UPDATE links SET deleted_at = NULL WHERE id = ?').run(existing.id)
    return existing.id
  }
  const info = db.prepare(
    `INSERT INTO links (source_type, source_id, target_type, target_id, relation, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(source.type, source.id, target.type, target.id, relation, nowIso())
  return Number(info.lastInsertRowid)
}

// Hides a link (it comes back the day the app decides it is stale, or never:
// the Trash page does not list links - removing a link is not deleting an
// item, so it does not need undo).
export function removeLink(db: Database.Database, linkId: number): void {
  db.prepare('UPDATE links SET deleted_at = ? WHERE id = ? AND deleted_at IS NULL').run(nowIso(), linkId)
}

// One label query per type. Lives here (not per module) because the RESULT is
// a link row, not a domain row; the shapes match the describeTrashed labels.
const ENDPOINT: { type: LinkType; sql: string }[] = [
  { type: 'logbook', sql: 'SELECT title AS l, date AS s FROM logbook_entries WHERE id = ? AND deleted_at IS NULL' },
  { type: 'trade', sql: 'SELECT asset AS l, date AS s FROM trades WHERE id = ? AND deleted_at IS NULL' },
  { type: 'goal', sql: 'SELECT name AS l FROM savings_goals WHERE id = ? AND deleted_at IS NULL' },
  { type: 'task', sql: "SELECT title AS l, COALESCE(notes, '') AS s FROM tasks WHERE id = ? AND deleted_at IS NULL" },
  { type: 'note', sql: "SELECT title AS l, 'Note' AS s FROM notes WHERE id = ? AND deleted_at IS NULL" },
  { type: 'content', sql: "SELECT title AS l, platform AS s FROM content_items WHERE id = ? AND deleted_at IS NULL" }
]

function resolveEndpoint(db: Database.Database, type: string, id: number): { label: string; sublabel?: string } | null {
  const spec = ENDPOINT.find((e) => e.type === type)
  if (!spec) return null
  const row = db.prepare(spec.sql).get(id) as { l: string; s?: string } | undefined
  if (!row) return null
  return { label: row.l || 'Untitled', sublabel: row.s || undefined }
}

// Every link the (type, id) item takes part in, from both sides, ordered by
// the item it points to. Trashed or missing endpoints are skipped here - that
// is exactly how a link reappears when its item is restored.
export function listLinksFor(db: Database.Database, type: LinkType, id: number): LinkedItemRef[] {
  if (!isLinkType(type)) throw new Error('That kind of item cannot be linked')
  const rows = db.prepare(
    `SELECT * FROM links WHERE deleted_at IS NULL
       AND ((source_type = ? AND source_id = ?) OR (target_type = ? AND target_id = ?))
     ORDER BY created_at DESC, id DESC`
  ).all(type, id, type, id) as LinkRow[]
  const out: LinkedItemRef[] = []
  for (const r of rows) {
    const outgoing = r.source_type === type && r.source_id === id
    const otherType = outgoing ? r.target_type : r.source_type
    const otherId = outgoing ? r.target_id : r.source_id
    if (!isLinkType(otherType)) continue
    const endpoint = resolveEndpoint(db, otherType, otherId)
    if (!endpoint) continue // trashed or gone: hidden until it comes back
    out.push({ linkId: r.id, type: otherType, id: otherId, label: endpoint.label, sublabel: endpoint.sublabel, direction: outgoing ? 'out' : 'in', relation: r.relation, createdAt: r.created_at })
  }
  return out
}

// ---------- keeping the table honest when items die for good ----------

// Removes (for good) every link that POINTS AT one of these ids. Called from
// trash.ts after delete-forever and purge; hidden links were already out of
// every list, but stale rows should not sit in the file forever.
export function pruneLinks(db: Database.Database, type: LinkType, ids: number[]): void {
  if (ids.length === 0) return
  const marks = ids.map(() => '?').join(',')
  db.prepare(`DELETE FROM links WHERE (source_type = ? AND source_id IN (${marks})) OR (target_type = ? AND target_id IN (${marks}))`)
    .run(type, ...ids, type, ...ids)
}

// True when any of these (type, id) endpoints still has a link. Unused
// guard-rail today; cheap and simple.
export const LINKABLE_TYPES = LINK_TYPES
