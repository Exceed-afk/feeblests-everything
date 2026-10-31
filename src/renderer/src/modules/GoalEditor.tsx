import { useEffect, useState } from 'react'
import { X } from 'lucide-react'
import type { SavingsGoal } from '../../../shared/types'
import { errMsg } from '../lib/errors'

interface Props {
  goal: SavingsGoal | null // null = creating a new goal
  onSaved: () => void
  onClose: () => void
}

export function GoalEditor({ goal, onSaved, onClose }: Props) {
  const [name, setName] = useState(goal?.name ?? '')
  const [target, setTarget] = useState(goal?.target != null ? String(goal.target) : '')
  const [notes, setNotes] = useState(goal?.notes ?? '')
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [error, setError] = useState('')

  const save = async () => {
    // Blank target = a plain account with no goal amount.
    const t = target.trim() === '' ? null : Number(target)
    if (!name.trim()) return setError('Give this goal a name, for example "Emergency fund".')
    if (t !== null && !(t > 0)) return setError('Target must be a number above 0, or left empty.')
    try {
      const input = { name, target: t, notes }
      if (goal) await window.api.savings.updateGoal(goal.id, input)
      else await window.api.savings.createGoal(input)
      onSaved()
    } catch (e) { setError(errMsg(e)) }
  }

  const remove = async () => {
    if (!goal) return
    await window.api.savings.removeGoal(goal.id)
    onSaved()
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
      if (e.key === 'Enter' && e.ctrlKey) { e.preventDefault(); save() }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  return (
    <div className="scrim fixed inset-0 z-20 flex justify-end" onMouseDown={onClose}>
      <aside onMouseDown={(e) => e.stopPropagation()}
        className="flex h-full w-[min(28rem,100%)] flex-col gap-4 overflow-y-auto border-l border-line bg-panel p-6 shadow-card">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">{goal ? 'Edit goal' : 'New goal'}</h2>
          <button className="btn-icon" onClick={onClose} aria-label="Close">
            <X size={18} />
          </button>
        </div>

        <label className="text-xs text-muted">Name
          <input className="field mt-1" value={name} autoFocus placeholder="Emergency fund"
            onChange={(e) => { setName(e.target.value); setError('') }} />
        </label>
        <label className="text-xs text-muted">Target amount (optional)
          <input type="number" step="any" min="0" inputMode="decimal" className="field mt-1" value={target}
            placeholder="Leave empty to just track a balance" onChange={(e) => { setTarget(e.target.value); setError('') }} />
        </label>
        <label className="flex min-h-[6rem] flex-1 flex-col text-xs text-muted">Notes
          <textarea className="field mt-1 flex-1 resize-none leading-relaxed" value={notes}
            placeholder="What is this for?" onChange={(e) => setNotes(e.target.value)} />
        </label>

        {error && <p className="text-sm text-neg">{error}</p>}

        <div className="flex items-center gap-2">
          {goal && !confirmDelete && <button className="btn text-neg" onClick={() => setConfirmDelete(true)}>Delete</button>}
          {goal && confirmDelete && (
            <>
              <button className="btn-danger" onClick={remove}>
                Delete goal{goal.txCount > 0 ? ` and ${goal.txCount} transaction${goal.txCount === 1 ? '' : 's'}` : ''}
              </button>
              <button className="btn" onClick={() => setConfirmDelete(false)}>Keep it</button>
            </>
          )}
          <span className="ml-auto text-xs text-muted">Ctrl+Enter to save</span>
          <button className="btn-primary" onClick={save}>Save goal</button>
        </div>
      </aside>
    </div>
  )
}
