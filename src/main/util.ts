import type { ParsedQuery } from '../shared/search'
import { normalizeTags } from '../shared/tags'

// Small helpers shared by the module query files.

// "  #Work " -> "work"; removes blanks and duplicates. Delegates to the one
// shared rule so JSON tag columns and the `tags` table can never disagree
// (a rename or the Tags page matches on the normalised name).
export const cleanTags = (tags: string[]): string[] => normalizeTags(tags)

// Make % and _ in the user's search text match literally.
export const escapeLike = (t: string): string => t.replace(/[\\%_]/g, '\\$&')

export const isDate = (s: string): boolean => /^\d{4}-\d{2}-\d{2}$/.test(s)

// Turns a parsed search into SQL. Every word must appear in at least one of
// `columns`, and every #tag must match the start of one of the row's tags.
// Pass tagsColumn = null for tables without tags (a #tag then matches nothing).
export function searchWhere(q: ParsedQuery, columns: string[], tagsColumn: string | null): { sql: string; params: string[] } {
  const where: string[] = []
  const params: string[] = []
  for (const term of q.terms) {
    const like = `%${escapeLike(term)}%`
    where.push('(' + columns.map((c) => `${c} LIKE ? ESCAPE '\\'`).join(' OR ') + ')')
    columns.forEach(() => params.push(like))
  }
  for (const tag of q.tags) {
    if (tagsColumn) {
      where.push(`EXISTS (SELECT 1 FROM json_each(${tagsColumn}) WHERE value LIKE ? ESCAPE '\\')`)
      params.push(`${escapeLike(tag)}%`)
    } else {
      where.push('0')
    }
  }
  return { sql: where.length ? where.join(' AND ') : '1', params }
}

// Today's date on this computer's clock, "YYYY-MM-DD" (toISOString would use UTC).
export const localDate = (d: Date = new Date()): string =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

// A real calendar day, not just the shape: 2026-02-30 and 2026-13-01 are refused.
// (The same rule src/shared/backup.ts applies to dates in an imported file.)
export function isRealDate(s: string): boolean {
  if (!isDate(s)) return false
  const [y, m, d] = s.split('-').map(Number)
  const date = new Date(Date.UTC(y, m - 1, d))
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d
}
