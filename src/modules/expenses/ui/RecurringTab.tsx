// Recurring bills and subscriptions tab (Phase 1): create, edit, pause and pay bills.
//
// Data comes from the service contract only (service/API.md):
//   listRecurringBills, createRecurringBill, updateRecurringBill, deleteRecurringBill,
//   markRecurringBillPaid, listDueBillsThisMonth, listCategories.
// Amounts are integer cents from the text field, never floats.
import { useCallback, useEffect, useMemo, useState } from 'react'
import { CalendarClock, Pencil, Plus, Repeat, Trash2 } from 'lucide-react'
import { EmptyState } from '../../../renderer/src/components/EmptyState'
import { errMsg } from '../../../renderer/src/lib/errors'
import { today } from '../../../renderer/src/lib/dates'
import { useRefreshOnCapture } from '../../../renderer/src/lib/dataChanged'
import type { ExpenseCategory, RecurringBill, RecurringCadence } from '../service'
import { CADENCE_LABEL, dayLabel, daysBetween, fmtCents, parseCents } from './format'
import { BusyLabel, Dialog, Field, FormMessage } from './components'

interface DueBill { bill: RecurringBill; dueDate: string; amount: number }

export function RecurringTab({ month }: { month: string }) {
  const [bills, setBills] = useState<RecurringBill[]>([])
  const [categories, setCategories] = useState<ExpenseCategory[]>([])
  const [dueBills, setDueBills] = useState<DueBill[]>([])
  const [loaded, setLoaded] = useState(false)
  const [error, setError] = useState('')
  const [note, setNote] = useState('')
  const [editing, setEditing] = useState<RecurringBill | 'new' | null>(null)
  const [confirmId, setConfirmId] = useState<number | null>(null)
  const [paying, setPaying] = useState<number | null>(null)

  const day = today()

  const refresh = useCallback(async () => {
    try {
      const [list, cats, due] = await Promise.all([
        window.api.expenses.listRecurringBills(),
        window.api.expenses.listCategories(),
        window.api.expenses.dueBills(month, day)
      ])
      setBills(list)
      setCategories(cats)
      setDueBills(due)
      setError('')
    } catch (e) {
      setError(errMsg(e))
    }
    setLoaded(true)
  }, [month, day])

  useEffect(() => { void refresh() }, [refresh])
  useRefreshOnCapture(refresh)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.key.toLowerCase() === 'n') {
        e.preventDefault()
        setEditing('new')
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const categoryName = (id: number | null): string =>
    (id === null ? null : categories.find((c) => c.id === id)?.name) ?? 'Uncategorized'

  // Monthly and yearly subscription totals, in cents. Weekly and custom bills
  // are averaged over 52 weeks / 365 days so the totals stay comparable.
  const totals = useMemo(() => {
    let monthly = 0
    let yearly = 0
    for (const b of bills) {
      if (b.cadence === 'monthly') monthly += b.amount
      else if (b.cadence === 'yearly') yearly += b.amount
      else if (b.cadence === 'weekly') monthly += Math.round((b.amount * 52) / 12)
      else if (b.cadence === 'custom' && b.intervalDays) monthly += Math.round((b.amount * 365) / (12 * b.intervalDays))
    }
    return { monthly, yearly: yearly + monthly * 12 }
  }, [bills])

  const markPaid = async (due: DueBill) => {
    setPaying(due.bill.id); setError(''); setNote('')
    try {
      await window.api.expenses.markBillPaid({ recurringId: due.bill.id, dueDate: due.dueDate, paidDate: today() })
      setNote(`Paid ${due.bill.name} (${fmtCents(due.amount)}).`)
      await refresh()
      void window.api.capture.saved()
    } catch (e) {
      setError(errMsg(e))
    }
    setPaying(null)
  }

  const remove = async (bill: RecurringBill) => {
    try {
      await window.api.expenses.deleteRecurringBill(bill.id)
      setConfirmId(null)
      await refresh()
      void window.api.capture.saved()
    } catch (e) {
      setError(errMsg(e))
      setConfirmId(null)
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="meta">
          {bills.length === 0 ? 'No recurring bills yet.' : (
            <>
              {bills.length} active {bills.length === 1 ? 'bill' : 'bills'} · about{' '}
              <span className="num text-fg">{fmtCents(totals.monthly)}</span>/month ·{' '}
              <span className="num text-fg">{fmtCents(totals.yearly)}</span>/year
            </>
          )}
        </p>
        <button className="btn-primary" onClick={() => setEditing('new')} title="Ctrl+N">
          <Plus size={16} aria-hidden="true" /> Add bill
        </button>
      </div>

      <FormMessage error={error} note={note} />

      {dueBills.length > 0 && (
        <section className="card card-pad-lg">
          <h2 className="section-title"><CalendarClock size={14} aria-hidden="true" /> Due this month</h2>
          <ul className="mt-3 flex flex-col divide-y divide-line/60">
            {dueBills.map((due) => {
              const days = daysBetween(day, due.dueDate)
              return (
                <li key={`${due.bill.id}-${due.dueDate}`} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium">{due.bill.name}</span>
                    <span className="meta">
                      {dayLabel(due.dueDate)} · {due.bill.autopay ? 'autopay' : 'manual'} ·{' '}
                      {days < 0 ? `${Math.abs(days)} ${Math.abs(days) === 1 ? 'day' : 'days'} overdue` : days === 0 ? 'due today' : `in ${days} ${days === 1 ? 'day' : 'days'}`}
                    </span>
                  </span>
                  <span className="flex items-center gap-2">
                    <span className="num text-sm font-medium">{fmtCents(due.amount)}</span>
                    <button className="btn btn-sm" onClick={() => void markPaid(due)} disabled={paying !== null} aria-busy={paying === due.bill.id}>
                      <BusyLabel busy={paying === due.bill.id}>Mark paid</BusyLabel>
                    </button>
                  </span>
                </li>
              )
            })}
          </ul>
        </section>
      )}

      {loaded && bills.length === 0 ? (
        <EmptyState
          icon={Repeat}
          title="Never miss a bill again"
          text="Add rent, subscriptions and other regular payments. Autopay bills are logged automatically on their due date; the rest wait for you to mark them paid."
          action={<button className="btn-primary" onClick={() => setEditing('new')}><Plus size={16} aria-hidden="true" /> Add your first bill</button>}
        />
      ) : (
        <div className="card overflow-hidden">
          <table className="tbl">
            <caption className="sr-only">Recurring bills and subscriptions</caption>
            <thead>
              <tr>
                <th scope="col">Bill</th>
                <th scope="col">Category</th>
                <th scope="col">Cadence</th>
                <th scope="col">Next due</th>
                <th scope="col" className="r">Amount</th>
                <th scope="col" className="w-24"><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody>
              {bills.map((bill) => (
                <tr key={bill.id}>
                  <td>
                    <div className="font-medium">{bill.name}</div>
                    <div className="meta">
                      {bill.autopay ? 'Autopay' : 'Manual'}
                      {bill.trialEndDate && ` · trial ends ${dayLabel(bill.trialEndDate)}`}
                      {bill.reminderLeadDays > 0 && ` · remind ${bill.reminderLeadDays}d before`}
                    </div>
                  </td>
                  <td><span className="secondary">{categoryName(bill.categoryId)}</span></td>
                  <td>
                    <span className="secondary">
                      {CADENCE_LABEL[bill.cadence]}
                      {bill.cadence === 'custom' && bill.intervalDays ? ` (${bill.intervalDays}d)` : ''}
                    </span>
                  </td>
                  <td>
                    <span className={bill.nextDueDate < day ? 'text-neg' : 'secondary'}>{bill.nextDueDate < day ? 'Overdue · ' : ''}{dayLabel(bill.nextDueDate)}</span>
                  </td>
                  <td className="r num font-medium">{fmtCents(bill.amount)}</td>
                  <td className="text-right">
                    {confirmId === bill.id ? (
                      <span className="flex items-center justify-end gap-1 whitespace-nowrap text-xs">
                        <button className="btn-danger btn-sm" onClick={() => void remove(bill)}>Delete</button>
                        <button className="btn btn-sm" onClick={() => setConfirmId(null)}>Keep</button>
                      </span>
                    ) : (
                      <span className="flex items-center justify-end gap-1">
                        <button className="btn-icon" aria-label={`Edit ${bill.name}`} onClick={() => setEditing(bill)}>
                          <Pencil size={15} aria-hidden="true" />
                        </button>
                        <button className="btn-icon hover:text-neg" aria-label={`Delete ${bill.name}`} onClick={() => setConfirmId(bill.id)}>
                          <Trash2 size={15} aria-hidden="true" />
                        </button>
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {editing && (
        <BillEditor
          bill={editing === 'new' ? null : editing}
          categories={categories}
          onClose={() => setEditing(null)}
          onSaved={async () => { setEditing(null); await refresh(); void window.api.capture.saved() }}
        />
      )}
    </div>
  )
}

// ------------------------------- editor -------------------------------

function BillEditor({ bill, categories, onClose, onSaved }: {
  bill: RecurringBill | null
  categories: ExpenseCategory[]
  onClose: () => void
  onSaved: () => void
}) {
  const [name, setName] = useState(bill?.name ?? '')
  const [amount, setAmount] = useState(bill ? (bill.amount / 100).toFixed(2) : '')
  const [cadence, setCadence] = useState<RecurringCadence>(bill?.cadence ?? 'monthly')
  const [intervalDays, setIntervalDays] = useState(bill?.intervalDays ? String(bill.intervalDays) : '')
  const [nextDueDate, setNextDueDate] = useState(bill?.nextDueDate ?? today())
  const [categoryId, setCategoryId] = useState(bill?.categoryId ? String(bill.categoryId) : '')
  const [payee, setPayee] = useState(bill?.payee ?? '')
  const [note, setNote] = useState(bill?.note ?? '')
  const [reminderLeadDays, setReminderLeadDays] = useState(String(bill?.reminderLeadDays ?? 0))
  const [autopay, setAutopay] = useState(bill?.autopay ?? false)
  const [trialEndDate, setTrialEndDate] = useState(bill?.trialEndDate ?? '')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const save = async () => {
    setError('')
    const cents = parseCents(amount)
    if (cents === null || cents <= 0) return setError('Enter an amount above 0, with at most 2 decimals.')
    if (!name.trim()) return setError('Give the bill a name, for example "Rent".')
    if (!/^\d{4}-\d{2}-\d{2}$/.test(nextDueDate)) return setError('Pick the next due date.')
    if (cadence === 'custom') {
      const days = Number(intervalDays)
      if (!Number.isInteger(days) || days <= 0) return setError('A custom cadence needs a whole number of days above 0.')
    }
    const lead = Number(reminderLeadDays)
    if (!Number.isInteger(lead) || lead < 0) return setError('Reminder lead time must be 0 or more days.')

    const input = {
      name: name.trim(),
      amount: cents,
      currency: bill?.currency ?? 'USD',
      cadence,
      intervalDays: cadence === 'custom' ? Number(intervalDays) : null,
      nextDueDate,
      categoryId: categoryId ? Number(categoryId) : null,
      reminderLeadDays: lead,
      autopay,
      trialEndDate: trialEndDate ? trialEndDate : null,
      payee,
      note
    }

    setBusy(true)
    try {
      if (bill) await window.api.expenses.updateRecurringBill(bill.id, input)
      else await window.api.expenses.createRecurringBill(input)
      onSaved()
    } catch (e) {
      setError(errMsg(e))
      setBusy(false)
    }
  }

  return (
    <Dialog title={bill ? 'Edit bill' : 'New recurring bill'} onClose={onClose} wide>
      <div className="space-y-4" onKeyDown={(e) => { if (e.key === 'Enter' && e.ctrlKey) { e.preventDefault(); void save() } }}>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Name">
            <input className="field" autoFocus value={name} onChange={(e) => { setName(e.target.value); setError('') }} placeholder="Rent, Spotify, …" />
          </Field>
          <Field label="Amount">
            <input className="field num" inputMode="decimal" value={amount} onChange={(e) => { setAmount(e.target.value); setError('') }} placeholder="0.00" aria-invalid={error !== ''} />
          </Field>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Cadence">
            <select className="field" value={cadence} onChange={(e) => setCadence(e.target.value as RecurringCadence)}>
              {(Object.keys(CADENCE_LABEL) as RecurringCadence[]).map((c) => <option key={c} value={c}>{CADENCE_LABEL[c]}</option>)}
            </select>
          </Field>
          {cadence === 'custom' ? (
            <Field label="Every N days">
              <input className="field num" inputMode="numeric" value={intervalDays} onChange={(e) => { setIntervalDays(e.target.value); setError('') }} placeholder="14" />
            </Field>
          ) : (
            <Field label="Next due date">
              <input type="date" className="field" value={nextDueDate} onChange={(e) => { setNextDueDate(e.target.value); setError('') }} />
            </Field>
          )}
        </div>

        {cadence === 'custom' && (
          <Field label="Next due date">
            <input type="date" className="field" value={nextDueDate} onChange={(e) => { setNextDueDate(e.target.value); setError('') }} />
          </Field>
        )}

        <div className="grid grid-cols-2 gap-3">
          <Field label="Category">
            <select className="field" value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
              <option value="">No category</option>
              {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </Field>
          <Field label="Payee">
            <input className="field" value={payee} onChange={(e) => setPayee(e.target.value)} placeholder="Who is paid" />
          </Field>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Remind me before" hint="Days before the due date. 0 = no reminder.">
            <input className="field num" inputMode="numeric" value={reminderLeadDays} onChange={(e) => { setReminderLeadDays(e.target.value); setError('') }} />
          </Field>
          <Field label="Trial ends (optional)">
            <input type="date" className="field" value={trialEndDate} onChange={(e) => setTrialEndDate(e.target.value)} />
          </Field>
        </div>

        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={autopay} onChange={(e) => setAutopay(e.target.checked)} />
          Autopay — log the expense automatically on the due date
        </label>

        <Field label="Note">
          <input className="field" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Optional" />
        </Field>

        <FormMessage error={error} />

        <div className="flex items-center justify-end gap-2">
          <span className="mr-auto text-xs text-muted">Ctrl+Enter to save</span>
          <button className="btn" onClick={onClose} disabled={busy}>Cancel</button>
          <button className="btn-primary" onClick={() => void save()} disabled={busy}>
            <BusyLabel busy={busy}>{bill ? 'Save changes' : 'Add bill'}</BusyLabel>
          </button>
        </div>
      </div>
    </Dialog>
  )
}
