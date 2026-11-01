// The small menu that opens when you click the big circle of a 'count' or
// 'duration' habit.
//
// A plain "check" habit just needs a tick, but a habit like "Read for 10mn"
// needs a number: how many minutes did you read? This menu asks for that
// number, with quick + and - buttons so it is easy to type.
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Check, Minus, Plus } from 'lucide-react'
import type { HabitType } from '../../../shared/habits'

interface Props {
  habitName: string
  dateLabel: string // the day in words, e.g. "Mon 26 Oct 2026"
  type: HabitType
  unit: string
  target: number | null
  // The value already logged on that day (0 if nothing was logged).
  value: number
  // The dot that was clicked. The menu is placed next to it.
  anchor: HTMLElement | null
  onSave: (value: number) => void
  onClose: () => void
}

// How far the menu sits from the dot it belongs to.
const GAP = 6

// The quick buttons either side of the number.
const QUICK_STEPS = [1, 5, 10]

export function LogValuePopover({
  habitName,
  dateLabel,
  type,
  unit,
  target,
  value,
  anchor,
  onSave,
  onClose
}: Props) {
  const ref = useRef<HTMLDivElement>(null)
  // The number being typed. It starts at what was already logged. We always
  // show a number (even 0) so the box is never confusingly empty.
  const [amount, setAmount] = useState<string>(String(value > 0 ? value : 0))
  // Where the menu goes. It is worked out from the dot, so it always opens
  // right next to the thing that was clicked.
  const [place, setPlace] = useState<{ top: number; left: number } | null>(null)

  // The number the user typed, as a number. Blank means zero.
  const parsed = Number(amount)
  const number = isFinite(parsed) && parsed > 0 ? parsed : 0
  // The step for the quick buttons: five minutes at a time for a duration
  // habit, one session at a time for a count habit.
  const step = type === 'duration' ? 5 : 1
  // The unit shown next to the number.
  const label = unit || (type === 'duration' ? 'min' : 'times')
  // Has the target been reached with what is typed?
  const reached = target === null || target <= 0 ? false : number >= target

  // Put the menu just under the dot, and keep it inside the window.
  useLayoutEffect(() => {
    if (!anchor) return
    const dot = anchor.getBoundingClientRect()
    const width = 210 // about the width of the menu
    const height = 210 // about the height of the menu
    let left = dot.left + dot.width / 2 - width / 2
    let top = dot.bottom + GAP
    // If there is no room below, open it above the dot instead.
    if (top + height > window.innerHeight - 8) top = Math.max(8, dot.top - height - GAP)
    // Keep it inside the sides of the window.
    left = Math.max(8, Math.min(left, window.innerWidth - width - 8))
    setPlace({ top, left })
  }, [anchor])

  // Escape closes the menu, and Tab stays inside it, so the keyboard never
  // wanders off into the page behind.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        onClose()
        return
      }
      if (e.key !== 'Tab' || !ref.current) return
      const buttons = ref.current.querySelectorAll<HTMLElement>('button, input')
      if (buttons.length === 0) return
      const first = buttons[0]
      const last = buttons[buttons.length - 1]
      const active = document.activeElement
      if (e.shiftKey && active === first) { e.preventDefault(); last.focus() }
      else if (!e.shiftKey && active === last) { e.preventDefault(); first.focus() }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [onClose])

  // Clicking anywhere else closes the menu.
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    document.addEventListener('mousedown', onDown, true)
    return () => document.removeEventListener('mousedown', onDown, true)
  }, [onClose])

  // Put the keyboard on the number, so it can be typed straight away.
  useEffect(() => {
    ref.current?.querySelector<HTMLInputElement>('input')?.focus()
  }, [])

  // Adds (or takes away) a step, and keeps the number tidy.
  const nudge = (by: number) => {
    const next = Math.max(0, number + by)
    setAmount(String(next))
  }

  return (
    <div
      ref={ref}
      className="day-pop day-pop-value"
      role="dialog"
      aria-label={`Log ${habitName} for ${dateLabel}`}
      style={place ? { top: place.top, left: place.left } : { top: 0, left: 0, visibility: 'hidden' }}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <div className="day-pop-head">{dateLabel}</div>

      {/* The number, with a - and a + either side. */}
      <div className="flex items-center justify-center gap-2">
        <button className="btn-icon" onClick={() => nudge(-step)} aria-label={`Less ${label}`} type="button">
          <Minus size={16} />
        </button>
        <input
          className="field w-20 text-center tabular-nums"
          type="number"
          min={0}
          step={type === 'duration' ? 1 : 1}
          value={amount}
          aria-label={`How many ${label}`}
          onChange={(e) => setAmount(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); onSave(number) } }}
        />
        <button className="btn-icon" onClick={() => nudge(step)} aria-label={`More ${label}`} type="button">
          <Plus size={16} />
        </button>
      </div>

      <div className="mt-1 text-center text-xs text-muted">
        {label}{target !== null && target > 0 ? ` (target ${target})` : ''}
      </div>

      {/* Quick buttons for the common amounts. */}
      <div className="mt-2 flex flex-wrap justify-center gap-1.5">
        {QUICK_STEPS.map((n) => (
          <button key={n} className="btn btn-sm" type="button" onClick={() => setAmount(String(n))}>
            {n}
          </button>
        ))}
      </div>

      {/* A line that says whether the target has been reached. */}
      {target !== null && target > 0 && (
        <p className={`mt-2 text-center text-xs ${reached ? 'text-pos' : 'text-muted'}`}>
          {reached ? 'Target reached' : `${number} of ${target} ${label}`}
        </p>
      )}

      <div className="mt-3 flex items-center justify-end gap-2">
        <button className="btn btn-sm" type="button" onClick={onClose}>Cancel</button>
        <button className="btn-primary btn-sm" type="button" onClick={() => onSave(number)}>
          <Check size={14} /> Save
        </button>
      </div>
    </div>
  )
}
