// Overview tab (Phase 1): the big "left to spend" number, the per-category
// budget bars and the bills still due this month.
//
// Data comes from the service contract only (service/API.md):
//   computeLeftToSpend, listDueBillsThisMonth, listCategories, transferLeftoverToSavings.
// Money is integer cents throughout; the page never adds floats.
import { useCallback, useEffect, useState } from 'react'
import { ArrowRight, CalendarClock, PiggyBank, Wallet } from 'lucide-react'
import type { SavingsGoal } from '../../../shared/types'
import { EmptyState } from '../../../renderer/src/components/EmptyState'
import { ProgressBar } from '../../../renderer/src/components/ProgressBar'
import { errMsg } from '../../../renderer/src/lib/errors'
import { today } from '../../../renderer/src/lib/dates'
import { useRefreshOnCapture } from '../../../renderer/src/lib/dataChanged'
import type {
  CategoryLeftToSpend,
  ExpenseCategory,
  LeftToSpendResult,
  RecurringBill
} from '../service'
import {
  CADENCE_LABEL,
  dayLabel,
  fmtCents,
  fmtCentsSigned,
  monthLabel,
  parseCents,
  usagePercent
} from './format'
import { BusyLabel, Field, FormMessage, MonthPicker, StatTile } from './components'

interface DueBill { bill: RecurringBill; dueDate: string; amount: number }

const categoryName = (categories: ExpenseCategory[], id: number | null): string =>
  (id === null ? null : categories.find((c) => c.id === id)?.name) ?? 'Uncategorized'

export function OverviewTab({ month, onMonthChange, onOpenTransactions }: {
  month: string
  onMonthChange: (month: string) => void
  onOpenTransactions: () => void
}) {
  const [summary, setSummary] = useState<LeftToSpendResult | null>(null)
  const [categories, setCategories] = useState<ExpenseCategory[]>([])
  const [dueBills, setDueBills] = useState<DueBill[]>([])
  const [goals, setGoals] = useState<SavingsGoal[]>([])
  const [loaded, setLoaded] = useState(false)
  const [error, setError] = useState('')
  const [goalChoice, setGoalChoice] = useState('')
  const [amountText, setAmountText] = useState('')
  const [transferError, setTransferError] = useState('')
  const [transferNote, setTransferNote] = useState('')
  const [busy, setBusy] = useState(false)

  const day = today()

  const refresh = useCallback(async () => {
    try {
      // The service functions are synchronous over the database handle; the
      // renderer reaches them through the small bridge described in API.md.
      const [summaryResult, categoryList, bills, savingsGoals] = await Promise.all([
        window.api.expenses.overview(month, day),
        window.api.expenses.listCategories(),
        window.api.expenses.dueBills(month, day),
        window.api.savings.listGoals()
      ])
      setSummary(summaryResult)
      setCategories(categoryList)
      setDueBills(bills)
      setGoals(savingsGoals)
      setError('')
    } catch (e) {
      setError(errMsg(e))
    }
    setLoaded(true)
  }, [month, day])

  useEffect(() => { void refresh() }, [refresh])
  useRefreshOnCapture(refresh)

  // The transfer box follows the current left-to-spend figure until the user
  // edits it, so "move it to a goal" is one click.
  useEffect(() => {
    if (summary) setAmountText((summary.leftToSpend / 100).toFixed(2))
  }, [summary?.leftToSpend])

  const categoriesWithBudget = summary?.categories.filter((c) => c.budgetAmount > 0 || c.spentAmount > 0) ?? []

  const transfer = async () => {
    setTransferError(''); setTransferNote('')
    const goalId = Number(goalChoice)
    if (!goalId) return setTransferError('Pick a savings goal first.')
    const cents = parseCents(amountText)
    if (cents === null || cents <= 0) return setTransferError('Enter an amount above 0, with at most 2 decimals.')
    setBusy(true)
    try {
      const result = await window.api.expenses.transferLeftover({
        amountCents: cents, goalId, date: today(), note: `Leftover from ${monthLabel(month)}`
      })
      setTransferNote(`Moved ${fmtCents(result.amountCents)} to ${result.goalName}. New balance ${fmtCents(result.newGoalBalance * 100)}.`)
      await refresh()
      // Other pages (Savings, Dashboard) reload from the same push the Quick
      // capture window uses.
      void window.api.capture.saved()
    } catch (e) {
      setTransferError(errMsg(e))
    }
    setBusy(false)
  }

  const overdue = dueBills.filter((b) => b.dueDate < day)

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <MonthPicker month={month} onChange={onMonthChange} nextDisabled={month >= day.slice(0, 7)} />
        <button className="btn" onClick={onOpenTransactions}>
          All transactions <ArrowRight size={14} aria-hidden="true" />
        </button>
      </div>

      {error && <FormMessage error={error} />}

      {loaded && summary && summary.totalBudget === 0 && summary.spentSoFar === 0 && (
        <EmptyState
          icon={Wallet}
          title="Start with a budget for this month"
          text="Set how much you plan to spend per category and this page shows how much is left, and how much you can safely spend each day."
        />
      )}

      {summary && (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <StatTile
              label="Left to spend"
              value={fmtCentsSigned(summary.leftToSpend)}
              tone={summary.leftToSpend < 0 ? 'neg' : 'default'}
              caption={summary.leftToSpend < 0 ? 'Over budget this month' : `Budget ${fmtCents(summary.totalBudget)}`}
            />
            <StatTile
              label="Safe to spend / day"
              value={fmtCents(summary.safeToSpendPerDay)}
              caption={`${summary.daysRemaining} ${summary.daysRemaining === 1 ? 'day' : 'days'} left in ${monthLabel(month)}`}
            />
            <StatTile label="Spent so far" value={fmtCents(summary.spentSoFar)} caption="Expenses only, not transfers or income" />
            <StatTile label="Bills still due" value={fmtCents(summary.billsStillDue)} caption={`${dueBills.length} ${dueBills.length === 1 ? 'bill' : 'bills'} due this month`} />
          </div>

          <section className="card card-pad-lg">
            <h2 className="section-title">By category</h2>
            {categoriesWithBudget.length === 0 ? (
              <p className="mt-3 text-sm text-muted">
                No budgets or spending in {monthLabel(month)} yet. Set a budget in the Budgets tab and it appears here.
              </p>
            ) : (
              <ul className="mt-4 flex flex-col divide-y divide-line/60">
                {categoriesWithBudget.map((c) => <CategoryRow key={c.categoryId} row={c} />)}
              </ul>
            )}
          </section>

          <section className="card card-pad-lg">
            <h2 className="section-title"><CalendarClock size={14} aria-hidden="true" /> Bills still due</h2>
            {dueBills.length === 0 ? (
              <p className="mt-3 text-sm text-muted">
                Nothing left to pay this month. Add a bill in the Recurring tab and it shows up here on its due date.
              </p>
            ) : (
              <ul className="mt-4 flex flex-col divide-y divide-line/60">
                {dueBills.map(({ bill, dueDate, amount }) => (
                  <li key={`${bill.id}-${dueDate}`} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium">{bill.name}</span>
                      <span className="meta">
                        {dayLabel(dueDate)} · {categoryName(categories, bill.categoryId)} · {CADENCE_LABEL[bill.cadence]}
                        {bill.autopay ? ' · autopay' : ''}
                      </span>
                    </span>
                    <span className="flex items-center gap-2">
                      {dueDate < day && <span className="badge badge-neg">Overdue</span>}
                      <span className="num text-sm font-medium">{fmtCents(amount)}</span>
                    </span>
                  </li>
                ))}
              </ul>
            )}
            {overdue.length > 0 && (
              <p className="meta mt-3">
                {overdue.length} {overdue.length === 1 ? 'bill was' : 'bills were'} due before today and {overdue.length === 1 ? 'is' : 'are'} still unpaid.
              </p>
            )}
          </section>

          <section className="card card-pad-lg">
            <h2 className="section-title"><PiggyBank size={14} aria-hidden="true" /> Move leftover money to savings</h2>
            <p className="mt-2 text-sm text-muted">
              You have {fmtCents(Math.max(0, summary.leftToSpend))} left this month. Moving it creates a transfer and a
              savings deposit together, so it is never counted twice.
            </p>
            {goals.length === 0 ? (
              <p className="mt-3 text-sm text-muted">Create a savings goal first and it can receive your leftover budget.</p>
            ) : (
              <div className="mt-4 flex flex-wrap items-end gap-3">
                <Field label="Savings goal" className="w-56">
                  <select className="field" value={goalChoice} onChange={(e) => { setGoalChoice(e.target.value); setTransferError('') }}>
                    <option value="">Pick a goal…</option>
                    {goals.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
                  </select>
                </Field>
                <Field label="Amount" className="w-36">
                  <input className="field num" inputMode="decimal" value={amountText}
                    aria-invalid={transferError !== ''}
                    onChange={(e) => { setAmountText(e.target.value); setTransferError('') }} />
                </Field>
                <button className="btn-primary" onClick={() => void transfer()} disabled={busy || summary.leftToSpend <= 0}>
                  <BusyLabel busy={busy}>Move to savings</BusyLabel>
                </button>
              </div>
            )}
            <div className="mt-3">
              <FormMessage error={transferError} note={transferNote} />
            </div>
          </section>
        </>
      )}
    </div>
  )
}

function CategoryRow({ row }: { row: CategoryLeftToSpend & { categoryName: string } }) {
  const used = row.spentAmount + row.billsDueAmount
  const pct = usagePercent(used, row.budgetAmount)
  const over = row.leftToSpend < 0
  return (
    <li className="py-3">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <span className="text-sm font-medium">{row.categoryName}</span>
        <span className="num text-sm">
          <span className={over ? 'text-neg' : 'text-fg'}>{fmtCents(used)}</span>
          <span className="text-muted"> of {fmtCents(row.budgetAmount)}</span>
        </span>
      </div>
      <div className="mt-2"><ProgressBar percent={pct} tone={over ? 'accent' : 'pos'} /></div>
      <div className="meta mt-1.5 flex flex-wrap justify-between gap-2">
        <span>
          Spent {fmtCents(row.spentAmount)}
          {row.billsDueAmount > 0 && ` · bills due ${fmtCents(row.billsDueAmount)}`}
        </span>
        <span className={over ? 'text-neg' : ''}>
          {over ? `${fmtCents(-row.leftToSpend)} over` : `${fmtCents(row.leftToSpend)} left`} ({pct}%)
        </span>
      </div>
    </li>
  )
}
