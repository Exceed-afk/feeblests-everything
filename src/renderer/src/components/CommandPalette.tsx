import { useEffect, useId, useMemo, useRef, useState } from 'react'
import type { KeyboardEvent, MouseEvent } from 'react'
import { CornerDownLeft, Search } from 'lucide-react'
import { searchEntries, type Hit } from '../../../shared/palette'
import { parseQuickAdd, type QuickAddParse } from '../../../shared/quickAdd'
import type { PaletteItem } from '../lib/paletteItems'
import { QuickAddPreview } from './QuickAddPreview'
import { saveProposal } from '../lib/quickAddSave'

interface Props {
  items: PaletteItem[] // everything that can be searched
  emptyItems: PaletteItem[] // what to show while the search box is empty (recent tools)
  emptyHeading: string // the heading above that list
  placeholder?: string
  onClose: () => void
  quickAdd?: { goals: () => Promise<{ goals: import('../../../shared/types').SavingsGoal[]; habits: import('../../../shared/types').Habit[] }> } | null
}

// The Ctrl+K / Cmd+K window: a search box and a ranked list, driven entirely from the keyboard.
//  - It knows nothing about tools or actions: it shows the items it is given and calls `run()` on the one picked.
//    (components/PaletteHost.tsx builds the items; to add an action, see actions.ts.)
//  - Mounted only while open, so every opening starts fresh (empty box, first row selected).
//  - Accessibility: a modal dialog with the "combobox + listbox" pattern. Focus stays in the search box and the
//    highlighted row is announced through aria-activedescendant. Tab is kept inside. When it closes, focus goes
//    back to whatever had it before, unless the chosen action moved focus somewhere on purpose.
//  - Colours come only from the theme variables (cp-* in styles.css).
//  - Quick add: when the Intelligence page's smartQuickAdd toggle is on AND what is typed parses as a
//    quick-add sentence, the palette shows the parse's proposal ("Create task: Pay rent…") above the
//    result list; Enter confirms it, Esc backs out. Nothing saves until that confirm.
export function CommandPalette({ items, emptyItems, emptyHeading, placeholder = 'Search…', onClose, quickAdd = null }: Props) {
  const uid = useId()
  const listId = `${uid}-list`
  const optionId = (i: number) => `${uid}-opt-${i}`
  const inputRef = useRef<HTMLInputElement>(null)
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  // Quick-add: the parsed proposal waiting for confirmation, or null.
  const [qaParse, setQaParse] = useState<QuickAddParse | null>(null)
  const qaNames = useRef<{ goals: import('../../../shared/types').SavingsGoal[]; habits: import('../../../shared/types').Habit[] } | null>(null)

  // Remember what had focus before we opened (read while rendering for the first time, before the search box
  // takes focus), and give focus back when we close.
  const previous = useRef<Element | null | undefined>(undefined)
  if (previous.current === undefined) previous.current = document.activeElement
  useEffect(() => () => {
    const now = document.activeElement
    if (now && now !== document.body && now !== document.documentElement) return // the chosen action put focus somewhere on purpose
    const before = previous.current
    if (before instanceof HTMLElement && before !== document.body && before.isConnected) before.focus()
    else document.querySelector<HTMLElement>('main')?.focus() // the old element is gone (the page changed): land on the page
  }, [])

  const searching = query.trim() !== ''
  const hits: Hit<PaletteItem>[] = useMemo(
    () => (searching ? searchEntries(items, query) : emptyItems.map((entry) => ({ entry, score: 0, titleIndices: [] }))),
    [items, emptyItems, query, searching])
  const current = Math.min(active, Math.max(hits.length - 1, 0))

  // Quick-add parse: runs while the toggle is on and what is typed looks like a sentence.
  // A parse failure is NOT shown as an error — the palette is still a normal search box.
  const today = new Date()
  const qaToday = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`
  useEffect(() => {
    if (!quickAdd || !searching) { setQaParse(null); return }
    const trimmed = query.trim()
    // Only sentences with a keyword trigger are worth parsing; a bare word stays a search.
    if (!/^(deposit|withdraw|add|save|put|task|habit|checked|did|note)\s/i.test(trimmed)) { setQaParse(null); return }
    const r = parseQuickAdd(trimmed, { today: qaToday })
    setQaParse(r.ok ? (r as { parse: QuickAddParse }).parse : null)
  }, [query, searching, quickAdd, qaToday])

  useEffect(() => { document.getElementById(optionId(current))?.scrollIntoView({ block: 'nearest' }) }, [current, hits])

  const choose = (item: PaletteItem) => { item.run(); onClose() }
  const move = (step: number) => { if (hits.length > 0) setActive((current + step + hits.length) % hits.length) }

  // Confirm the quick-add preview: resolve goal/habit names, save, close.
  const confirmQuickAdd = async (edited: QuickAddParse['proposal']): Promise<void> => {
    if (!qaParse || !quickAdd) return
    if (!qaNames.current) qaNames.current = await quickAdd.goals()
    const r = await saveProposal(edited, { goals: qaNames.current.goals, habits: qaNames.current.habits })
    void r
    onClose()
  }

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.nativeEvent.isComposing) return // still choosing a character in an input method: Enter / Esc belong to it
    const mod = e.ctrlKey || e.metaKey
    if (qaParse) {
      // The preview is up: Esc cancels IT (one Esc returns to search, a second closes the palette — handled below by keeping qaParse), Enter confirms.
      if (e.key === 'Escape') { e.preventDefault(); setQaParse(null); return }
      if (e.key === 'Enter' && !mod) { e.preventDefault(); void confirmQuickAdd(qaParse.proposal); return }
      if (mod && e.key.toLowerCase() === 'k') { e.preventDefault(); onClose(); return }
      return // while confirming, arrows and typing in the preview's own inputs work as usual
    }
    if (e.key === 'Escape' || (mod && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 'k')) { e.preventDefault(); onClose() }
    else if (e.key === 'ArrowDown') { e.preventDefault(); move(1) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); move(-1) }
    else if (e.key === 'Enter' && !mod) { e.preventDefault(); if (hits[current]) choose(hits[current].entry) }
    else if (e.key === 'Tab') e.preventDefault() // the search box is the only stop; the list is reached with the arrows
    // Nothing typed here may reach the page underneath: Esc must not also close an editor, Ctrl+N must not start a new entry,
    // and the Ctrl+K that closes us must not reach the listener that opens us.
    e.stopPropagation()
  }

  // Clicking inside the window must not take focus away from the search box (Esc would stop working).
  const keepFocus = (e: MouseEvent) => { if (e.target !== inputRef.current) e.preventDefault() }

  const status = !searching ? '' : hits.length === 0 ? 'No matches' : `${hits.length} ${hits.length === 1 ? 'result' : 'results'}`

  return (
    <div className="cp-scrim" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className="cp" role="dialog" aria-modal="true" aria-label="Command palette" onKeyDown={onKeyDown} onMouseDown={keepFocus}>
        <div className="cp-search">
          {qaParse ? (
            <div className="p-3" ref={undefined}>
              <QuickAddPreview proposal={qaParse.proposal} confidence={qaParse.confidence}
                onConfirm={confirmQuickAdd}
                onCancel={() => { setQaParse(null); inputRef.current?.focus() }} />
              <p className="cp-empty mt-2">Press Esc to go back to search.</p>
            </div>
          ) : (
            <>
              <Search size={18} aria-hidden="true" />
              <input ref={inputRef} className="cp-input" autoFocus type="text" value={query} placeholder={placeholder}
                autoComplete="off" spellCheck={false} aria-label="Search"
                role="combobox" aria-expanded={hits.length > 0} aria-controls={hits.length > 0 ? listId : undefined} aria-autocomplete="list"
                aria-activedescendant={hits.length > 0 ? optionId(current) : undefined}
                onChange={(e) => { setQuery(e.target.value); setActive(0) }} />
            </>
          )}
        </div>

        {!searching && !qaParse && hits.length > 0 && <div className="cp-heading" aria-hidden="true">{emptyHeading}</div>}
        {!qaParse && (hits.length > 0 ? (
          <ul className="cp-list" id={listId} role="listbox" aria-label={searching ? 'Results' : emptyHeading}>
            {hits.map(({ entry, titleIndices }, i) => (
              <li key={entry.id} id={optionId(i)} className="cp-opt" role="option" aria-selected={i === current}
                onClick={() => choose(entry)}
                onMouseMove={(e) => { if ((e.movementX !== 0 || e.movementY !== 0) && i !== current) setActive(i) }}>
                {entry.icon && <entry.icon size={18} aria-hidden="true" />}
                <span className="cp-title"><Marked text={entry.title} indices={titleIndices} /></span>
                {entry.current && <span className="badge badge-muted">Current</span>}
                <span className="cp-group">{entry.group}</span>
                <CornerDownLeft size={14} className="cp-enter" aria-hidden="true" />
              </li>
            ))}
          </ul>
        ) : (
          <p className="cp-empty" id={listId}>{searching ? `Nothing matches “${query.trim()}”.` : 'Nothing to show yet.'}</p>
        ))}

        <div className="cp-foot" aria-hidden="true">
          {qaParse
            ? <span><kbd className="kbd">Enter</kbd> confirm · <kbd className="kbd">Esc</kbd> back to search</span>
            : <>
              <span><kbd className="kbd">↑</kbd><kbd className="kbd">↓</kbd> move</span>
              <span><kbd className="kbd">Enter</kbd> open</span>
              <span><kbd className="kbd">Esc</kbd> close</span>
            </>}
        </div>
        <div className="sr-only" role="status">{status}</div>
      </div>
    </div>
  )
}

// The title with the matched letters marked.
function Marked({ text, indices }: { text: string; indices: number[] }) {
  if (indices.length === 0) return <>{text}</>
  const marked = new Set(indices)
  const parts: { text: string; hit: boolean }[] = []
  for (let i = 0; i < text.length; i++) {
    const hit = marked.has(i)
    if (parts.length > 0 && parts[parts.length - 1].hit === hit) parts[parts.length - 1].text += text[i]
    else parts.push({ text: text[i], hit })
  }
  return <>{parts.map((p, i) => (p.hit ? <mark key={i} className="cp-mark">{p.text}</mark> : <span key={i}>{p.text}</span>))}</>
}
