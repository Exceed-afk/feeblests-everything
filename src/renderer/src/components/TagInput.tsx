import type { KeyboardEvent } from 'react'
import { X } from 'lucide-react'
import { TagChip } from './TagChip'

// Adds one typed tag to a list ("#Work " -> "work"), skipping blanks and duplicates.
// Editors call this at save time too, so a half-typed tag is never lost.
export const addTag = (tags: string[], raw: string): string[] => {
  const t = raw.trim().toLowerCase().replace(/^#+/, '')
  return !t || tags.includes(t) ? tags : [...tags, t]
}

interface Props {
  tags: string[]
  onTagsChange: (tags: string[]) => void
  input: string // the text currently being typed
  onInputChange: (text: string) => void
  suggestions: string[]
}

export function TagInput({ tags, onTagsChange, input, onInputChange, suggestions }: Props) {
  const commit = () => { onTagsChange(addTag(tags, input)); onInputChange('') }

  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if ((e.key === 'Enter' || e.key === ',') && !e.ctrlKey) { e.preventDefault(); commit() }
    else if (e.key === 'Backspace' && !input) onTagsChange(tags.slice(0, -1))
  }

  return (
    <label className="text-xs text-muted">Tags
      <div className="field mt-1 flex flex-wrap items-center gap-1.5">
        {tags.map((t) => (
          <TagChip key={t} tag={t}>
            <button onClick={() => onTagsChange(tags.filter((x) => x !== t))} aria-label={`Remove ${t}`}><X size={12} /></button>
          </TagChip>
        ))}
        <input list="known-tags" className="min-w-[6rem] flex-1 bg-transparent outline-none" value={input}
          placeholder={tags.length ? '' : 'Type a tag, press Enter'}
          onChange={(e) => onInputChange(e.target.value)} onKeyDown={onKey} onBlur={commit} />
        <datalist id="known-tags">{suggestions.map((t) => <option key={t} value={t} />)}</datalist>
      </div>
    </label>
  )
}
