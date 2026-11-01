// Logbook database queries. Each function receives the database as an
// argument, which keeps this file simple to test on its own.
import type Database from 'better-sqlite3'
import { cleanTags, escapeLike, isDate, searchWhere } from './util'
import type { ParsedQuery } from '../shared/search'
import { AUTOMATION_TAG_CLEAN } from '../shared/automations'
import { logStreak } from '../shared/dashboard'
import { MOODS } from '../shared/types'
import type { LogEntry, LogEntryInput, LogFilter, LogSummary, Mood, SearchGroup, TagCount } from '../shared/types'
import { emitAutomation } from './automations'
import { emitLogbookEntryCreated } from './events'

interface Row {
  id: number; date: string; title: string; body: string; mood: string | null
  tags: string; created_at: string; updated_at: string
}

const toEntry = (r: Row): LogEntry => ({
  id: r.id, date: r.date, title: r.title, body: r.body, mood: r.mood as Mood | null,
  tags: JSON.parse(r.tags), createdAt: r.created_at, updatedAt: r.updated_at
})

export function listEntries(db: Database.Database, f: LogFilter = {}): LogEntry[] {
  const where: string[] = []
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
  const sql = `SELECT * FROM logbook_entries ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
               ORDER BY date DESC, id DESC`
  return (db.prepare(sql).all(...params) as Row[]).map(toEntry)
}

export function listTags(db: Database.Database): TagCount[] {
  return db.prepare(
    `SELECT value AS tag, COUNT(*) AS count
     FROM logbook_entries, json_each(logbook_entries.tags)
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
  db.prepare(
    `UPDATE logbook_entries SET date=@date, title=@title, body=@body, mood=@mood, tags=@tags,
     updated_at=@now WHERE id=@id`
  ).run({ ...e, id, now: new Date().toISOString() })
  return getEntry(db, id)
}

export function deleteEntry(db: Database.Database, id: number): void {
  db.prepare('DELETE FROM logbook_entries WHERE id = ?').run(id)
}

// Universal search: title, body, tags and date. Newest first.
export function searchEntries(db: Database.Database, q: ParsedQuery, limit: number): SearchGroup<LogEntry> {
  const w = searchWhere(q, ['title', 'body', 'tags', 'date'], 'tags')
  const items = (db.prepare(`SELECT * FROM logbook_entries WHERE ${w.sql} ORDER BY date DESC, id DESC LIMIT ?`)
    .all(...w.params, limit) as Row[]).map(toEntry)
  const { n } = db.prepare(`SELECT COUNT(*) AS n FROM logbook_entries WHERE ${w.sql}`).get(...w.params) as { n: number }
  return { items, total: n }
}

// Dashboard: the newest few entries.
export function recentEntries(db: Database.Database, limit: number): LogEntry[] {
  return (db.prepare('SELECT * FROM logbook_entries ORDER BY date DESC, id DESC LIMIT ?').all(limit) as Row[]).map(toEntry)
}

// Dashboard: entry counts and the writing streak. `today` is "YYYY-MM-DD".
export function logbookSummary(db: Database.Database, today: string): LogSummary {
  const count = (sql: string, ...params: string[]) => (db.prepare(sql).get(...params) as { n: number }).n
  const userWritten = 'NOT EXISTS (SELECT 1 FROM json_each(logbook_entries.tags) WHERE value = ?)'
  const dates = (db.prepare(`SELECT DISTINCT date FROM logbook_entries WHERE date <= ? AND ${userWritten}`)
    .all(today, AUTOMATION_TAG_CLEAN) as { date: string }[])
    .map((r) => r.date)
  return {
    total: count(`SELECT COUNT(*) AS n FROM logbook_entries WHERE ${userWritten}`, AUTOMATION_TAG_CLEAN),
    thisMonth: count(`SELECT COUNT(*) AS n FROM logbook_entries WHERE substr(date, 1, 7) = ? AND ${userWritten}`, today.slice(0, 7), AUTOMATION_TAG_CLEAN),
    streak: logStreak(dates, today)
  }
}
