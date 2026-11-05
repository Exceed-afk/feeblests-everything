// Session undo (Phase 0): the last few DELETE actions of this working
// session, each reversible by restoring its trash batch (window.api.trash).
//
// It lives in memory ONLY - undo listens for Ctrl+Z until the window closes.
// Anything past that is the Trash page's job (30-day auto-purge after that)
// and the daily backups' job beyond that. No time machine is promised here.
import { useEffect, useState } from 'react'

export interface UndoableDelete {
  label: string // what was deleted, shown in the toast ("Trade XAUUSD")
  batchId: string // the delete batch the rows went to (returned by the delete IPC)
}

const LIMIT = 8 // the last few actions, per the plan
let stack: UndoableDelete[] = []
const listeners = new Set<() => void>()

const emit = (): void => { for (const listener of listeners) listener() }

// Called by a page right after a successful delete. A batch already on the
// stack (a second delete of the same rows) moves to the top instead of
// stacking twice.
export function noteUndoableDelete(delete_: UndoableDelete): void {
  stack = [{ label: delete_.label, batchId: delete_.batchId }, ...stack.filter((x) => x.batchId !== delete_.batchId)].slice(0, LIMIT)
  emit()
}

// Deletes it from the stack WITHOUT restoring (its batch was handled another
// way, e.g. the batch was deleted forever from the Trash page).
export function forgetUndoable(batchId: string): void {
  stack = stack.filter((x) => x.batchId !== batchId)
  emit()
}

export const undoStack = (): readonly UndoableDelete[] => stack

// Restores the newest delete and returns its label for the confirmation
// toast; false when there was nothing to undo.
export async function undoLastDelete(): Promise<string | null> {
  const [next, ...rest] = stack
  if (!next) return null
  const restored = await window.api.trash.restore(next.batchId)
  stack = rest
  emit()
  return restored > 0 ? next.label : null
}

// Subscribes React to the stack (App hosts the toast, the Trash page disables
// buttons it must not race with).
export function useUndoStack(): readonly UndoableDelete[] {
  const [list, setList] = useState<readonly UndoableDelete[]>(stack)
  useEffect(() => {
    const update = () => setList([...stack])
    listeners.add(update)
    setList([...stack])
    return () => { listeners.delete(update) }
  }, [])
  return list ?? []
}
