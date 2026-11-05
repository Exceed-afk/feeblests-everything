// Expenses page (Phase 1): one page with four tabs — Overview, Transactions,
// Budgets and Recurring. This file owns the tab bar and the shared month.
//
// It is a module page like every other: it receives ModuleProps and renders
// inside the app shell. Tab switching is keyboard accessible (roving arrow keys
// on the tab strip, Home/End jump to the ends).
import { useEffect, useRef, useState } from 'react'
import type { ModuleProps } from '../../../renderer/src/lib/navigation'
import { PageHeader } from '../../../renderer/src/components/PageHeader'
import { today } from '../../../renderer/src/lib/dates'
import { OverviewTab } from './OverviewTab'
import { TransactionsTab } from './TransactionsTab'
import { BudgetsTab } from './BudgetsTab'
import { RecurringTab } from './RecurringTab'
import { todayMonth } from './format'

export type ExpensesTab = 'overview' | 'transactions' | 'budgets' | 'recurring'

const TABS: { id: ExpensesTab; label: string }[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'transactions', label: 'Transactions' },
  { id: 'budgets', label: 'Budgets' },
  { id: 'recurring', label: 'Recurring' }
]

export function ExpensesPage(_props: ModuleProps) {
  const [tab, setTab] = useState<ExpensesTab>('overview')
  const [month, setMonth] = useState(todayMonth(today()))
  const buttons = useRef<Array<HTMLButtonElement | null>>([])

  // Arrow keys move along the tab strip; Home/End jump to the first/last tab.
  // Only the arrow keys are prevented, so Tab still leaves the strip normally.
  const onTabKey = (e: React.KeyboardEvent<HTMLButtonElement>, index: number) => {
    const last = TABS.length - 1
    let next: number | null = null
    if (e.key === 'ArrowRight') next = index === last ? 0 : index + 1
    else if (e.key === 'ArrowLeft') next = index === 0 ? last : index - 1
    else if (e.key === 'Home') next = 0
    else if (e.key === 'End') next = last
    if (next === null) return
    e.preventDefault()
    setTab(TABS[next].id)
    buttons.current[next]?.focus()
  }

  // Keep the page reachable from the command palette / global keys: Ctrl+1..4
  // inside the page switches tabs, leaving the app's global shortcuts alone.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!e.altKey && !e.metaKey && e.ctrlKey && /^[1-4]$/.test(e.key)) {
        const index = Number(e.key) - 1
        if (TABS[index]) {
          e.preventDefault()
          setTab(TABS[index].id)
        }
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  return (
    <div className="page">
      <PageHeader
        title="Expenses"
        subtitle="Where your money goes, and how much you can still spend this month."
      />

      <div className="seg mb-5" role="tablist" aria-label="Expenses views">
        {TABS.map((t, i) => (
          <button
            key={t.id}
            ref={(el) => { buttons.current[i] = el }}
            role="tab"
            id={`expenses-tab-${t.id}`}
            aria-selected={tab === t.id}
            aria-controls={`expenses-panel-${t.id}`}
            tabIndex={tab === t.id ? 0 : -1}
            onClick={() => setTab(t.id)}
            onKeyDown={(e) => onTabKey(e, i)}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div role="tabpanel" id={`expenses-panel-${tab}`} aria-labelledby={`expenses-tab-${tab}`} tabIndex={-1}>
        {tab === 'overview' && (
          <OverviewTab month={month} onMonthChange={setMonth} onOpenTransactions={() => setTab('transactions')} />
        )}
        {tab === 'transactions' && <TransactionsTab month={month} onMonthChange={setMonth} />}
        {tab === 'budgets' && <BudgetsTab month={month} onMonthChange={setMonth} />}
        {tab === 'recurring' && <RecurringTab month={month} />}
      </div>
    </div>
  )
}
