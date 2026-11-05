// Logbook database queries. Each function receives the database as an
// argument, which keeps this file simple to test on its own.
//
// Deletes are SOFT (Phase 0): deleteEntry trashes the row and it can be
// restored from Trash (src/main/trash.ts shows it). Every listing below reads
// live rows only, so totals, tags and streaks never count trashed entries.
import type Database from 'better-sqlite3'
import { cleanTags, escapeLike, isDate, searchWhere } from './util'
import type { ParsedQuery } from '../shared/search'
import { AUTOMATION_TAG_CLEAN } from '../shared/automations'
import { logStreak } from '../shared/dashboard'
import { MOODS } from '../shared/types'
import type { LogEntry, LogEntryInput, LogFilter, LogSummary, Mood, SearchGroup, TagCount } from '../shared/types'
import { emitAutomation } from './automations'
import { emitLogbookEntryCreated } from './events'
import { LIVE, newBatchId, trashByWhere } from './repo'
import type { TrashEntry } from '../shared/trash'
import { indexOne, removeOne } from './searchIndex'

interface Row {
  id: number; date: string; title: string; body: string; mood: string | null
  tags: string; created_at: string; updated_at: string; deleted_at: string | null
}

const toEntry = (r: Row): LogEntry => ({
  id: r.id, date: r.date, title: r.title, body: r.body, mood: r.mood as Mood | null,
  tags: JSON.parse(r.tags), createdAt: r.created_at, updatedAt: r.updated_at
})

export function listEntries(db: Database.Database, f: LogFilter = {}): LogEntry[] {
  const where: string[] = [LIVE('logbook_entries')]
  const params: string[] = []
  if (f.from) { where.push('date >= ?'); params.push(f.from) }
  if (f.to) { where.push('date <= ?'); params.push(f.to) }
  if (f.tag) {
    where.push('EXISTS (SELECT 1 FROM json_each(tags) WHERE value = ?)')
    params.push(f.tag)
  }
  if (f.text?.trim()) {
    const like = `%${escapeLike(f.text.trim())}%`
    where.push("(title LIKE ? ESCAPE '\\' OR body LIKE ? ESCAPE '\\')")
    params.push(like, like)
  }
  const sql = `SELECT * FROM logbook_entries WHERE ${where.join(' AND ')}
               ORDER BY date DESC, id DESC`
  return (db.prepare(sql).all(...params) as Row[]).map(toEntry)
}

export function listTags(db: Database.Database): TagCount[] {
  return db.prepare(
    `SELECT value AS tag, COUNT(*) AS count
     FROM logbook_entries, json_each(logbook_entries.tags)
     WHERE ${LIVE('logbook_entries')}
     GROUP BY value ORDER BY count DESC, tag`
  ).all() as TagCount[]
}

function prepare(input: LogEntryInput) {
  if (!isDate(input.date)) throw new Error('Date must look like 2026-10-25')
  if (input.mood !== null && !MOODS.includes(input.mood)) throw new Error('Unknown mood')
  return {
    date: input.date,
    title: input.title.trim() || 'Untitled',
    body: input.body,
    mood: input.mood,
    tags: JSON.stringify(cleanTags(input.tags))
  }
}

function getEntry(db: Database.Database, id: number): LogEntry {
  const row = db.prepare('SELECT * FROM logbook_entries WHERE id = ?').get(id) as Row | undefined
  if (!row) throw new Error('Entry not found')
  return toEntry(row)
}

export function createEntry(db: Database.Database, input: LogEntryInput): LogEntry {
  const e = prepare(input)
  const now = new Date().toISOString()
  const info = db.prepare(
    `INSERT INTO logbook_entries (date, title, body, mood, tags, created_at, updated_at)
     VALUES (@date, @title, @body, @mood, @tags, @now, @now)`
  ).run({ ...e, now })
  const entry = getEntry(db, Number(info.lastInsertRowid))
  indexOne(db, 'logbook', entry.id)
  // Journal entry saved (automation event). Fires only for USER-written entries:
  // automation drafts carry the #automation tag and skip their own trigger — loop prevention.
  if (!cleanTags(input.tags).includes(AUTOMATION_TAG_CLEAN)) {
    emitAutomation(db, 'journal-entry-saved', `entry:${entry.id}`, { entryId: entry.id })
    // Announce the new entry on the event bus (see events.ts), so other
    // modules - like habits - can react WITHOUT this file importing them.
    emitLogbookEntryCreated(db, { date: entry.date })
  }
  return entry
}

export function updateEntry(db: Database.Database, id: number, input: LogEntryInput): LogEntry {
  const e = prepare(input)
  const info = db.prepare(
    `UPDATE logbook_entries SET date=@date, title=@title, body=@body, mood=@mood, tags=@tags,
     updated_at=@now WHERE id=@id AND ${LIVE('logbook_entries')}`
  ).run({ ...e, id, now: new Date().toISOString() })
  if (info.changes === 0) throw new Error('Entry not found')
  indexOne(db, 'logbook', id)
  return getEntry(db, id)
}

// Trashes the entry (Undo-able; it shows in Trash until restored or purged).
// Returns the delete batch id so the UI can undo the action.
export function deleteEntry(db: Database.Database, id: number): string {
  const batch = newBatchId()
  const trashed = trashByWhere(db, 'logbook_entries', `id = ? AND ${LIVE('logbook_entries')}`, [id], batch)
  if (trashed > 0) removeOne(db, 'logbook', id)
  else if (!db.prepare('SELECT 1 FROM logbook_entries WHERE id = ?').get(id)) throw new Error('Entry not found')
  const row = db.prepare('SELECT delete_batch_id AS b FROM logbook_entries WHERE id = ?').get(id) as { b: string | null }
  return row.b ?? batch
}

// Deletes a trashed entry for good. Only rows in Trash can go forever,
// so a wrong id can never destroy a live entry.
export function deleteEntryForever(db: Database.Database, id: number): void {
  const result = db.prepare('DELETE FROM logbook_entries WHERE id = ? AND deleted_at IS NOT NULL').run(id)
  if (result.changes === 0) throw new Error('Entry is not in Trash')
}

// Hydrates live entries by id (shared-search results do this). Missing and
// trashed ids are dropped, oldest-first-by-date is preserved by the caller's
// ordering needs - these come back date-ordered newest first.
export function getEntriesByIds(db: Database.Database, ids: number[]): LogEntry[] {
  if (ids.length === 0) return []
  const marks = ids.map(() => '?').join(',')
  return (db.prepare(`SELECT * FROM logbook_entries WHERE id IN (${marks}) AND ${LIVE('logbook_entries')}`).all(...ids) as Row[])
    .sort((a, b) => b.date.localeCompare(a.date) || b.id - a.id)
    .map(toEntry)
}

// Universal search: title, body, tags and date. Newest first.
export function searchEntries(db: Database.Database, q: ParsedQuery, limit: number): SearchGroup<LogEntry> {
  const w = searchWhere(q, ['title', 'body', 'tags', 'date'], 'tags')
  const items = (db.prepare(`SELECT * FROM logbook_entries WHERE ${w.sql} AND ${LIVE('logbook_entries')} ORDER BY date DESC, id DESC LIMIT ?`)
    .all(...w.params, limit) as Row[]).map(toEntry)
  const { n } = db.prepare(`SELECT COUNT(*) AS n FROM logbook_entries WHERE ${w.sql} AND ${LIVE('logbook_entries')}`).get(...w.params) as { n: number }
  return { items, total: n }
}

// Trash page + undo: one line per trashed entry (labels live here, beside the
// other SQL for this table).
export function describeTrashed(db: Database.Database): TrashEntry[] {
  return (db.prepare('SELECT id, delete_batch_id, deleted_at, title, body FROM logbook_entries WHERE deleted_at IS NOT NULL').all() as
    { id: number; delete_batch_id: string | null; deleted_at: string; title: string; body: string }[])
    .map((r) => ({
      type: 'logbook' as const, id: r.id, batchId: r.delete_batch_id, trashedAt: r.deleted_at,
      label: r.title || 'Untitled', sublabel: r.body ? r.body.slice(0, 80) : undefined
    }))
}

// Dashboard: the newest few entries.
export function recentEntries(db: Database.Database, limit: number): LogEntry[] {
  return (db.prepare(`SELECT * FROM logbook_entries WHERE ${LIVE('logbook_entries')} ORDER BY date DESC, id DESC LIMIT ?`).all(limit) as Row[]).map(toEntry)
}

// Dashboard: entry counts and the writing streak. `today` is "YYYY-MM-DD".
export function logbookSummary(db: Database.Database, today: string): LogSummary {
  const count = (sql: string, ...params: string[]) => (db.prepare(sql).get(...params) as { n: number }).n
  const userWritten = 'NOT EXISTS (SELECT 1 FROM json_each(logbook_entries.tags) WHERE value = ?)'
  const dates = (db.prepare(`SELECT DISTINCT date FROM logbook_entries WHERE date <= ? AND ${userWritten} AND ${LIVE('logbook_entries')}`)
    .all(today, AUTOMATION_TAG_CLEAN) as { date: string }[])
    .map((r) => r.date)
  return {
    total: count(`SELECT COUNT(*) AS n FROM logbook_entries WHERE ${userWritten} AND ${LIVE('logbook_entries')}`, AUTOMATION_TAG_CLEAN),
    thisMonth: count(`SELECT COUNT(*) AS n FROM logbook_entries WHERE substr(date, 1, 7) = ? AND ${userWritten} AND ${LIVE('logbook_entries')}`, today.slice(0, 7), AUTOMATION_TAG_CLEAN),
    streak: logStreak(dates, today)
  }
}
