// THE dashboard widget registry (Phase 6).
//
// Every cell on the Dashboard is defined here, once. A widget declares:
//   id        short and lowercase; it is what a saved layout stores
//   title     the heading of its card
//   sizes     which preset sizes it offers (see shared/dashboardLayout.ts)
//   module    the tool id whose module must be ON for it to show. A widget
//             whose module is switched off in Settings > Modules is skipped
//             gracefully instead of loading data it cannot show.
//   load      the data loader. It runs ONLY when the widget is on screen
//             (DashboardWidget mounts it), so a layout with ten widgets does
//             not fetch ten times when only six are visible.
//   render    draws the loaded data; a component, not a page.
//
// Widgets live in ./widgets/*.tsx and are loaded lazily: the Dashboard imports
// the registry below, which uses React.lazy, so each widget's code (and its
// module's helpers) arrives with its first render.
import type { ComponentType } from 'react'
import type { WidgetSize } from '../../shared/dashboardLayout'
import { Board, Daily, Money } from './widgetChunks'

// Props every widget receives. `editMode` lets a widget stay quiet (no row
// clicks, no "open" links) while the dashboard is being rearranged, so a click
// on a card can never start a drag into the wrong place.
export interface WidgetProps {
  editMode: boolean
  onNavigate: (where: string) => void
  onOpen: (target: import('./lib/navigation').OpenTarget) => void
}

export interface WidgetDef {
  id: string
  title: string
  sizes: WidgetSize[]
  module?: string
  component: ComponentType<WidgetProps>
  keywords: string[]
}

// The three widget modules are loaded lazily: the Dashboard imports the
// registry below, which uses React.lazy, so each widget's code (and its
// module's helpers) arrives with its first render. The `lazy(() => import())`
// calls live in their own small module (./widgetChunks.ts), because a lazy
// component must resolve to a component, not to a module's exports.

export const WIDGETS: WidgetDef[] = [
  // ---- the tiles ----
  {
    id: 'saved', title: 'Total saved', sizes: ['s', 'm'], module: 'savings',
    component: Board.SavedWidget, keywords: ['savings', 'saved', 'balance', 'money']
  },
  {
    id: 'trades-pnl', title: 'Trading P&L', sizes: ['s', 'm'], module: 'trades',
    component: Board.TradesPnlWidget, keywords: ['trades', 'profit', 'loss', 'p&l']
  },
  {
    id: 'trades-count', title: 'Trades logged', sizes: ['s', 'm'], module: 'trades',
    component: Board.TradesCountWidget, keywords: ['trades', 'open', 'closed', 'count']
  },
  {
    id: 'log-streak', title: 'Logbook streak', sizes: ['s', 'm'], module: 'logbook',
    component: Board.LogStreakWidget, keywords: ['journal', 'streak', 'logbook', 'writing']
  },

  // ---- Money ----
  { id: 'left-to-spend', title: 'Left to spend', sizes: ['m', 'l'], module: 'expenses',
    component: Money.LeftToSpendWidget, keywords: ['expenses', 'budget', 'spending', 'bills'] },
  {
    id: 'spending-month', title: 'This month\'s spending', sizes: ['m', 'l'], module: 'expenses',
    component: Money.SpendingMonthWidget, keywords: ['expenses', 'spending', 'categories', 'month']
  },
  {
    id: 'savings-goals', title: 'Savings progress', sizes: ['m', 'l'], module: 'savings',
    component: Money.SavingsGoalsWidget, keywords: ['savings', 'goals', 'progress']
  },
  {
    id: 'pnl-chart', title: 'P&L over time', sizes: ['m', 'l'], module: 'trades',
    component: Money.PnlChartWidget, keywords: ['trades', 'chart', 'curve', 'equity']
  },
  {
    id: 'recent-trades', title: 'Recent trades', sizes: ['m', 'l'], module: 'trades',
    component: Money.RecentTradesWidget, keywords: ['trades', 'recent', 'latest']
  },

  // ---- Daily ----
  {
    id: 'habits', title: 'Habits today', sizes: ['m', 'l'], module: 'habits',
    component: Daily.HabitsWidget, keywords: ['habits', 'streak', 'today', 'routine']
  },
  { id: 'tasks', title: 'Tasks', sizes: ['m', 'l'], module: 'tasks',
    component: Daily.TasksWidget, keywords: ['tasks', 'todo', 'due', 'overdue'] },
  {
    id: 'focus-today', title: 'Focus today', sizes: ['s', 'm'], module: 'focus',
    component: Daily.FocusWidget, keywords: ['focus', 'pomodoro', 'time', 'minutes']
  },
  {
    id: 'content-next', title: 'Next to publish', sizes: ['m', 'l'], module: 'content',
    component: Daily.ContentWidget, keywords: ['content', 'video', 'publish', 'pipeline']
  },
  {
    id: 'pinned-notes', title: 'Pinned notes', sizes: ['m', 'l'], module: 'notes',
    component: Daily.PinnedNotesWidget, keywords: ['notes', 'pinned', 'ideas']
  },
  {
    id: 'recent-log', title: 'Recent log entries', sizes: ['m', 'l'], module: 'logbook',
    component: Daily.RecentLogWidget, keywords: ['journal', 'logbook', 'entries']
  },
  {
    id: 'briefing-doors', title: 'Daily doors', sizes: ['m', 'l'],
    component: Daily.DoorsWidget, keywords: ['briefing', 'review', 'insights', 'links']
  },
  {
    id: 'pinned-tools', title: 'Pinned tools', sizes: ['m', 'l'], module: 'tools',
    component: Daily.PinnedToolsWidget, keywords: ['tools', 'calculator', 'stopwatch', 'scratchpad', 'snippets']
  }
]

const byId = new Map(WIDGETS.map((w) => [w.id, w]))
export const findWidget = (id: string): WidgetDef | undefined => byId.get(id)
export const hasWidget = (id: string): boolean => byId.has(id)

// The widgets a disabled-module list leaves out, so the add menu never offers
// something that would be skipped on the page itself.
export function widgetAllowed(def: WidgetDef, disabledModules: string[]): boolean {
  return !def.module || !disabledModules.includes(def.module)
}
