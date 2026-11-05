// The "Deleted. Undo" toast (Phase 0). One at a time, bottom-right, keyboard
// first: the Undo button is focused when it appears, and Ctrl+Z works from
// anywhere in the app (App.tsx wires the key). Uses theme tokens only.
//
// The restore refetch comes through the app's normal "data changed" push
// (see lib/dataChanged.ts pages already listen to), so no page needs to know
// the toast exists.
import { useEffect, useRef, useState } from 'react'
import { undoLastDelete, useUndoStack } from '../lib/undo'

export function UndoToast() {
  const stack = useUndoStack()
  const [message, setMessage] = useState<string | null>(null)
  const button = useRef<HTMLButtonElement>(null)
  const top = stack?.[0]

  // The newest delete raises the toast; a newer delete replaces the message
  // and the timer restarts.
  useEffect(() => {
    if (!top) return
    setMessage(`Deleted ${top.label}.`)
  }, [top])

  useEffect(() => {
    if (message) button.current?.focus()
    const timer = setTimeout(() => setMessage(null), 6000)
    return () => clearTimeout(timer)
  }, [message])

  if (!top || message === null) return null

  const undo = async () => {
    const label = await undoLastDelete()
    setMessage(null)
    if (label) {
      // The same push the Quick capture window triggers after saving: every
      // page listening for "data changed" (and the Trash page) refetches.
      await window.api.capture.saved()
    }
  }

  return (
    <div role="status" aria-live="polite"
      className="fixed bottom-4 right-4 z-40 flex max-w-[24rem] items-center gap-3 rounded-xl border border-line bg-panel px-4 py-3 text-sm shadow-card">
      <span>{message}</span>
      <button ref={button} className="btn-primary" onClick={() => void undo()}>Undo</button>
      <kbd className="kbd">Ctrl+Z</kbd>
    </div>
  )
}
