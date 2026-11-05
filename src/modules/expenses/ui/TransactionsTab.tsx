// Transactions tab (Phase 1): filter, search and edit expenses, income and transfers.
//
// Data comes from the service contract only (service/API.md):
//   listExpenseTransactions, createExpenseTransaction, updateExpenseTransaction,
//   deleteExpenseTransaction, listCategories.
// Amounts are integer cents from the text field, never floats.
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Pencil, Plus, Receipt, Search, Trash2 } from 'lucide-react'
import { EmptyState } from '../../../renderer/src/components/EmptyState'
import { errMsg } from '../../../renderer/src/lib/errors'
import { today } from '../../../renderer/src/lib/dates'
import { useRefreshOnCapture } from '../../../renderer/src/lib/dataChanged'
import type { ExpenseCategory, ExpenseTransaction, ExpenseTxType } from '../service'
import {
  dayLabel,
  fmtCents,
  fmtCentsSigned,
  monthLabel,
  parseCents,
  monthOf,
  TX_TYPE_LABEL
} from './format'
import { BusyLabel, Dialog, Field, FormMessage, MonthPicker } from './components'

const TYPE_TONE: Record<ExpenseTxType, string> = {
  expense: 'text-fg',
  income: 'text-pos',
  transfer: 'text-muted'
}

const signedCents = (tx: ExpenseTransaction): number => (tx.type === 'income' ? tx.amount : -tx.amount)

export function TransactionsTab({ month, onMonthChange }: {
  month: string
  onMonthChange: (month: string) => void
}) {
  const [transactions, setTransactions] = useState<ExpenseTransaction[]>([])
  const [categories, setCategories] = useState<ExpenseCategory[]>([])
  const [loaded, setLoaded] = useState(false)
  const [error, setError] = useState('')
  const [text, setText] = useState('')
  const [typeFilter, setTypeFilter] = useState<'all' | ExpenseTxType>('all')
  const [categoryFilter, setCategoryFilter] = useState<'all' | number>('all')
  const [editing, setEditing] = useState<ExpenseTransaction | 'new' | null>(null)
  const [confirmId, setConfirmId] = useState<number | null>(null)

  const refresh = useCallback(async () => {
    try {
      const [txs, cats] = await Promise.all([
        window.api.expenses.listTransactions({ month }),
        window.api.expenses.listCategories(true)
      ])
      setTransactions(txs)
      setCategories(cats)
      setError('')
    } catch (e) {
      setError(errMsg(e))
    }
    setLoaded(true)
  }, [month])

  useEffect(() => { void refresh() }, [refresh])
  useRefreshOnCapture(refresh)

  // Ctrl+N starts a new transaction, like every other page.
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

  const visible = useMemo(() => {
    const needle = text.trim().toLowerCase()
    return transactions.filter((tx) => {
      if (typeFilter !== 'all' && tx.type !== typeFilter) return false
      if (categoryFilter !== 'all' && tx.categoryId !== categoryFilter) return false
      if (!needle) return true
      return [tx.payee, tx.note, categoryName(tx.categoryId), ...tx.tags]
        .some((field) => field.toLowerCase().includes(needle))
    })
  }, [transactions, text, typeFilter, categoryFilter, categories])

  const totals = useMemo(() => visible.reduce((acc, tx) => {
    if (tx.type === 'expense') acc.spent += tx.amount
    else if (tx.type === 'income') acc.income += tx.amount
    else acc.transferred += tx.amount
    return acc
  }, { spent: 0, income: 0, transferred: 0 }), [visible])

  const remove = async (tx: ExpenseTransaction) => {
    try {
      await window.api.expenses.deleteTransaction(tx.id)
      setConfirmId(null)
      await refresh()
    } catch (e) {
      setError(errMsg(e))
      setConfirmId(null)
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <MonthPicker month={month} onChange={onMonthChange} />
        <button className="btn-primary" onClick={() => setEditing('new')} title="Ctrl+N">
          <Plus size={16} aria-hidden="true" /> Add transaction
        </button>
      </div>

      <div className="card card-pad">
        <div className="flex flex-wrap items-end gap-3">
          <div className="relative min-w-[12rem] flex-1">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" aria-hidden="true" />
            <input
              className="field pl-9"
              placeholder="Search payee, note, category or tag"
              aria-label="Search transactions"
              value={text}
              onChange={(e) => setText(e.target.value)}
            />
          </div>
          <Field label="Type" className="w-36">
            <select className="field" value={typeFilter} onChange={(e) => setTypeFilter(e.target.value as 'all' | ExpenseTxType)}>
              <option value="all">All types</option>
              <option value="expense">Expense</option>
              <option value="income">Income</option>
              <option value="transfer">Transfer</option>
            </select>
          </Field>
          <Field label="Category" className="w-44">
            <select className="field" value={String(categoryFilter)} onChange={(e) => setCategoryFilter(e.target.value === 'all' ? 'all' : Number(e.target.value))}>
              <option value="all">All categories</option>
              {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </Field>
        </div>
        <p className="meta mt-3">
          {monthLabel(month)}: spent <span className="num text-fg">{fmtCents(totals.spent)}</span>, income{' '}
          <span className="num text-pos">{fmtCents(totals.income)}</span>, transferred{' '}
          <span className="num text-fg">{fmtCents(totals.transferred)}</span> (transfers are not spending).
        </p>
      </div>

      {error && <FormMessage error={error} />}

      {loaded && transactions.length === 0 ? (
        <EmptyState
          icon={Receipt}
          title={`Nothing logged in ${monthLabel(month)}`}
          text="Add what you spent, income that came in, or money moved aside. Each entry is one line here."
          action={<button className="btn-primary" onClick={() => setEditing('new')}><Plus size={16} aria-hidden="true" /> Add your first transaction</button>}
        />
      ) : loaded && visible.length === 0 ? (
        <EmptyState
          icon={Search}
          title="No transactions match these filters"
          text="Widen the month, clear the search or pick another type."
          action={<button className="btn" onClick={() => { setText(''); setTypeFilter('all'); setCategoryFilter('all') }}>Clear filters</button>}
        />
      ) : (
        <div className="card overflow-hidden">
          <table className="tbl">
            <caption className="sr-only">Transactions in {monthLabel(month)}</caption>
            <thead>
              <tr>
                <th scope="col">Date</th>
                <th scope="col">Payee</th>
                <th scope="col">Category</th>
                <th scope="col">Type</th>
                <th scope="col" className="r">Amount</th>
                <th scope="col" className="w-24"><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody>
              {visible.map((tx) => (
                <tr key={tx.id}>
                  <td><span className="secondary">{dayLabel(tx.date)}</span></td>
                  <td>
                    <div className="font-medium">{tx.payee || '—'}</div>
                    {tx.note && <div className="secondary">{tx.note}</div>}
                    {tx.tags.length > 0 && <div className="meta">{tx.tags.map((t) => `#${t}`).join(' ')}</div>}
                  </td>
                  <td><span className="secondary">{categoryName(tx.categoryId)}</span></td>
                  <td><span className="secondary">{TX_TYPE_LABEL[tx.type]}</span></td>
                  <td className={`r num font-medium ${TYPE_TONE[tx.type]}`}>
                    {tx.type === 'expense' ? '−' : tx.type === 'income' ? '+' : ''}
                    {fmtCents(tx.amount)}
                  </td>
                  <td className="text-right">
                    {confirmId === tx.id ? (
                      <span className="flex items-center justify-end gap-1 whitespace-nowrap text-xs">
                        <button className="btn-danger btn-sm" onClick={() => void remove(tx)}>Delete</button>
                        <button className="btn btn-sm" onClick={() => setConfirmId(null)}>Keep</button>
                      </span>
                    ) : (
                      <span className="flex items-center justify-end gap-1">
                        <button className="btn-icon" aria-label={`Edit ${tx.payee || 'transaction'}`} onClick={() => setEditing(tx)}>
                          <Pencil size={15} aria-hidden="true" />
                        </button>
                        <button className="btn-icon hover:text-neg" aria-label={`Delete ${tx.payee || 'transaction'}`} onClick={() => setConfirmId(tx.id)}>
                          <Trash2 size={15} aria-hidden="true" />
                        </button>
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <th scope="row" colSpan={4} className="text-left">
                  {visible.length} {visible.length === 1 ? 'transaction' : 'transactions'}
                </th>
                <td className="r num font-medium">{fmtCentsSigned(totals.income - totals.spent)}</td>
                <td />
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      {editing && (
        <TransactionEditor
          tx={editing === 'new' ? null : editing}
          categories={categories}
          defaultDate={monthOf(today()) === month ? today() : `${month}-01`}
          onClose={() => setEditing(null)}
          onSaved={async () => { setEditing(null); await refresh(); void window.api.capture.saved() }}
        />
      )}
    </div>
  )
}

// ------------------------------- editor -------------------------------

function TransactionEditor({ tx, categories, defaultDate, onClose, onSaved }: {
  tx: ExpenseTransaction | null
  categories: ExpenseCategory[]
  defaultDate: string
  onClose: () => void
  onSaved: () => void
}) {
  const [type, setType] = useState<ExpenseTxType>(tx?.type ?? 'expense')
  const [amount, setAmount] = useState(tx ? (tx.amount / 100).toFixed(2) : '')
  const [date, setDate] = useState(tx?.date ?? defaultDate)
  const [categoryId, setCategoryId] = useState(tx?.categoryId ? String(tx.categoryId) : '')
  const [payee, setPayee] = useState(tx?.payee ?? '')
  const [note, setNote] = useState(tx?.note ?? '')
  const [tags, setTags] = useState(tx ? tx.tags.join(', ') : '')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const save = async () => {
    setError('')
    const cents = parseCents(amount)
    if (cents === null || cents <= 0) return setError('Enter an amount above 0, with at most 2 decimals.')
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return setError('Pick a date.')
    const input = {
      amount: cents,
      currency: tx?.currency ?? 'USD',
      date,
      categoryId: categoryId ? Number(categoryId) : null,
      payee,
      note,
      type,
      tags: tags.split(',').map((t) => t.trim().replace(/^#+/, '').toLowerCase()).filter(Boolean),
      transferTarget: tx?.transferTarget ?? null,
      recurringId: tx?.recurringId ?? null
    }
    setBusy(true)
    try {
      if (tx) await window.api.expenses.updateTransaction(tx.id, input)
      else await window.api.expenses.createTransaction(input)
      onSaved()
    } catch (e) {
      setError(errMsg(e))
      setBusy(false)
    }
  }

  return (
    <Dialog title={tx ? 'Edit transaction' : 'New transaction'} onClose={onClose}>
      <div className="space-y-4" onKeyDown={(e) => { if (e.key === 'Enter' && e.ctrlKey) { e.preventDefault(); void save() } }}>
        <div className="seg" role="group" aria-label="Transaction type">
          {(['expense', 'income', 'transfer'] as ExpenseTxType[]).map((t) => (
            <button key={t} type="button" aria-pressed={type === t} onClick={() => setType(t)}>{TX_TYPE_LABEL[t]}</button>
          ))}
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Amount">
            <input className="field num" autoFocus inputMode="decimal" value={amount}
              aria-invalid={error !== ''} aria-describedby={error ? 'tx-error' : undefined}
              onChange={(e) => { setAmount(e.target.value); setError('') }} placeholder="0.00" />
          </Field>
          <Field label="Date">
            <input type="date" className="field" value={date} onChange={(e) => { setDate(e.target.value); setError('') }} />
          </Field>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Category">
            <select className="field" value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
              <option value="">No category</option>
              {categories.map((c) => <option key={c.id} value={c.id}>{c.name}{c.archived ? ' (archived)' : ''}</option>)}
            </select>
          </Field>
          <Field label="Payee">
            <input className="field" value={payee} onChange={(e) => setPayee(e.target.value)} placeholder="Shop, employer, …" />
          </Field>
        </div>

        <Field label="Note">
          <input className="field" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Optional" />
        </Field>

        <Field label="Tags" hint="Comma separated. Tags help search find the entry later.">
          <input className="field" value={tags} onChange={(e) => setTags(e.target.value)} placeholder="food, work" />
        </Field>

        <div id="tx-error"><FormMessage error={error} /></div>

        <div className="flex items-center justify-end gap-2">
          <span className="mr-auto text-xs text-muted">Ctrl+Enter to save</span>
          <button className="btn" onClick={onClose} disabled={busy}>Cancel</button>
          <button className="btn-primary" onClick={() => void save()} disabled={busy}>
            <BusyLabel busy={busy}>{tx ? 'Save changes' : 'Add transaction'}</BusyLabel>
          </button>
        </div>
      </div>
    </Dialog>
  )
}
