import { useCallback, useEffect, useState } from 'react'
import { Pencil, Trash2, X } from 'lucide-react'
import type { SavingsGoal, SavingsTx, TxKind } from '../../../shared/types'
import { progressPercent, withRunningBalance, projectGoal, projectionText } from '../../../shared/savings'
import { today, formatDate } from '../lib/dates'
import { fmtAmount } from '../lib/format'
import { errMsg } from '../lib/errors'
import { useRefreshOnCapture } from '../lib/dataChanged'
import { ProgressBar } from '../components/ProgressBar'
import { EmptyState } from '../components/EmptyState'
import { LinkedItems } from '../components/LinkedItems'
import { noteUndoableDelete } from '../lib/undo'

interface Props {
  goal: SavingsGoal
  blocked: boolean // true while the goal editor is open on top, so Esc only closes that
  onChanged: () => void // tell the page to reload the goal list (balances changed)
  onEditGoal: () => void
  onClose: () => void
}

export function GoalDetail({ goal, blocked, onChanged, onEditGoal, onClose }: Props) {
  const [txs, setTxs] = useState<SavingsTx[]>([])
  const [editing, setEditing] = useState<SavingsTx | null>(null) // null = adding
  const [kind, setKind] = useState<TxKind>('deposit')
  const [amount, setAmount] = useState('')
  const [date, setDate] = useState(today())
  const [note, setNote] = useState('')
  const [confirmId, setConfirmId] = useState<number | null>(null)
  const [error, setError] = useState('')

  const reload = useCallback(async () => {
    setTxs(await window.api.savings.listTransactions(goal.id))
    onChanged()
  }, [goal.id, onChanged])

  const load = useCallback(() => { window.api.savings.listTransactions(goal.id).then(setTxs) }, [goal.id])
  useEffect(() => { load() }, [load])
  useRefreshOnCapture(load) // a deposit was saved from the Quick capture window

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !blocked) onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  const resetForm = () => {
    setEditing(null); setKind('deposit'); setAmount(''); setDate(today()); setNote(''); setError('')
  }

  const startEdit = (t: SavingsTx) => {
    setEditing(t); setKind(t.kind); setAmount(String(t.amount)); setDate(t.date); setNote(t.note); setError('')
  }

  const submit = async () => {
    const a = Number(amount)
    if (amount.trim() === '' || !(a > 0)) return setError('Enter an amount above 0.')
    try {
      const input = { goalId: goal.id, date, kind, amount: a, note }
      if (editing) await window.api.savings.updateTransaction(editing.id, input)
      else await window.api.savings.addTransaction(input)
      resetForm()
      await reload()
    } catch (e) { setError(errMsg(e)) }
  }

  const remove = async (t: SavingsTx) => {
    try {
      const batchId = await window.api.savings.removeTransaction(t.id)
      if (batchId) noteUndoableDelete({ label: `${t.kind} on ${formatDate(t.date)}`, batchId })
      if (editing?.id === t.id) resetForm()
      setConfirmId(null)
      await reload()
    } catch (e) { setError(errMsg(e)); setConfirmId(null) }
  }

  const pct = progressPercent(goal.balance, goal.target)
  const rows = withRunningBalance(txs)
  // I4: a projection from the last 8 weeks' average, shown only when it means something.
  const projection = projectGoal(txs, goal, today())
  const projectionLine = projectionText(projection, goal.name)

  return (
    <div className="scrim fixed inset-0 z-10 flex justify-end" onMouseDown={onClose}>
      <aside onMouseDown={(e) => e.stopPropagation()}
        className="flex h-full w-[min(36rem,100%)] flex-col gap-5 overflow-y-auto border-l border-line bg-panel p-6 shadow-card">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold">{goal.name}</h2>
            {goal.notes && <p className="mt-1 whitespace-pre-line text-sm text-muted">{goal.notes}</p>}
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <button className="btn px-3 py-1.5" onClick={onEditGoal}><Pencil size={14} /> Edit goal</button>
            <button className="btn-icon" onClick={onClose} aria-label="Close">
              <X size={18} />
            </button>
          </div>
        </div>

        <div>
          <div className="text-3xl font-semibold tabular-nums">{fmtAmount(goal.balance)}</div>
          {goal.target !== null && pct !== null ? (
            <>
              <div className="mt-3"><ProgressBar percent={pct} /></div>
              <div className="mt-2 text-sm text-muted">
                {pct >= 100
                  ? `Goal reached. Target was ${fmtAmount(goal.target)}.`
                  : `${Math.floor(pct)}% of ${fmtAmount(goal.target)}, ${fmtAmount(goal.target - goal.balance)} to go`}
              </div>
              {projectionLine && <p className="meta mt-1">{projectionLine}</p>}
            </>
          ) : (
            <div className="mt-1 text-sm text-muted">No target set</div>
          )}
        </div>

        <section className="card card-pad-sm"
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.ctrlKey && (e.target as HTMLElement).tagName === 'INPUT') submit() }}>
          <h3 className="text-sm font-medium">{editing ? 'Edit transaction' : 'Add a transaction'}</h3>
          <div className="mt-3 inline-flex rounded-xl border border-line p-1">
            {(['deposit', 'withdrawal'] as TxKind[]).map((k) => (
              <button key={k} onClick={() => setKind(k)} aria-pressed={kind === k}
                className={`rounded-lg px-4 py-1.5 text-sm capitalize ${
                  kind === k ? (k === 'deposit' ? 'bg-pos text-bg' : 'bg-neg text-bg') : 'text-muted hover:text-fg'}`}>
                {k}
              </button>
            ))}
          </div>
          <div className="mt-3 grid grid-cols-2 gap-3">
            <label className="text-xs text-muted">Amount
              <input type="number" step="any" min="0" inputMode="decimal" className="field mt-1" value={amount}
                onChange={(e) => { setAmount(e.target.value); setError('') }} />
            </label>
            <label className="text-xs text-muted">Date
              <input type="date" className="field mt-1" value={date} onChange={(e) => setDate(e.target.value)} />
            </label>
          </div>
          <label className="mt-3 block text-xs text-muted">Note (optional)
            <input className="field mt-1" value={note} placeholder="Salary, birthday money..." onChange={(e) => setNote(e.target.value)} />
          </label>
          {error && <p className="mt-3 text-sm text-neg">{error}</p>}
          <div className="mt-4 flex gap-2">
            <button className="btn-primary" onClick={submit}>{editing ? 'Save changes' : kind === 'deposit' ? 'Add deposit' : 'Add withdrawal'}</button>
            {editing && <button className="btn" onClick={resetForm}>Cancel</button>}
          </div>
        </section>

        <LinkedItems type="goal" id={goal.id} />

        <section>
          <h3 className="text-sm font-medium">History</h3>
          {rows.length === 0 ? (
            <div className="mt-3"><EmptyState title="No activity yet" text="Add your first deposit above and the balance starts here." /></div>
          ) : (
            <div className="card mt-3 overflow-hidden">
              <table className="tbl">
                <thead>
                  <tr><th>Date</th><th className="r">Amount</th><th className="r">Balance</th><th className="w-10" /></tr>
                </thead>
                <tbody>
                  {rows.map((t) => (
                    <tr key={t.id} onClick={() => startEdit(t)} tabIndex={0} onKeyDown={(k) => { if (k.key === 'Enter' && k.target === k.currentTarget) startEdit(t) }}
                      className={editing?.id === t.id ? 'bg-accent/10' : ''}>
                      <td>
                        <div className="secondary">{formatDate(t.date)}</div>
                        {t.note && <div className="text-xs">{t.note}</div>}
                      </td>
                      <td className={`r font-medium ${t.kind === 'deposit' ? 'text-pos' : 'text-neg'}`}>
                        {t.kind === 'deposit' ? '+' : '-'}{fmtAmount(t.amount)}
                      </td>
                      <td className="r secondary">{fmtAmount(t.balance)}</td>
                      <td className="text-right" onClick={(e) => e.stopPropagation()}>
                        {confirmId === t.id ? (
                          <span className="flex gap-1 whitespace-nowrap text-xs">
                            <button className="btn-danger btn-sm" onClick={() => remove(t)}>Delete</button>
                            <button className="btn btn-sm" onClick={() => setConfirmId(null)}>Keep</button>
                          </span>
                        ) : (
                          <button className="btn-icon hover:text-neg" aria-label="Delete transaction"
                            onClick={() => setConfirmId(t.id)}><Trash2 size={15} /></button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </aside>
    </div>
  )
}
