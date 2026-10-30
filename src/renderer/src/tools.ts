// THE tool registry. Every tool in the app is defined here, once. The sidebar, the page router,
// the keyboard shortcuts and the Settings shortcut list all read this list and nothing else.
//
// To add a tool: create its page component, then add ONE entry to TOOLS below. Example:
//
//   { id: 'notes', name: 'Notes', icon: StickyNote, route: '/notes', category: 'notes',
//     keywords: ['note', 'memo', 'text'], component: Notes },
//
// Order matters: tools are listed in this order inside their category, and the FIRST tool is the start page.
// Optional: `footer: true` keeps a tool at the bottom of the sidebar (users cannot pin or unpin it).
import type { ComponentType } from 'react'
import { LayoutDashboard, ClipboardCheck, CalendarDays, BookOpen, CandlestickChart, PiggyBank, CalendarCheck, CheckSquare, Search, Settings as Cog, type LucideIcon } from 'lucide-react'
import { validateTools, type ToolMeta } from '../../shared/tools'
import type { ModuleProps } from './lib/navigation'
import { Dashboard } from './modules/Dashboard'
import { Review } from './modules/Review'
import { Calendar } from './modules/Calendar'
import { Logbook } from './modules/Logbook'
import { Trades } from './modules/Trades'
import { Savings } from './modules/Savings'
import { Habits } from './modules/Habits'
import { Tasks } from './modules/Tasks'
import { Search as SearchPage } from './modules/Search'
import { SettingsPage } from './modules/SettingsPage'

export interface ToolDef extends ToolMeta {
  icon: LucideIcon
  component: ComponentType<ModuleProps>
}

// `shortcut` keeps Ctrl+1..7 exactly where they have always been. New tools normally leave it out.
export const TOOLS: ToolDef[] = [
  { id: 'dashboard', name: 'Dashboard', icon: LayoutDashboard, route: '/dashboard', category: 'overview', shortcut: '1',
    keywords: ['home', 'overview', 'summary', 'today'], component: Dashboard },
  { id: 'review', name: 'Review', icon: ClipboardCheck, route: '/review', category: 'overview',
    keywords: ['weekly review', 'monthly review', 'summary', 'recap', 'reflection', 'week', 'month', 'progress', 'report'], component: Review },
  { id: 'calendar', name: 'Calendar', icon: CalendarDays, route: '/calendar', category: 'overview',
    keywords: ['month', 'schedule', 'agenda', 'day', 'date', 'activity', 'history', 'planner'], component: Calendar },
  { id: 'logbook', name: 'Logbook', icon: BookOpen, route: '/logbook', category: 'notes', shortcut: '2',
    keywords: ['journal', 'diary', 'entries', 'notes', 'mood', 'log'], component: Logbook },
  { id: 'trades', name: 'Trades', icon: CandlestickChart, route: '/trades', category: 'money', shortcut: '3',
    keywords: ['trade tracker', 'trading', 'p&l', 'profit', 'loss', 'gold', 'xauusd', 'positions'], component: Trades },
  { id: 'savings', name: 'Savings', icon: PiggyBank, route: '/savings', category: 'money', shortcut: '4',
    keywords: ['savings tracker', 'goals', 'money', 'balance', 'deposit', 'withdrawal'], component: Savings },
  { id: 'habits', name: 'Habits', icon: CalendarCheck, route: '/habits', category: 'productivity', shortcut: '5',
    keywords: ['habit tracker', 'streak', 'routine', 'daily', 'check-in'], component: Habits },
  { id: 'tasks', name: 'Tasks', icon: CheckSquare, route: '/tasks', category: 'productivity',
    keywords: ['task manager', 'todo', 'to do', 'checklist', 'planner', 'today', 'upcoming'], component: Tasks },
  { id: 'search', name: 'Search', icon: Search, route: '/search', category: 'utilities', shortcut: '6',
    keywords: ['find', 'lookup', 'everything'], component: SearchPage },
  { id: 'settings', name: 'Settings', icon: Cog, route: '/settings', category: 'utilities', shortcut: '7', footer: true,
    keywords: ['appearance', 'theme', 'colour', 'backup', 'export', 'import', 'tags', 'preferences'], component: SettingsPage }
]

// A mistake in an entry stops the app at start-up with a readable message (see shared/tools.ts for the rules).
const problems = validateTools(TOOLS)
if (problems.length > 0) throw new Error(`tools.ts has a mistake:\n- ${problems.join('\n- ')}`)

export const START_TOOL: ToolDef = TOOLS[0]

// Finds a tool by id ("trades") or route ("/trades"). Undefined when there is no such tool.
export const findTool = (idOrRoute: string): ToolDef | undefined =>
  TOOLS.find((t) => t.id === idOrRoute || t.route === idOrRoute)

// The tool that Ctrl+<digit> opens.
export const toolByShortcut = (key: string): ToolDef | undefined =>
  TOOLS.find((t) => t.shortcut !== undefined && t.shortcut === key)
