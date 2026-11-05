// Pure, DOM-free pieces of note markdown (Phase 2).
//
// This file has NO imports on purpose: it is pulled in by the MAIN process
// (note titles, search text, tag/checklist scanning) where `marked` and
// DOMPurify cannot load — both are ESM/browser-only. The renderer imports the
// same helpers from here, and src/shared/markdown.ts adds rendering on top.

// ---------- wiki links ----------
// `[[Note title]]` becomes a link marked with a custom protocol so the renderer
// can intercept it and open the note in-app instead of sending it elsewhere.
export const WIKI_PROTOCOL = 'note:'

export interface WikiLinkRef { title: string; slug: string }

// The matching key for a note title: lowercase, collapsed whitespace. Two notes
// with the same key are ambiguous; the service resolves the oldest match.
export const wikiSlug = (title: string): string => title.trim().toLowerCase().replace(/\s+/g, ' ')

const WIKI_RE = /\[\[([^\[\]]{1,200})\]\]/g

// Every wiki link inside a piece of markdown, in order, with duplicates removed.
export function findWikiLinks(text: string): WikiLinkRef[] {
  const seen = new Set<string>()
  const out: WikiLinkRef[] = []
  for (const match of text.matchAll(WIKI_RE)) {
    const title = match[1].trim()
    const slug = wikiSlug(title)
    if (!title || seen.has(slug)) continue
    seen.add(slug)
    out.push({ title, slug })
  }
  return out
}

// Splits markdown into code (fenced blocks and inline spans) and the rest, so
// callers can transform plain text only. Each part keeps its own text; joining
// every part's text in order gives the original string back. Unterminated
// fences run to the end, which is what the user is still typing.
export function splitCodeAndText(text: string): { text: string; code: boolean }[] {
  const parts: { text: string; code: boolean }[] = []
  let plain = ''
  let i = 0

  const flushPlain = (): void => {
    if (plain) { parts.push({ text: plain, code: false }); plain = '' }
  }

  while (i < text.length) {
    // Fenced block: a line that starts with ``` or ~~~, through its closing line.
    if ((i === 0 || text[i - 1] === '\n') && /^(```|~~~)/.test(text.slice(i, i + 3))) {
      flushPlain()
      const fence = text.slice(i, i + 3)
      const end = text.indexOf(fence, i + 3)
      if (end === -1) { parts.push({ text: text.slice(i), code: true }); return parts }
      const close = text.indexOf('\n', end + 3)
      const stop = close === -1 ? text.length : close + 1
      parts.push({ text: text.slice(i, stop), code: true })
      i = stop
      continue
    }
    // Inline code span: paired backticks on the same line.
    if (text[i] === '`') {
      const end = text.indexOf('`', i + 1)
      const newline = text.indexOf('\n', i + 1)
      if (end !== -1 && (newline === -1 || end < newline)) {
        flushPlain()
        parts.push({ text: text.slice(i, end + 1), code: true })
        i = end + 1
        continue
      }
    }
    plain += text[i]
    i++
  }
  flushPlain()
  return parts
}

// Replaces `[[Title]]` with `[Title](note:slug)`. Code spans and fenced blocks
// are skipped so a note can document the syntax without creating links.
export function linkifyWikiLinks(text: string): string {
  return splitCodeAndText(text).map((part) => part.code ? part.text : part.text.replace(WIKI_RE, (_, raw: string) => {
    const title = raw.trim()
    return `[${title}](${WIKI_PROTOCOL}${encodeURIComponent(wikiSlug(title))})`
  })).join('')
}

// ---------- checklists ----------
// `- [ ] text` and `- [x] text` anywhere outside code. The UI turns these into
// "Send to Tasks"; the count is also the note's checklist progress.
export interface ChecklistItem { text: string; done: boolean; line: number }

export function findChecklistItems(markdown: string): ChecklistItem[] {
  const items: ChecklistItem[] = []
  const parts = splitCodeAndText(markdown)
  let line = 0
  for (const part of parts) {
    for (const row of part.text.split('\n')) {
      if (!part.code) {
        const m = /^\s*[-*+]\s+\[([ xX])\]\s+(.*)$/.exec(row)
        if (m) items.push({ text: m[2].trim(), done: m[1].toLowerCase() === 'x', line })
      }
      line++
    }
  }
  return items
}

// Marks one checklist item done/undone in the markdown, by its position among
// the checklist items (not by text, so duplicates are still distinguishable).
export function setChecklistItemDone(markdown: string, index: number, done: boolean): string {
  const rows = markdown.split('\n')
  const items = findChecklistItems(markdown)
  const target = items[index]
  if (!target) return markdown
  rows[target.line] = rows[target.line].replace(/\[([ xX])\]/, done ? '[x]' : '[ ]')
  return rows.join('\n')
}

// ---------- word count ----------
export function wordCount(markdown: string): number {
  const plain = markdown
    .replace(/```[\s\S]*?(?:```|$)/g, ' ')   // fenced code
    .replace(/`[^`]*`/g, ' ')                 // inline code
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, ' $1 ') // links/images: keep the label
    .replace(/[#>*_~\-]+/g, ' ')              // markdown marks
  const words = plain.match(/[\p{L}\p{N}][\p{L}\p{N}'’\-]*/gu)
  return words ? words.length : 0
}

// ---------- tags in the text ----------
// `#work` anywhere in a note is a tag, the same rules as every other surface
// (trimmed, lowercased, `parent/child` kept). Skipped inside code and inside a
// word (`a#b`), and headings (`# Title`) are not tags.
// The normalisation is inlined (trim/lowercase/strip '#', collapse spaces,
// keep the slash) so this file can stay import-free for the main process.
const normaliseTag = (raw: string): string => {
  const cleaned = raw.trim().replace(/^#+/, '').toLowerCase().replace(/\s+/g, ' ').trim()
  if (cleaned.includes('/')) return cleaned.split('/').map((p) => p.trim()).filter(Boolean).join('/')
  return cleaned
}

export function findHashtags(markdown: string): string[] {
  const parts = splitCodeAndText(markdown)
  const out: string[] = []
  for (const part of parts) {
    if (part.code) continue
    for (const line of part.text.split('\n')) {
      if (/^\s{0,3}#{1,6}\s/.test(line)) continue // a heading, not a tag
      for (const m of line.matchAll(/(^|[\s(])#([\p{L}\p{N}][\p{L}\p{N}_/-]*)/gu)) {
        const name = normaliseTag(m[2])
        if (name && !out.includes(name)) out.push(name)
      }
    }
  }
  return out
}

// A short plain-text preview for lists and search results.
export function plainSummary(markdown: string, max = 160): string {
  const text = markdown
    .replace(/```[\s\S]*?(?:```|$)/g, ' ')
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, ' $1 ')
    .replace(/\[\[([^\]]*)\]\]/g, ' $1 ')
    .replace(/^\s{0,3}#{1,6}\s+/gm, '')
    .replace(/^\s*[-*+]\s+\[[ xX]\]\s+/gm, '')
    .replace(/[*_`>#]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`
}
