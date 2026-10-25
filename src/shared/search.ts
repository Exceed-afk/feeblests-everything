// The ONE place that decides how a search box is understood. The database code
// uses it to find rows and the UI uses it to highlight what matched.
//
//   "gold breakout"  -> both words must appear (anywhere in the item)
//   "#risk"          -> the item must have a tag starting with "risk"
//   "gold #risk"     -> both of the above
export interface ParsedQuery {
  terms: string[] // plain words, original case
  tags: string[] // lowercase, no "#"
}

export function parseQuery(text: string): ParsedQuery {
  const terms: string[] = []
  const tags: string[] = []
  for (const word of text.trim().split(/\s+/)) {
    if (!word) continue
    if (word.startsWith('#')) {
      const tag = word.replace(/^#+/, '').toLowerCase()
      if (tag) tags.push(tag)
    } else {
      terms.push(word)
    }
  }
  return { terms, tags }
}

export const isEmptyQuery = (q: ParsedQuery): boolean => q.terms.length === 0 && q.tags.length === 0
