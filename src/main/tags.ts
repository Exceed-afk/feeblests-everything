// The tags service (Phase 0). Owns the `tags` and `taggings` tables.
//
// Existing modules keep their JSON tag columns (logbook_entries.tags, trades,
// tasks); those keep working exactly as before. This service powers NEW kinds
// of items from Phase 2 on (Notes first) and the Tags page later, so it is
// built here once with the same normalisation the JSON columns rely on
// (src/shared/tags.ts).
import type Database from 'better-sqlite3'
import { normalizeTags, type TagCountEntry, type TagEntityType, type TagRow } from '../shared/tags'
import { nowIso } from './repo'

const toTag = (r: TagRowRaw): TagRow => ({ id: r.id, name: r.name, colour: r.colour ?? null, createdAt: r.created_at, updatedAt: r.updated_at })
interface TagRowRaw { id: number; name: string; colour: string | null; created_at: string; updated_at: string }

export const ENTITY_TABLES: Record<TagEntityType, string> = {
  logbook: 'logbook_entries',
  trade: 'trades',
  goal: 'savings_goals',
  task: 'tasks',
  note: 'notes',
  content: 'content_items'
}

export const isTagEntityType = (v: unknown): v is TagEntityType =>
  typeof v === 'string' && Object.hasOwn(ENTITY_TABLES, v)

// One row per tag, newest first.
export function listTags(db: Database.Database): TagRow[] {
  return (db.prepare('SELECT * FROM tags ORDER BY name').all() as TagRowRaw[]).map(toTag)
}

// Finds (or creates) the tag rows for these names; returns their ids in the
// order the names were given. Names are normalised first, so a caller cannot
// create 'Work' and 'work' by accident.
export function ensureTags(db: Database.Database, names: string[]): number[] {
  const unique = normalizeTags(names)
  const find = db.prepare('SELECT id FROM tags WHERE name = ?')
  const insert = db.prepare('INSERT INTO tags (name, created_at, updated_at) VALUES (?, ?, ?)')
  return unique.map((name) => {
    const row = find.get(name) as { id: number } | undefined
    if (row) return row.id
    const info = insert.run(name, nowIso(), nowIso())
    return Number(info.lastInsertRowid)
  })
}

// Replaces an entity's whole tagging set. Missing tags are created; a tagging
// that is no longer in the list is trashed (it could come back with the same
// tag, so it is soft, like everything else). Idempotent by construction.
export function setEntityTags(db: Database.Database, type: TagEntityType, entityId: number, names: string[]): void {
  db.transaction(() => {
    const keep = ensureTags(db, names)
    const keepSet = new Set(keep)
    const existing = (db.prepare('SELECT id, tag_id FROM taggings WHERE entity_type = ? AND entity_id = ? AND deleted_at IS NULL')
      .all(type, entityId) as { id: number; tag_id: number }[])
    const now = nowIso()
    for (const t of existing) {
      if (!keepSet.has(t.tag_id)) db.prepare('UPDATE taggings SET deleted_at = ?, updated_at = ? WHERE id = ?').run(now, now, t.id)
    }
    // Bring a previously-hidden tagging back rather than inserting a duplicate:
    // the unique index covers trashed rows too, so an INSERT would be ignored
    // and the tag would never reappear.
    const revive = db.prepare('UPDATE taggings SET deleted_at = NULL, updated_at = ? WHERE id = ?')
    const insert = db.prepare('INSERT INTO taggings (tag_id, entity_type, entity_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?)')
    for (const tagId of keep) {
      const existingRow = db.prepare('SELECT id, deleted_at FROM taggings WHERE tag_id = ? AND entity_type = ? AND entity_id = ?')
        .get(tagId, type, entityId) as { id: number; deleted_at: string | null } | undefined
      if (!existingRow) insert.run(tagId, type, entityId, now, now)
      else if (existingRow.deleted_at !== null) revive.run(now, existingRow.id)
    }
  })()
}

// The tags applied to one live entity (a hidden/missing entity has none).
export function tagsOf(db: Database.Database, type: TagEntityType, entityId: number): TagRow[] {
  return (db.prepare(
    `SELECT t.* FROM taggings tg JOIN tags t ON t.id = tg.tag_id
     WHERE tg.entity_type = ? AND tg.entity_id = ? AND tg.deleted_at IS NULL
     ORDER BY t.name`
  ).all(type, entityId) as TagRowRaw[]).map(toTag)
}

// The modules that keep their tags in a JSON column (logbook_entries.tags,
// trades.tags, tasks.tags) rather than in `taggings`. The Tags page must count
// BOTH stores, or every tag on a journal entry or a trade would read as zero.
// Notes and content items keep both in step, so they are counted once, from
// `taggings`.
export const JSON_TAG_TABLES: Partial<Record<TagEntityType, string>> = {
  logbook: 'logbook_entries',
  trade: 'trades',
  task: 'tasks'
}

const emptyCounts = (): Record<TagEntityType, number> => ({ logbook: 0, trade: 0, goal: 0, task: 0, note: 0, content: 0 })

// Every tag with its live item counts per tool. Trashed items are never
// counted; archived rows (habits/notes) still are, they are real items.
export function tagCounts(db: Database.Database): TagCountEntry[] {
  const tags = listTags(db)
  const out = new Map<number, TagCountEntry>()
  const byName = new Map<string, TagCountEntry>()
  for (const tag of tags) {
    const entry: TagCountEntry = { tag, counts: emptyCounts() }
    out.set(tag.id, entry)
    byName.set(tag.name, entry)
  }

  // Tracked in `taggings` (goals, notes, content items, and any module that
  // chose to use the shared service).
  for (const type of Object.keys(ENTITY_TABLES) as TagEntityType[]) {
    const rows = db.prepare(
      `SELECT tg.tag_id AS tagId, COUNT(*) AS n FROM taggings tg
       JOIN ${ENTITY_TABLES[type]} e ON e.id = tg.entity_id
       WHERE tg.entity_type = ? AND tg.deleted_at IS NULL AND e.deleted_at IS NULL
       GROUP BY tg.tag_id`
    ).all(type) as { tagId: number; n: number }[]
    for (const r of rows) {
      const entry = out.get(r.tagId)
      if (entry) entry.counts[type] = r.n
    }
  }

  // Tracked as JSON on the row (journal entries, trades, tasks). A tag that
  // exists only there needs a `tags` row of its own to be listed at all.
  for (const [type, table] of Object.entries(JSON_TAG_TABLES) as [TagEntityType, string][]) {
    const rows = db.prepare(
      `SELECT value AS name, COUNT(*) AS n FROM ${table}, json_each(${table}.tags)
       WHERE ${table}.deleted_at IS NULL GROUP BY value`
    ).all() as { name: string; n: number }[]
    for (const r of rows) {
      let entry = byName.get(r.name)
      if (!entry) {
        const [id] = ensureTags(db, [r.name])
        const row = db.prepare('SELECT * FROM tags WHERE id = ?').get(id) as TagRowRaw
        entry = { tag: toTag(row), counts: emptyCounts() }
        out.set(id, entry)
        byName.set(r.name, entry)
      }
      entry.counts[type] += r.n
    }
  }
  return [...out.values()].sort((a, b) => a.tag.name.localeCompare(b.tag.name))
}

// ---------- tag lifecycle (the Tags page) ----------

// Renames a tag everywhere. A name that is already taken merges into it, so a
// rename can never leave two rows with one name (the column is UNIQUE).
export function renameTag(db: Database.Database, from: string, to: string): TagRow {
  const [fromId] = ensureTags(db, [from])
  const [toId] = ensureTags(db, [to])
  if (fromId === toId) return toTag(db.prepare('SELECT * FROM tags WHERE id = ?').get(fromId) as TagRowRaw)
  db.transaction(() => moveTagEverywhere(db, fromId, toId))()
  return toTag(db.prepare('SELECT * FROM tags WHERE id = ?').get(toId) as TagRowRaw)
}

// Merges `from` into `into`: every item carrying `from` carries `into`.
export function mergeTags(db: Database.Database, from: string, into: string): TagRow {
  const [fromId] = ensureTags(db, [from])
  const [toId] = ensureTags(db, [into])
  if (fromId === toId) throw new Error('Pick two different tags to merge')
  db.transaction(() => moveTagEverywhere(db, fromId, toId))()
  return toTag(db.prepare('SELECT * FROM tags WHERE id = ?').get(toId) as TagRowRaw)
}

// Moves every reference of one tag to another, in both stores, then deletes the
// emptied tag row. Never touches the items themselves - only their tag list.
function moveTagEverywhere(db: Database.Database, fromId: number, toId: number): void {
  const fromName = (db.prepare('SELECT name FROM tags WHERE id = ?').get(fromId) as { name: string } | undefined)?.name
  const toName = (db.prepare('SELECT name FROM tags WHERE id = ?').get(toId) as { name: string } | undefined)?.name
  if (!fromName || !toName) throw new Error('Tag not found')

  // 1. `taggings` rows point at the new tag (reviving a hidden duplicate if
  // one already exists, so the unique index is never violated).
  const tags = db.prepare('SELECT id, entity_type, entity_id, deleted_at FROM taggings WHERE tag_id = ?').all(fromId) as {
    id: number; entity_type: string; entity_id: number; deleted_at: string | null
  }[]
  const now = nowIso()
  for (const row of tags) {
    const clash = db.prepare('SELECT id, deleted_at FROM taggings WHERE tag_id = ? AND entity_type = ? AND entity_id = ?')
      .get(toId, row.entity_type, row.entity_id) as { id: number; deleted_at: string | null } | undefined
    if (clash) {
      // The item already has the destination tag: drop this duplicate.
      db.prepare('DELETE FROM taggings WHERE id = ?').run(row.id)
      const revive = row.deleted_at === null || clash.deleted_at === null
      if (revive && clash.deleted_at !== null) db.prepare('UPDATE taggings SET deleted_at = NULL, updated_at = ? WHERE id = ?').run(now, clash.id)
    } else {
      db.prepare('UPDATE taggings SET tag_id = ?, updated_at = ? WHERE id = ?').run(toId, now, row.id)
    }
  }

  // 2. JSON tag columns on the modules that keep their own list.
  for (const table of Object.values(JSON_TAG_TABLES)) {
    const rows = db.prepare(
      `SELECT id, tags FROM ${table} WHERE deleted_at IS NULL AND EXISTS (SELECT 1 FROM json_each(tags) WHERE value = ?)`
    ).all(fromName) as { id: number; tags: string }[]
    const update = db.prepare(`UPDATE ${table} SET tags = ?, updated_at = ? WHERE id = ?`)
    for (const row of rows) {
      const list = (JSON.parse(row.tags) as string[]).map((t) => normalizeTags([t])[0] ?? t)
      const next: string[] = []
      for (const t of list) {
        const name = t === fromName ? toName : t
        if (name && !next.includes(name)) next.push(name)
      }
      update.run(JSON.stringify(next), now, row.id)
    }
  }

  // 3. Notes and content items also mirror their tags in the JSON column.
  for (const table of ['notes', 'content_items']) {
    const rows = db.prepare(
      `SELECT id, tags FROM ${table} WHERE deleted_at IS NULL AND EXISTS (SELECT 1 FROM json_each(tags) WHERE value = ?)`
    ).all(fromName) as { id: number; tags: string }[]
    if (rows.length === 0) continue
    const update = db.prepare(`UPDATE ${table} SET tags = ?, updated_at = ? WHERE id = ?`)
    for (const row of rows) {
      const next: string[] = []
      for (const t of JSON.parse(row.tags) as string[]) {
        const name = t === fromName ? toName : t
        if (name && !next.includes(name)) next.push(name)
      }
      update.run(JSON.stringify(next), now, row.id)
    }
  }

  // The emptied tag goes for good: a rename is not a delete of any item.
  db.prepare('DELETE FROM tags WHERE id = ?').run(fromId)
}

// Deletes a tag everywhere. Only the tagging is removed; the items stay.
// Returns how many items lost the tag.
export function deleteTag(db: Database.Database, name: string): number {
  const normalised = normalizeTags([name])[0]
  if (!normalised) throw new Error('Tag name is empty')
  const row = db.prepare('SELECT id FROM tags WHERE name = ?').get(normalised) as { id: number } | undefined
  if (!row) throw new Error('Tag not found')
  let touched = 0
  db.transaction(() => {
    const now = nowIso()
    touched += db.prepare('UPDATE taggings SET deleted_at = ?, updated_at = ? WHERE tag_id = ? AND deleted_at IS NULL').run(now, now, row.id).changes
    for (const table of Object.values(JSON_TAG_TABLES)) {
      const rows = db.prepare(
        `SELECT id, tags FROM ${table} WHERE deleted_at IS NULL AND EXISTS (SELECT 1 FROM json_each(tags) WHERE value = ?)`
      ).all(normalised) as { id: number; tags: string }[]
      const update = db.prepare(`UPDATE ${table} SET tags = ?, updated_at = ? WHERE id = ?`)
      for (const r of rows) {
        update.run(JSON.stringify((JSON.parse(r.tags) as string[]).filter((t) => t !== normalised)), now, r.id)
        touched++
      }
    }
    for (const table of ['notes', 'content_items']) {
      const rows = db.prepare(
        `SELECT id, tags FROM ${table} WHERE deleted_at IS NULL AND EXISTS (SELECT 1 FROM json_each(tags) WHERE value = ?)`
      ).all(normalised) as { id: number; tags: string }[]
      const update = db.prepare(`UPDATE ${table} SET tags = ?, updated_at = ? WHERE id = ?`)
      for (const r of rows) {
        update.run(JSON.stringify((JSON.parse(r.tags) as string[]).filter((t) => t !== normalised)), now, r.id)
        touched++
      }
    }
    // The tag row itself goes; `tags` is not a user-facing table, nothing is lost.
    db.prepare('DELETE FROM taggings WHERE tag_id = ?').run(row.id)
    db.prepare('DELETE FROM tags WHERE id = ?').run(row.id)
  })()
  return touched
}

// Every live item carrying a tag, grouped by tool for the mixed-type list.
export interface TaggedItemRef { type: TagEntityType; id: number; label: string; sublabel?: string }

export function listTaggedItems(db: Database.Database, name: string): TaggedItemRef[] {
  const normalised = normalizeTags([name])[0]
  if (!normalised) return []
  const out: TaggedItemRef[] = []
  const pushLogbook = db.prepare(
    `SELECT id, title AS label, date AS sublabel FROM logbook_entries
     WHERE deleted_at IS NULL AND EXISTS (SELECT 1 FROM json_each(tags) WHERE value = ?) ORDER BY date DESC`
  )
  for (const r of pushLogbook.all(normalised) as TaggedItemRef[]) out.push({ ...r, type: 'logbook' })

  const tradeRows = db.prepare(
    `SELECT id, asset || ' ' || direction AS label, date AS sublabel FROM trades
     WHERE deleted_at IS NULL AND EXISTS (SELECT 1 FROM json_each(tags) WHERE value = ?) ORDER BY date DESC`
  ).all(normalised) as { id: number; label: string; sublabel: string }[]
  for (const r of tradeRows) out.push({ ...r, type: 'trade' })

  const taskRows = db.prepare(
    `SELECT id, title AS label, status AS sublabel FROM tasks
     WHERE deleted_at IS NULL AND EXISTS (SELECT 1 FROM json_each(tags) WHERE value = ?) ORDER BY id DESC`
  ).all(normalised) as { id: number; label: string; sublabel: string }[]
  for (const r of taskRows) out.push({ ...r, type: 'task' })

  for (const [type, table, label, sub] of [
    ['goal', 'savings_goals', 'name', 'notes'],
    ['note', 'notes', 'title', 'updated_at'],
    ['content', 'content_items', 'title', 'stage']
  ] as const) {
    const rows = db.prepare(
      `SELECT e.id, e.${label} AS label, e.${sub} AS sublabel FROM ${table} e
       JOIN taggings tg ON tg.entity_type = ? AND tg.entity_id = e.id AND tg.deleted_at IS NULL
       JOIN tags t ON t.id = tg.tag_id AND t.name = ?
       WHERE e.deleted_at IS NULL ORDER BY e.id DESC`
    ).all(type, normalised) as { id: number; label: string; sublabel: string }[]
    for (const r of rows) out.push({ ...r, type })
  }
  return out
}

// Changes a tag's colour (NULL = back to the palette/setting colour).
export function setTagColour(db: Database.Database, name: string, colour: string | null): void {
  const id = ensureTags(db, [name])[0]
  db.prepare('UPDATE tags SET colour = ?, updated_at = ? WHERE id = ?').run(colour, nowIso(), id)
}
