// Lazy chunks for the dashboard widgets.
//
// Kept apart from ./widgets.ts because a lazy component has to BE a component:
// `lazy(() => import('./widgets/MoneyWidgets'))` would resolve to the module's
// named exports, which are not components. Each lazy below picks one widget
// out of its module and loads that module at most once, however many of its
// widgets are placed.
import { lazy } from 'react'
import type { ComponentType } from 'react'
import type { WidgetProps } from './widgets'

const chunk = <M, K extends keyof M>(
  load: () => Promise<M>,
  pick: K,
  name: string
): React.LazyExoticComponent<ComponentType<WidgetProps>> =>
  lazy(async () => {
    const mod = await load()
    const component = mod[pick] as unknown
    if (typeof component !== 'function') throw new Error(`The dashboard widget "${name}" could not be loaded.`)
    return { default: component as ComponentType<WidgetProps> }
  })

const board = () => import('./widgets/BoardWidgets')
const money = () => import('./widgets/MoneyWidgets')
const daily = () => import('./widgets/DailyWidgets')

export const Board = {
  SavedWidget: chunk(board, 'SavedWidget', 'saved'),
  TradesPnlWidget: chunk(board, 'TradesPnlWidget', 'trades-pnl'),
  TradesCountWidget: chunk(board, 'TradesCountWidget', 'trades-count'),
  LogStreakWidget: chunk(board, 'LogStreakWidget', 'log-streak')
}

export const Money = {
  LeftToSpendWidget: chunk(money, 'LeftToSpendWidget', 'left-to-spend'),
  SpendingMonthWidget: chunk(money, 'SpendingMonthWidget', 'spending-month'),
  SavingsGoalsWidget: chunk(money, 'SavingsGoalsWidget', 'savings-goals'),
  PnlChartWidget: chunk(money, 'PnlChartWidget', 'pnl-chart'),
  RecentTradesWidget: chunk(money, 'RecentTradesWidget', 'recent-trades')
}

export const Daily = {
  HabitsWidget: chunk(daily, 'HabitsWidget', 'habits'),
  TasksWidget: chunk(daily, 'TasksWidget', 'tasks'),
  FocusWidget: chunk(daily, 'FocusWidget', 'focus-today'),
  ContentWidget: chunk(daily, 'ContentWidget', 'content-next'),
  PinnedNotesWidget: chunk(daily, 'PinnedNotesWidget', 'pinned-notes'),
  RecentLogWidget: chunk(daily, 'RecentLogWidget', 'recent-log'),
  DoorsWidget: chunk(daily, 'DoorsWidget', 'briefing-doors'),
  PinnedToolsWidget: chunk(daily, 'PinnedToolsWidget', 'pinned-tools')
}
