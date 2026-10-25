// Shortens long text to a window around the first search match, so a result
// shows WHY it matched instead of just the start of a long entry.
const WIDTH = 160

export function makeSnippet(text: string, terms: string[]): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  if (flat.length <= WIDTH) return flat
  const lower = flat.toLowerCase()
  const hits = terms.map((t) => lower.indexOf(t.toLowerCase())).filter((i) => i >= 0)
  if (hits.length === 0) return flat.slice(0, WIDTH) + '…'
  const start = Math.max(0, Math.min(...hits) - 50)
  const end = Math.min(flat.length, start + WIDTH)
  return (start > 0 ? '…' : '') + flat.slice(start, end) + (end < flat.length ? '…' : '')
}
