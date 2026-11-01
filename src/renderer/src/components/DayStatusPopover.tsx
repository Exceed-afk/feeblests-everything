// The small menu that opens when you click a day dot on the Habits page.
// It lets you say what happened on that day: Done, Missed, Skipped or Clear.
//
// "Missed" and "Clear" both mean "there is no record for this day" - a missed
// day is worked out from the habit's schedule, so nothing about it is stored.
// The only difference is that Clear also removes a day that was already done.
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Check, CircleSlash, Eraser, SkipForward, X } from 'lucide-react'
import type { DayChoice, DayStatus } from '../../../shared/habits'

interface Props {
  habitName: string
  dateLabel: string // the day in words, e.g. "Mon 26 Oct 2026"
  status: DayStatus // what the day says right now
  // The dot that was clicked. The menu is placed next to it.
  anchor: HTMLElement | null
  onChoose: (choice: DayChoice) => void
  onClose: () => void
}

// Each choice has its own icon and words, so the meaning never depends on colour.
const CHOICES: { choice: DayChoice; label: string; Icon: typeof Check; tone?: 'miss' }[] = [
  { choice: 'done', label: 'Done', Icon: Check },
  { choice: 'missed', label: 'Missed', Icon: X, tone: 'miss' },
  { choice: 'skipped', label: 'Skipped', Icon: SkipForward },
  { choice: 'clear', label: 'Clear', Icon: Eraser, tone: 'miss' }
]

// Which choice is already true for the day, so the menu can mark it.
function currentChoice(status: DayStatus): DayChoice | null {
  if (status === 'done') return 'done'
  if (status === 'skipped') return 'skipped'
  if (status === 'missed') return 'missed'
  return null // 'rest', 'future' and 'pending' have nothing stored yet
}

// How far the menu sits from the dot it belongs to.
const GAP = 6

export function DayStatusPopover({ habitName, dateLabel, status, anchor, onChoose, onClose }: Props) {
  const ref = useRef<HTMLDivElement>(null)
  // Where the menu goes. It is worked out from the dot, so it always opens
  // right next to the thing that was clicked.
  const [place, setPlace] = useState<{ top: number; left: number } | null>(null)

  // Put the menu just under the dot, and keep it inside the window.
  useLayoutEffect(() => {
    if (!anchor) return
    const dot = anchor.getBoundingClientRect()
    const width = 160 // about the width of the menu
    const height = 190 // about the height of the menu
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
      const buttons = ref.current.querySelectorAll<HTMLButtonElement>('button')
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
    // "capture" so the menu closes before a click lands on a day behind it.
    document.addEventListener('mousedown', onDown, true)
    return () => document.removeEventListener('mousedown', onDown, true)
  }, [onClose])

  // Put the keyboard on the first choice, so the menu can be used straight away.
  useEffect(() => {
    const first = ref.current?.querySelector<HTMLButtonElement>('button')
    first?.focus()
  }, [])

  const current = currentChoice(status)

  return (
    <div
      ref={ref}
      className="day-pop"
      role="menu"
      aria-label={`What happened on ${dateLabel} for ${habitName}`}
      style={place ? { top: place.top, left: place.left } : { top: 0, left: 0, visibility: 'hidden' }}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <div className="day-pop-head">{dateLabel}</div>
      {CHOICES.map(({ choice, label, Icon, tone }) => (
        <button
          key={choice}
          className="day-pop-item"
          role="menuitemradio"
          aria-checked={current === choice}
          data-tone={tone}
          onClick={() => onChoose(choice)}
        >
          <Icon size={15} strokeWidth={2.2} aria-hidden="true" />
          {label}
        </button>
      ))}
    </div>
  )
}

// A rest day cannot be marked done or missed: the habit was not due then.
// This tiny icon is shown instead of the menu when someone clicks one.
export function RestDayNote() {
  return (
    <span className="inline-flex items-center gap-1 text-xs text-muted">
      <CircleSlash size={13} aria-hidden="true" /> Rest day
    </span>
  )
}
