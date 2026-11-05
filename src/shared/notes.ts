// Notes (Phase 2): shapes and pure rules.
//
// A note is undated markdown material: ideas, reference, checklists, meeting
// notes. The Logbook stays the dated journal. Pinned notes sort first; archived
// notes leave the normal list without being trashed.
import { normalizeTagName } from './tags'

export interface Note {
  id: number
  title: string
  body: string
  tags: string[]
  pinned: boolean
  archived: boolean
  createdAt: string
  updatedAt: string
  // Filled in by the service for list views; not stored.
  wordCount?: number
  checklistDone?: number
  checklistTotal?: number
}

export type NoteInput = Pick<Note, 'title' | 'body' | 'tags' | 'pinned' | 'archived'>

// How the list is filtered. `tag` uses the same normalisation as everywhere.
export interface NoteFilter {
  text?: string
  tag?: string
  archived?: boolean // undefined = only live (unarchived) notes
}

// Display order: pinned first, then most recently edited. The service sorts in
// SQL; this is the single description of the rule, used by tests.
export function sortNotes<T extends Pick<Note, 'pinned' | 'updatedAt' | 'id'>>(notes: T[]): T[] {
  return [...notes].sort((a, b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1
    const byDate = b.updatedAt.localeCompare(a.updatedAt)
    return byDate !== 0 ? byDate : b.id - a.id
  })
}

// A note's title for lists and links: the first non-empty heading or line, so a
// note that starts with "# Shopping list" needs no separate title field.
export function deriveTitle(body: string, fallback = 'Untitled note'): string {
  for (const line of body.split('\n')) {
    const cleaned = line.replace(/^\s{0,3}#{1,6}\s+/, '').trim()
    if (cleaned) return cleaned.slice(0, 200)
  }
  return fallback
}

// Explicit tags on the note plus any `#tag` typed in the body, deduplicated.
// (The body scan lives in src/shared/markdown.ts findHashtags; this only merges.)
export function mergeNoteTags(tags: string[], fromBody: string[]): string[] {
  const out: string[] = []
  for (const raw of [...tags, ...fromBody]) {
    const name = normalizeTagName(raw)
    if (name && !out.includes(name)) out.push(name)
  }
  return out
}
