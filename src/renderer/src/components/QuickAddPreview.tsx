// The preview card for natural-language quick-add: shows what WOULD be created,
// editable, with Confirm / Cancel. Nothing is saved until Confirm. Used by the
// command palette and the Quick capture window (both get the parser's proposal).
import { useEffect, useRef, useState } from 'react'
import { Pencil, Undo2 } from 'lucide-react'
import { describeProposal, type QuickAddProposal } from '../../../shared/quickAdd'
import { today } from '../lib/dates'

interface Props {
  proposal: QuickAddProposal
  confidence: 'high' | 'medium'
  onConfirm: (edited: QuickAddProposal) => Promise<void> | void
  onCancel: () => void
}

// Which fields the card offers to edit, per proposal kind. Only the ones that
// make sense; everything else stays as parsed. Editing is plain text/number/date
// inputs and a select, all reachable with Tab and saved with Enter.
export function QuickAddPreview({ proposal, confidence, onConfirm, onCancel }: Props) {
  const [edited, setEdited] = useState<QuickAddProposal>(proposal)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const first = useRef<HTMLDivElement>(null)
  useEffect(() => { requestAnimationFrame(() => first.current?.querySelector<HTMLElement>('[data-autofocus]')?.focus()) }, [])
  const set = (patch: Partial<QuickAddProposal>) => setEdited((p) => ({ ...p, ...patch }) as QuickAddProposal)

  const confirm = async (): Promise<void> => {
    if (busy) return
    setBusy(true); setError('')
    try { await onConfirm(edited) } catch (e) { setError(String((e as Error).message ?? e)); setBusy(false) }
  }

  const askFirst = confidence === 'medium'

  return (
    <div className="card card-pad" role="dialog" aria-modal="true" aria-label="Confirm quick add" ref={first}
      onKeyDown={(e) => { if (e.key === 'Escape') { e.preventDefault(); onCancel() } }}>
      <div className="flex items-center justify-between gap-2">
        <h3 className="section-title"><Pencil size={14} /> {askFirst ? 'Did you mean…?' : 'Quick add'}</h3>
        {askFirst && <span className="badge badge-muted">Not sure — check this</span>}
      </div>
      <p className="mt-1 text-sm text-muted">You typed: “{describeProposal(proposal)}”. Edit anything below, then confirm.</p>

      <div className="mt-3 flex flex-col gap-2" onKeyDown={(e) => {
        if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); void confirm() }
      }}>
        {edited.kind === 'deposit' && (<>
          <div className="grid grid-cols-2 gap-2">
            <label className="flex flex-col text-xs text-muted">Amount
              <input data-autofocus type="number" step="any" min="0" className="field mt-1" value={edited.amount}
                onChange={(e) => set({ amount: Number(e.target.value) || 0 })} aria-label="Amount" />
            </label>
            <label className="flex flex-col text-xs text-muted">Type
              <select className="field mt-1" value={edited.txKind} onChange={(e) => set({ txKind: e.target.value as 'deposit' | 'withdrawal' })} aria-label="Deposit or withdrawal">
                <option value="deposit">Deposit</option><option value="withdrawal">Withdrawal</option>
              </select>
            </label>
          </div>
          <label className="flex flex-col text-xs text-muted">Goal name
            <input className="field mt-1" value={edited.goalName ?? ''} onChange={(e) => set({ goalName: e.target.value })} aria-label="Goal name" />
          </label>
          <label className="flex flex-col text-xs text-muted">Note (optional)
            <input className="field mt-1" value={edited.note} onChange={(e) => set({ note: e.target.value })} aria-label="Note" />
          </label>
        </>)}

        {edited.kind === 'task' && (<>
          <label className="flex flex-col text-xs text-muted">Task
            <input data-autofocus className="field mt-1" value={edited.title} onChange={(e) => set({ title: e.target.value })} aria-label="Task title" />
          </label>
          <div className="grid grid-cols-2 gap-2">
            <label className="flex flex-col text-xs text-muted">Due date (optional)
              <input type="date" className="field mt-1" value={edited.dueDate ?? ''} onChange={(e) => set({ dueDate: e.target.value || null })} aria-label="Due date" />
            </label>
            <label className="flex flex-col text-xs text-muted">Priority
              <select className="field mt-1" value={edited.priority} onChange={(e) => set({ priority: e.target.value as 'low' | 'medium' | 'high' })} aria-label="Priority">
                <option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option>
              </select>
            </label>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <label className="flex flex-col text-xs text-muted">Due time (optional)
              <input type="time" className="field mt-1" value={edited.dueTime ?? ''} onChange={(e) => set({ dueTime: e.target.value || null })} aria-label="Due time" />
            </label>
            <label className="flex flex-col text-xs text-muted">Project (optional)
              <input className="field mt-1" value={edited.project ?? ''} onChange={(e) => set({ project: e.target.value || null })} aria-label="Project" />
            </label>
          </div>
          <label className="flex flex-col text-xs text-muted">Tags (space separated)
            <input className="field mt-1" value={edited.tags.map((tag) => `#${tag}`).join(' ')}
              onChange={(e) => set({ tags: [...new Set(e.target.value.split(/\s+/).map((tag) => tag.replace(/^#/, '').trim().toLowerCase()).filter(Boolean))] })}
              aria-label="Task tags" />
          </label>
          {edited.recurrence && (
            <p className="meta">Repeats {edited.recurrence.frequency === 'custom' ? `every ${edited.recurrence.intervalDays} days` : edited.recurrence.frequency}. Edit after saving if that is not right.</p>
          )}
        </>)}

        {edited.kind === 'habit-checkin' && (
          <label className="flex flex-col text-xs text-muted">Habit name
            <input data-autofocus className="field mt-1" value={edited.habitName} onChange={(e) => set({ habitName: e.target.value })} aria-label="Habit name" />
          </label>
        )}

        {edited.kind === 'note' && (<>
          <label className="flex flex-col text-xs text-muted">Title
            <input data-autofocus className="field mt-1" value={edited.title} onChange={(e) => set({ title: e.target.value })} aria-label="Note title" />
          </label>
          <label className="flex flex-col text-xs text-muted">Body (optional)
            <textarea className="field mt-1 min-h-[4rem]" value={edited.body} onChange={(e) => set({ body: e.target.value })} aria-label="Note body" />
          </label>
          <p className="meta">Will be dated {today()}.</p>
        </>)}
      </div>

      {error && <p role="alert" className="mt-2 text-sm text-neg">{error}</p>}
      <div className="mt-3 flex items-center gap-2">
        <button className="btn" onClick={onCancel} aria-label="Cancel, save nothing"><Undo2 size={14} /> Cancel</button>
        <button className="btn-primary ml-auto" onClick={confirm} aria-busy={busy} disabled={busy}>Confirm</button>
      </div>
      <p className="meta mt-2"><kbd className="kbd">Esc</kbd> cancels, <kbd className="kbd">Ctrl+Enter</kbd> confirms. Nothing has been saved yet.</p>
    </div>
  )
}
