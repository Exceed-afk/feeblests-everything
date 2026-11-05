// The dashboard's Money widgets (Phase 6): left to spend, this month's
// spending by category, savings progress, the P&L curve and recent trades.
//
// Each widget loads its own data when it appears and shows what the module's
// own pages show, through the module's own API. Nothing here computes a total
// itself: budgets, balances and P&L come from the services, which already
// exclude trashed rows.
import { ChevronRight, PiggyBank, TrendingUp, Wallet } from 'lucide-react'
import type { SavingsGoal } from '../../../shared/types'
import type { ExpenseSummary } from '../../../modules/expenses/service/bridge'
import { progressPercent } from '../../../shared/savings'
import { fmtAmount } from '../lib/format'
import { formatDate, today } from '../lib/dates'
import { fmtCents, fmtCentsSigned, monthLabel, monthOf } from '../../../modules/expenses/ui/format'
import { loadSummary } from '../lib/dashboardSummary'
import { WidgetBody } from '../components/WidgetBody'
import { ProgressBar } from '../components/ProgressBar'
import { PnlChart } from '../components/PnlChart'
import { EmptyState } from '../components/EmptyState'
import { Pnl } from '../components/Pnl'
import type { WidgetProps } from '../widgets'

const MAX_GOALS = 4
const MAX_CATEGORIES = 5
const MAX_TRADES = 6

// A clickable line inside a widget: a row-link button, or a plain line while
// editing (so clicking a card never jumps away mid-arrangement).
function Row({ onClick, editMode, children, label }: { onClick: () => void; editMode: boolean; children: React.ReactNode; label: string }) {
  if (editMode) return <div className="row-link">{children}</div>
  return <button className="row-link" onClick={onClick} aria-label={label}>{children}</button>
}

// "View all" in the card head; hidden while editing.
function Head({ icon: Icon, title, action, editMode }: { icon: typeof Wallet; title: string; action: () => void; editMode: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <h2 className="section-title"><Icon size={15} /> {title}</h2>
      {!editMode && <button className="section-link" onClick={action}>View all <ChevronRight size={12} /></button>}
    </div>
  )
}

// ---------- Left to spend ----------

interface LeftToSpendData { summary: ExpenseSummary; categories: { id: number; name: string }[] }

export function LeftToSpendWidget({ editMode, onNavigate }: WidgetProps) {
  return (
    <WidgetBody load={async (): Promise<LeftToSpendData> => {
      const day = today()
      const [summary, categories] = await Promise.all([
        window.api.expenses.overview(monthOf(day), day),
        window.api.expenses.listCategories()
      ])
      return { summary, categories: categories.map((c) => ({ id: c.id, name: c.name })) }
    }}>
      {({ summary, categories }) => {
        const over = summary.leftToSpend < 0
        const nameOf = (id: number) => categories.find((c) => c.id === id)?.name ?? 'Category'
        // The biggest budgets first: those are the rows a person scans.
        const rows = [...summary.categories].sort((a, b) => b.budgetAmount - a.budgetAmount).slice(0, MAX_CATEGORIES)
        return (
          <section className="card card-pad h-full">
            <Head icon={Wallet} title="Left to spend" action={() => onNavigate('expenses')} editMode={editMode} />
            {summary.totalBudget === 0 ? (
              <div className="mt-3">
                <EmptyState compact title="No budget set" text="Set a monthly budget per category and this number tells you what is still safe to spend."
                  action={editMode ? undefined : <button className="btn-primary btn-sm" onClick={() => onNavigate('expenses')}>Set a budget</button>} />
              </div>
            ) : (
              <>
                <div className="mt-3 flex items-end justify-between gap-3">
                  <div>
                    <div className={`stat-value mt-0 ${over ? 'text-neg' : ''}`}>{fmtCentsSigned(summary.leftToSpend)}</div>
                    <div className="stat-sub">{over ? 'Over budget this month' : `${fmtCents(summary.safeToSpendPerDay)} safe to spend a day`}</div>
                  </div>
                  <div className="meta text-right">
                    {summary.daysRemaining} {summary.daysRemaining === 1 ? 'day' : 'days'} left<br />in {monthLabel(summary.month)}
                  </div>
                </div>
                <div className="meta mt-2 flex flex-wrap gap-x-3 gap-y-0.5">
                  <span>Budget <span className="num text-fg">{fmtCents(summary.totalBudget)}</span></span>
                  <span>Spent <span className="num text-fg">{fmtCents(summary.spentSoFar)}</span></span>
                  <span>Bills due <span className="num text-fg">{fmtCents(summary.billsStillDue)}</span></span>
                </div>
                {rows.length > 0 && (
                  <ul className="mt-3 flex flex-col gap-2 border-t border-line pt-3">
                    {rows.map((row) => {
                      const used = row.spentAmount + row.billsDueAmount
                      const pct = row.budgetAmount > 0 ? Math.min(100, Math.round((used / row.budgetAmount) * 100)) : used > 0 ? 100 : 0
                      return (
                        <li key={row.categoryId}>
                          <div className="flex items-baseline justify-between gap-3">
                            <span className="truncate text-sm">{nameOf(row.categoryId)}</span>
                            <span className={`num shrink-0 text-xs ${row.leftToSpend < 0 ? 'text-neg' : 'text-muted'}`}>
                              {row.leftToSpend < 0 ? `${fmtCents(-row.leftToSpend)} over` : `${fmtCents(row.leftToSpend)} left`}
                            </span>
                          </div>
                          <div className="mt-1"><ProgressBar percent={pct} /></div>
                        </li>
                      )
                    })}
                  </ul>
                )}
              </>
            )}
          </section>
        )
      }}
    </WidgetBody>
  )
}

// ---------- This month's spending ----------

export function SpendingMonthWidget({ editMode, onNavigate }: WidgetProps) {
  return (
    <WidgetBody load={(): Promise<ExpenseSummary> => {
      const day = today()
      return window.api.expenses.overview(monthOf(day), day)
    }}>
      {(summary) => {
        const spent = [...summary.categories].filter((c) => c.spentAmount > 0).sort((a, b) => b.spentAmount - a.spentAmount)
        const total = spent.reduce((n, c) => n + c.spentAmount, 0)
        return (
          <section className="card card-pad h-full">
            <Head icon={Wallet} title={`Spending in ${monthLabel(summary.month)}`} action={() => onNavigate('expenses')} editMode={editMode} />
            {spent.length === 0 ? (
              <div className="mt-3">
                <EmptyState compact title="Nothing spent yet" text="Log an expense and the month's biggest categories show up here." />
              </div>
            ) : (
              <>
                <div className="mt-3 flex items-baseline justify-between gap-3">
                  <span className="stat-value mt-0">{fmtCents(total)}</span>
                  <span className="meta">{spent.length} {spent.length === 1 ? 'category' : 'categories'}</span>
                </div>
                <ul className="mt-2 flex flex-col gap-2">
                  {spent.slice(0, MAX_CATEGORIES).map((c) => (
                    <li key={c.categoryId}>
                      <div className="flex items-baseline justify-between gap-3">
                        <span className="truncate text-sm">{c.categoryName}</span>
                        <span className="num shrink-0 text-xs text-muted">{fmtCents(c.spentAmount)}</span>
                      </div>
                      <div className="mt-1"><ProgressBar percent={total > 0 ? (c.spentAmount / total) * 100 : 0} /></div>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </section>
        )
      }}
    </WidgetBody>
  )
}

// ---------- Savings progress ----------

// Goals still in progress first (closest to done on top), then reached goals,
// then goals with no target. The same order the dashboard always used.
function featuredGoals(goals: SavingsGoal[]): SavingsGoal[] {
  const pct = (g: SavingsGoal) => progressPercent(g.balance, g.target)
  const rank = (g: SavingsGoal) => { const p = pct(g); return p === null ? 2 : p >= 100 ? 1 : 0 }
  return [...goals].sort((a, b) =>
    rank(a) - rank(b) || (rank(a) === 0 ? (pct(b) ?? 0) - (pct(a) ?? 0) : b.balance - a.balance))
}

export function SavingsGoalsWidget({ editMode, onNavigate, onOpen }: WidgetProps) {
  return (
    <WidgetBody load={loadSummary}>
      {({ goals }) => {
        const shown = featuredGoals(goals).slice(0, MAX_GOALS)
        const more = goals.length - shown.length
        return (
          <section className="card card-pad h-full">
            <Head icon={PiggyBank} title="Savings progress" action={() => onNavigate('savings')} editMode={editMode} />
            {goals.length === 0 ? (
              <div className="mt-3">
                <EmptyState compact title="No savings goals yet" text="Every big balance starts with one goal."
                  action={editMode ? undefined : <button className="btn-primary btn-sm" onClick={() => onNavigate('savings')}>Create a goal</button>} />
              </div>
            ) : (
              <div className="mt-3 grid gap-x-8 gap-y-1 xl:grid-cols-2">
                {shown.map((g) => {
                  const pct = progressPercent(g.balance, g.target)
                  return (
                    <Row key={g.id} editMode={editMode} onClick={() => onOpen({ module: 'savings', goalId: g.id })} label={`${g.name}: ${fmtAmount(g.balance)}`}>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-baseline justify-between gap-3">
                          <span className="truncate text-sm font-medium">{g.name}</span>
                          <span className="num shrink-0 text-sm">{fmtAmount(g.balance)}</span>
                        </div>
                        {g.target !== null && pct !== null ? (
                          <>
                            <div className="mt-2"><ProgressBar percent={pct} /></div>
                            <div className="meta mt-1 flex justify-between">
                              <span>{pct >= 100 ? 'Goal reached' : `${Math.floor(pct)}%`}</span>
                              <span>Target {fmtAmount(g.target)}</span>
                            </div>
                          </>
                        ) : <div className="meta mt-1">No target set</div>}
                      </div>
                    </Row>
                  )
                })}
                {more > 0 && !editMode && (
                  <button className="section-link" onClick={() => onNavigate('savings')}>+ {more} more {more === 1 ? 'goal' : 'goals'}</button>
                )}
              </div>
            )}
          </section>
        )
      }}
    </WidgetBody>
  )
}

// ---------- P&L over time ----------

export function PnlChartWidget({ editMode, onNavigate }: WidgetProps) {
  return (
    <WidgetBody load={loadSummary}>
      {({ pnlSeries }) => (
        <section className="card card-pad h-full">
          <Head icon={TrendingUp} title="P&L over time" action={() => onNavigate('trades')} editMode={editMode} />
          <div className="mt-3">
            {pnlSeries.length === 0 ? (
              <EmptyState compact title="No closed trades yet" text="Close a trade (add its exit price) and your running P&L shows up here."
                action={editMode ? undefined : <button className="btn-primary btn-sm" onClick={() => onNavigate('trades')}>Open trades</button>} />
            ) : <PnlChart points={pnlSeries} />}
          </div>
        </section>
      )}
    </WidgetBody>
  )
}

// ---------- Recent trades ----------

export function RecentTradesWidget({ editMode, onNavigate, onOpen }: WidgetProps) {
  return (
    <WidgetBody load={loadSummary}>
      {({ recentTrades }) => (
        <section className="card card-pad h-full">
          <Head icon={TrendingUp} title="Recent trades" action={() => onNavigate('trades')} editMode={editMode} />
          {recentTrades.length === 0 ? (
            <div className="mt-3">
              <EmptyState compact title="No trades yet" text="Your first entry starts the track record."
                action={editMode ? undefined : <button className="btn-primary btn-sm" onClick={() => onNavigate('trades')}>Log a trade</button>} />
            </div>
          ) : (
            <div className="mt-3 flex flex-col gap-0.5">
              {recentTrades.slice(0, MAX_TRADES).map((t) => (
                <Row key={t.id} editMode={editMode} onClick={() => onOpen({ module: 'trades', trade: t })} label={`${t.asset}, ${formatDate(t.date)}`}>
                  <span className="min-w-0">
                    <span className="flex items-center gap-2">
                      <span className="truncate text-sm font-medium">{t.asset}</span>
                      <span className={`badge capitalize ${t.direction === 'long' ? 'badge-pos' : 'badge-neg'}`}>{t.direction}</span>
                    </span>
                    <span className="meta mt-0.5 block">{formatDate(t.date)}</span>
                  </span>
                  <span className="shrink-0 text-sm font-medium">
                    {t.pnl === null ? <span className="badge badge-open">Open</span> : <Pnl value={t.pnl} />}
                  </span>
                </Row>
              ))}
            </div>
          )}
        </section>
      )}
    </WidgetBody>
  )
}


