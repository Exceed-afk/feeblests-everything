// Budgets tab (Phase 1): one budget amount per category per month, with a
// copy-from-last-month button and live usage bars.
//
// Data comes from the service contract only (service/API.md):
//   listBudgets, setBudget, deleteBudget, copyBudgetsFromPreviousMonth,
//   listCategories, computeLeftToSpend (for spent amounts).
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Copy, Target } from 'lucide-react'
import { EmptyState } from '../../../renderer/src/components/EmptyState'
import { ProgressBar } from '../../../renderer/src/components/ProgressBar'
import { errMsg } from '../../../renderer/src/lib/errors'
import { today } from '../../../renderer/src/lib/dates'
import { useRefreshOnCapture } from '../../../renderer/src/lib/dataChanged'
import type { ExpenseBudget, ExpenseCategory, LeftToSpendResult } from '../service'
import { centsToInput, fmtCents, monthLabel, parseCents, usagePercent } from './format'
import { BusyLabel, Field, FormMessage, MonthPicker } from './components'

export function BudgetsTab({ month, onMonthChange }: {
  month: string
  onMonthChange: (month: string) => void
}) {
  const [budgets, setBudgets] = useState<ExpenseBudget[]>([])
  const [categories, setCategories] = useState<ExpenseCategory[]>([])
  const [summary, setSummary] = useState<LeftToSpendResult | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [error, setError] = useState('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [copying, setCopying] = useState(false)

  const day = today()

  const refresh = useCallback(async () => {
    try {
      const [list, cats, result] = await Promise.all([
        window.api.expenses.listBudgets(month),
        window.api.expenses.listCategories(),
        window.api.expenses.overview(month, day)
      ])
      setBudgets(list)
      setCategories(cats)
      setSummary(result)
      setError('')
    } catch (e) {
      setError(errMsg(e))
    }
    setLoaded(true)
  }, [month, day])

  useEffect(() => { void refresh() }, [refresh])
  useRefreshOnCapture(refresh)

  const budgetFor = (categoryId: number): ExpenseBudget | undefined =>
    budgets.find((b) => b.categoryId === categoryId)
  const spentFor = (categoryId: number): number =>
    summary?.categories.find((c) => c.categoryId === categoryId)?.spentAmount ?? 0

  const totalBudget = useMemo(() => budgets.reduce((sum, b) => sum + b.amount, 0), [budgets])

  const copyLastMonth = async () => {
    setError(''); setNote(''); setCopying(true)
    try {
      const copied = await window.api.expenses.copyBudgets(month)
      setNote(copied.length === 0
        ? 'Last month had no budgets to copy.'
        : `Copied ${copied.length} ${copied.length === 1 ? 'budget' : 'budgets'} from last month.`)
      await refresh()
      void window.api.capture.saved()
    } catch (e) {
      setError(errMsg(e))
    }
    setCopying(false)
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <MonthPicker month={month} onChange={onMonthChange} />
        <button className="btn" onClick={() => void copyLastMonth()} disabled={copying || categories.length === 0}>
          <BusyLabel busy={copying}><Copy size={15} aria-hidden="true" /> Copy last month</BusyLabel>
        </button>
      </div>

      <p className="meta">
        {monthLabel(month)} total: <span className="num text-fg">{fmtCents(totalBudget)}</span> across{' '}
        {budgets.length} {budgets.length === 1 ? 'category' : 'categories'}. A budget of 0 means "nothing planned".
      </p>

      <FormMessage error={error} note={note} />

      {loaded && categories.length === 0 ? (
        <EmptyState
          icon={Target}
          title="No categories to budget for"
          text="Categories come with the Expenses module. If you archived them all, restore one in your data settings."
        />
      ) : loaded && budgets.length === 0 && !busy ? (
        <EmptyState
          icon={Target}
          title={`No budgets for ${monthLabel(month)}`}
          text="Give each category a monthly amount, then the Overview shows how much is left and how much you can spend each day."
          action={<button className="btn-primary" onClick={() => void copyLastMonth()} disabled={copying}><Copy size={15} aria-hidden="true" /> Copy last month</button>}
        />
      ) : null}

      <div className="card card-pad-lg">
        <ul className="flex flex-col divide-y divide-line/60">
          {categories.map((c) => (
            <BudgetRow
              key={c.id}
              category={c}
              month={month}
              budget={budgetFor(c.id)}
              spent={spentFor(c.id)}
              onChanged={async (message) => {
                setNote(message); setError('')
                await refresh()
                void window.api.capture.saved()
              }}
              onError={(message) => { setError(message); setNote('') }}
              onBusy={setBusy}
            />
          ))}
        </ul>
      </div>
    </div>
  )
}

// One row of the budgets list: the amount field saves on blur or Enter, and the
// bar shows this month's spending against it.
function BudgetRow({ category, month, budget, spent, onChanged, onError, onBusy }: {
  category: ExpenseCategory
  month: string
  budget: ExpenseBudget | undefined
  spent: number
  onChanged: (message: string) => Promise<void>
  onError: (message: string) => void
  onBusy: (busy: boolean) => void
}) {
  const [text, setText] = useState(budget ? centsToInput(budget.amount) : '')
  const [saving, setSaving] = useState(false)
  const lastSaved = useRef(budget ? budget.amount : 0)

  useEffect(() => {
    setText(budget ? centsToInput(budget.amount) : '')
    lastSaved.current = budget ? budget.amount : 0
  }, [budget?.id, budget?.amount])

  const save = async () => {
    const cents = parseCents(text === '' ? '0' : text)
    if (cents === null || cents < 0) return onError('Budget must be 0 or more, with at most 2 decimals.')
    if (cents === lastSaved.current && budget) return
    setSaving(true); onBusy(true)
    try {
      if (cents === 0 && budget) {
        await window.api.expenses.deleteBudget(budget.id)
        lastSaved.current = 0
        await onChanged(`Cleared the ${category.name} budget.`)
      } else {
        await window.api.expenses.setBudget({ categoryId: category.id, month, amount: cents })
        lastSaved.current = cents
        await onChanged(`Saved the ${category.name} budget.`)
      }
    } catch (e) {
      onError(errMsg(e))
    }
    setSaving(false); onBusy(false)
  }

  const amount = budget?.amount ?? 0
  const pct = usagePercent(spent, amount)
  const over = amount > 0 && spent > amount
  // A tiny transparent PNG that is only the category's own colour (stored data).
const swatch = (hex: string): string =>
  `url("data:image/svg+xml,${encodeURIComponent(`<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 1 1'><rect width='1' height='1' fill='${hex.replace(/'/g, '')}'/></svg>`)}")`

const inputId = `budget-${category.id}`

  return (
    <li className="py-3">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0 flex-1">
          {/* The stored category colour is data, not a design token, so it is drawn
              as a data-URI swatch instead of an inline style (which the app's UI
              rules forbid; see tests/design.ts). */}
          <div className="flex items-center gap-2">
            <span
              className="cat-swatch h-2.5 w-2.5 shrink-0 rounded-full bg-accent"
              style={{ backgroundImage: swatch(category.colour) }}
              aria-hidden="true"
            />
            <label htmlFor={inputId} className="text-sm font-medium">{category.name}</label>
          </div>
          {amount > 0 ? (
            <>
              <div className="mt-2 max-w-md"><ProgressBar percent={pct} tone={over ? 'accent' : 'pos'} /></div>
              <p className={`meta mt-1.5 ${over ? 'text-neg' : ''}`}>
                Spent {fmtCents(spent)} of {fmtCents(amount)}
                {over ? ` — ${fmtCents(spent - amount)} over` : ` — ${fmtCents(amount - spent)} left`} ({pct}%)
              </p>
            </>
          ) : (
            <p className="meta mt-2">{spent > 0 ? `Spent ${fmtCents(spent)} with no budget set` : 'No budget set'}</p>
          )}
        </div>

        <Field label="Monthly budget" className="w-36">
          <input
            id={inputId}
            className="field num"
            inputMode="decimal"
            value={text}
            placeholder="0.00"
            aria-busy={saving}
            onChange={(e) => setText(e.target.value)}
            onBlur={() => void save()}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); (e.target as HTMLInputElement).blur() } }}
          />
        </Field>
      </div>
    </li>
  )
}
