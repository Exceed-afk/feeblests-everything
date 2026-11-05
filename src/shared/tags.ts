// Tag text rules, pure so the tag service, the shared tag input and the tests
// all normalise the same way (Phase 0).
//
// One rule for every surface — someone typing '  #Work ' in the Logbook and
// someone picking a suggestion in the new tag input land on the same tag:
//   - trim and lowercase;
//   - strip leading '#'s (so pasting '#work' is treated as the word);
//   - `parent/child` stays as one tag with a slash in it;
//   - internal runs of whitespace collapse to one space;
//   - empty results are dropped, duplicates removed (first spelling wins).
// This matches what src/main/util.ts cleanTags has always done for the JSON
// tag columns; it lives here so new surfaces (taggings, Phase 2 Notes) share it.

// Normalises ONE typed/pasted tag. Returns '' when nothing is left.
export function normalizeTagName(raw: string): string {
  const cleaned = raw.trim().replace(/^#+/, '').toLowerCase().replace(/\s+/g, ' ').trim()
  // A 'parent/child' tag stays as-is; each part gets the same clean-up.
  if (cleaned.includes('/')) {
    const parts = cleaned.split('/').map((p) => p.trim()).filter(Boolean)
    return parts.join('/')
  }
  return cleaned
}

// Splits what a user typed in one tag field into separate tags: commas
// separate them (a tag itself may contain a slash, never a comma).
export function splitTagInput(text: string): string[] {
  return text.split(/[,;]/).map((part) => normalizeTagName(part)).filter(Boolean)
}

// Normalises a whole list: clean, keep order, first spelling of each wins.
export function normalizeTags(tags: string[]): string[] {
  const out: string[] = []
  for (const tag of tags) {
    const name = normalizeTagName(tag)
    if (name && !out.includes(name)) out.push(name)
  }
  return out
}

// ---------- shapes the tag service reads and writes ----------

// The kinds of entity a tagging can point at today (the same strings Links
// uses). Phase 2 adds notes, Phase 3 content items.
export type TagEntityType = 'logbook' | 'trade' | 'goal' | 'task' | 'note' | 'content'

// One row of the tags table.
export interface TagRow { id: number; name: string; colour: string | null; createdAt: string; updatedAt: string }

// One tag with its per-kind item counts (the Tags page in Phase 2 builds on
// this). Trashed items and hidden taggings are not counted.
export interface TagCountEntry { tag: TagRow; counts: Record<TagEntityType, number> }
