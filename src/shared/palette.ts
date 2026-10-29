// Everything the command palette decides, with no React and no DOM, so the rules can be checked in a plain test
// (tests/palette.ts). The window itself is components/CommandPalette.tsx.
//
// The palette knows nothing about tools or actions. It is given a list of "entries" (a title, a group label and
// some keywords each) and ranks them against what the user typed. Tools come from the registry (tools.ts) and
// actions from actions.ts; lib/paletteItems.ts turns both into entries.

export interface PaletteEntry {
  id: string // unique across everything the palette shows ("tool:trades", "action:toggle-theme")
  title: string // what the row says, and what typing is matched against first
  group: string // small label on the right: a category name, or "Action". Also searchable ("money" finds Trades).
  keywords: string[] // extra lowercase words that should find the entry
}

export interface FuzzyMatch { score: number; indices: number[] } // indices = positions of the matched letters in the text
export interface Hit<T extends PaletteEntry> { entry: T; score: number; titleIndices: number[] }

const isWordStart = (text: string, i: number): boolean => i === 0 || !/[a-z0-9]/.test(text[i - 1])

// Does `needle` match `text`? Not case sensitive. Returns null for no match, otherwise a score (higher is better).
//  1. The needle appears as a run of text ("trad" in "Trades"): always scores above any scattered match,
//     most of all at the start of the text or of a word.
//  2. Otherwise its letters must appear in order ("trd" in "Trades", "lgb" in "Logbook"). Matches that are
//     spread too thin are rejected, so "gold" does not find "good old days".
export function fuzzyMatch(needle: string, text: string): FuzzyMatch | null {
  const n = needle.toLowerCase()
  const h = text.toLowerCase()
  if (!n || n.length > h.length) return null

  let best: FuzzyMatch | null = null
  for (let at = h.indexOf(n); at >= 0; at = h.indexOf(n, at + 1)) {
    const score = 100 + n.length * 2 + (at === 0 ? 50 : isWordStart(h, at) ? 30 : 0) + (n.length === h.length ? 30 : 0)
    if (!best || score > best.score) best = { score, indices: Array.from({ length: n.length }, (_, k) => at + k) }
  }
  if (best) return best

  // Letters in order. Try every place the first letter could start, keep the best.
  for (let start = h.indexOf(n[0]); start >= 0; start = h.indexOf(n[0], start + 1)) {
    const indices = [start]
    for (let k = 1, from = start + 1; k < n.length; k++, from = indices[k - 1] + 1) {
      const next = h.indexOf(n[k], from)
      if (next < 0) break
      indices.push(next)
    }
    if (indices.length < n.length) break // later starts have even less text left to match in
    if (indices[indices.length - 1] - start + 1 > n.length + 3) continue // too spread out: at most 3 stray letters in between
    let score = start === 0 ? 10 : 0
    indices.forEach((i, k) => {
      score += 6
      if (k > 0 && i === indices[k - 1] + 1) score += 5
      else if (k > 0) score -= Math.min(i - indices[k - 1] - 1, 3)
      if (isWordStart(h, i)) score += 4
    })
    score = Math.max(1, Math.min(score, 90))
    if (!best || score > best.score) best = { score, indices }
  }
  return best
}

const TITLE_WEIGHT = 3
const KEYWORD_WEIGHT = 1.5
const GROUP_WEIGHT = 1
const MAX_WORDS = 6

// Every word the user typed must match the title, the group or a keyword (so "money trades" narrows down).
// The score adds up each word's best match; the title counts most.
function scoreEntry<T extends PaletteEntry>(entry: T, words: string[]): Hit<T> | null {
  let total = 0
  const marked = new Set<number>()
  for (const word of words) {
    let best = 0
    const inTitle = fuzzyMatch(word, entry.title)
    if (inTitle) { best = inTitle.score * TITLE_WEIGHT; inTitle.indices.forEach((i) => marked.add(i)) }
    const inGroup = fuzzyMatch(word, entry.group)
    if (inGroup) best = Math.max(best, inGroup.score * GROUP_WEIGHT)
    for (const k of entry.keywords) {
      const m = fuzzyMatch(word, k)
      if (m) best = Math.max(best, m.score * KEYWORD_WEIGHT)
    }
    if (best === 0) return null
    total += best
  }
  return { entry, score: total, titleIndices: [...marked].sort((a, b) => a - b) }
}

// The entries that match the query, best first. Equal scores keep their original order (registry order).
// An empty or blank query matches nothing: the palette shows its "recent" list instead.
export function searchEntries<T extends PaletteEntry>(entries: T[], query: string): Hit<T>[] {
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean).slice(0, MAX_WORDS)
  if (words.length === 0) return []
  return entries
    .map((e) => scoreEntry(e, words))
    .filter((h): h is Hit<T> => h !== null)
    .sort((a, b) => b.score - a.score)
}

// ---------- recently used tools ----------

export const MAX_RECENT_TOOLS = 8

// The id goes to the front; if it was already in the list it moves there (no repeats); the list is capped.
// Returns the SAME array when nothing changes (the tool is already first), so the caller can skip saving.
export function pushRecent(list: string[], id: string, max = MAX_RECENT_TOOLS): string[] {
  if (list[0] === id) return list
  return [id, ...list.filter((x) => x !== id)].slice(0, max)
}

// Turns saved ids into the real items, most recent first. Ids that no longer exist (a removed tool) are
// skipped, and so is `skipId` (the page you are already on).
export function resolveRecent<T extends { id: string }>(ids: string[], items: T[], skipId?: string, limit = MAX_RECENT_TOOLS): T[] {
  const byId = new Map(items.map((i) => [i.id, i]))
  return ids.filter((id) => id !== skipId).map((id) => byId.get(id)).filter((i): i is T => i !== undefined).slice(0, limit)
}

// ---------- actions (things the palette can do besides opening a tool) ----------

// What every action must declare, without anything React-specific. The renderer's list (src/renderer/src/actions.ts)
// adds the icon and the function to run.
export interface ActionMeta {
  id: string // lowercase letters, digits and dashes: "toggle-theme"
  title: string // the row's text: "Switch theme"
  keywords?: string[] // lowercase words that should find it: ['dark', 'light', 'mode']
}

// Same idea as validateTools: a list of mistakes (empty = fine), so a typo gives a clear message at start-up.
export function validateActions(actions: ActionMeta[]): string[] {
  const problems: string[] = []
  const seen = new Set<string>()
  actions.forEach((a, i) => {
    const who = `Action #${i + 1} (${a.id || 'no id'})`
    if (!/^[a-z][a-z0-9-]*$/.test(a.id)) problems.push(`${who}: the id must be lowercase letters, digits and dashes, starting with a letter.`)
    else if (seen.has(a.id)) problems.push(`${who}: the id "${a.id}" is already used by another action.`)
    else seen.add(a.id)
    if (!a.title.trim()) problems.push(`${who}: the title is empty.`)
    if ((a.keywords ?? []).some((k) => !k.trim() || k !== k.trim().toLowerCase())) problems.push(`${who}: keywords must be non-empty and lowercase.`)
  })
  return problems
}
