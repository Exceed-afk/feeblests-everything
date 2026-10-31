import { useEffect, useState } from 'react'
import { X } from 'lucide-react'
import { MOODS, type LogEntry, type Mood } from '../../../shared/types'
import { MOOD_STYLE } from '../lib/moods'
import { today } from '../lib/dates'
import { TagInput, addTag } from '../components/TagInput'

interface Props {
  entry: LogEntry | null // null = writing a new entry
  knownTags: string[] // existing tags, offered as suggestions
  onSaved: () => void
  onClose: () => void
}

export function EntryEditor({ entry, knownTags, onSaved, onClose }: Props) {
  const [date, setDate] = useState(entry?.date ?? today())
  const [title, setTitle] = useState(entry?.title ?? '')
  const [body, setBody] = useState(entry?.body ?? '')
  const [mood, setMood] = useState<Mood | null>(entry?.mood ?? null)
  const [tags, setTags] = useState<string[]>(entry?.tags ?? [])
  const [tagInput, setTagInput] = useState('')
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [error, setError] = useState('')

  const save = async () => {
    try {
      const input = { date, title, body, mood, tags: addTag(tags, tagInput) }
      if (entry) await window.api.logbook.update(entry.id, input)
      else await window.api.logbook.create(input)
      onSaved()
    } catch {
      setError('Could not save this entry. Check the date and try again.')
    }
  }

  const remove = async () => {
    if (!entry) return
    await window.api.logbook.remove(entry.id)
    onSaved()
  }

  // Escape closes, Ctrl+Enter saves.
  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
      if (e.key === 'Enter' && e.ctrlKey) { e.preventDefault(); save() }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  return (
    <div className="scrim fixed inset-0 z-10 flex justify-end" onMouseDown={onClose}>
      <aside onMouseDown={(e) => e.stopPropagation()}
        className="flex h-full w-[min(34rem,100%)] flex-col gap-4 overflow-y-auto border-l border-line bg-panel p-6 shadow-card">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">{entry ? 'Edit entry' : 'New entry'}</h2>
          <button className="btn-icon" onClick={onClose} aria-label="Close">
            <X size={18} />
          </button>
        </div>

        <div className="flex gap-3">
          <label className="w-44 shrink-0 text-xs text-muted">Date
            <input type="date" className="field mt-1" value={date} onChange={(e) => setDate(e.target.value)} />
          </label>
          <label className="flex-1 text-xs text-muted">Title
            <input className="field mt-1" value={title} placeholder="What happened?" autoFocus
              onChange={(e) => setTitle(e.target.value)} />
          </label>
        </div>

        <div>
          <div className="text-xs text-muted">Mood (optional)</div>
          <div className="mt-1 flex flex-wrap gap-2">
            {MOODS.map((m) => (
              <button key={m} onClick={() => setMood(mood === m ? null : m)} aria-pressed={mood === m}
                className={`flex items-center gap-2 rounded-xl border px-3 py-1.5 text-sm ${
                  mood === m ? 'border-accent bg-accent/15' : 'border-line text-muted hover:text-fg'}`}>
                <span className={`h-2.5 w-2.5 rounded-full ${MOOD_STYLE[m].dot}`} />
                {MOOD_STYLE[m].label}
              </button>
            ))}
          </div>
        </div>

        <TagInput tags={tags} onTagsChange={setTags} input={tagInput} onInputChange={setTagInput} suggestions={knownTags} />

        <label className="flex min-h-[10rem] flex-1 flex-col text-xs text-muted">Entry
          <textarea className="field mt-1 flex-1 resize-none leading-relaxed" value={body}
            placeholder="Write freely..." onChange={(e) => setBody(e.target.value)} />
        </label>

        {error && <p className="text-sm text-neg">{error}</p>}

        <div className="flex items-center gap-2">
          {entry && !confirmDelete && (
            <button className="btn text-neg" onClick={() => setConfirmDelete(true)}>Delete</button>
          )}
          {entry && confirmDelete && (
            <>
              <button className="btn-danger" onClick={remove}>Yes, delete</button>
              <button className="btn" onClick={() => setConfirmDelete(false)}>Keep it</button>
            </>
          )}
          <span className="ml-auto text-xs text-muted">Ctrl+Enter to save</span>
          <button className="btn-primary" onClick={save}>Save entry</button>
        </div>
      </aside>
    </div>
  )
}
