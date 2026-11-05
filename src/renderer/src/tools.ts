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
import { LayoutDashboard, ClipboardCheck, CalendarDays, BookOpen, CandlestickChart, PiggyBank, CalendarCheck, CheckSquare, Search, Settings as Cog, Brain, Sunrise, Lightbulb, MessageCircleQuestion, Trash2, Receipt, Tags as TagsIcon, StickyNote, Clapperboard, Timer, Wrench, Calculator as CalculatorIcon, type LucideIcon } from 'lucide-react'
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
import { Trash } from './modules/Trash'
import { Search as SearchPage } from './modules/Search'
import { SettingsPage } from './modules/SettingsPage'
import { Intelligence } from './modules/Intelligence'
import { Briefing } from './modules/Briefing'
import { Insights } from './modules/Insights'
import { Assistant } from './modules/Assistant'
import { ExpensesPage } from '../../modules/expenses/ui/ExpensesPage'
import { Notes } from './modules/Notes'
import { TagsPage } from './modules/TagsPage'
import { Content } from './modules/Content'
import { Focus } from './modules/Focus'
import { Tools } from './modules/ToolsHub'
import { CalculatorTool as Calculator } from './modules/Calculator/CalculatorTool'
export { Calculator }
export interface ToolDef extends ToolMeta {
  icon: LucideIcon
  component: ComponentType<ModuleProps>
}

// `shortcut` keeps Ctrl+1..7 exactly where they have always been. New tools normally leave it out.
// `contract` is the Phase 0 module contract: what the module contributes
// beyond its page (search, links, quick capture), so nothing else has to know
// these modules by name. See src/shared/tools.ts.
export const TOOLS: ToolDef[] = [
  { id: 'dashboard', name: 'Dashboard', icon: LayoutDashboard, route: '/dashboard', category: 'overview', shortcut: '1',
    keywords: ['home', 'overview', 'summary', 'today'], component: Dashboard,
    contract: { dashboard: true, insights: true } },
  { id: 'review', name: 'Review', icon: ClipboardCheck, route: '/review', category: 'overview',
    keywords: ['weekly review', 'monthly review', 'summary', 'recap', 'reflection', 'week', 'month', 'progress', 'report'], component: Review,
    contract: { insights: true } },
  { id: 'briefing', name: 'Daily briefing', icon: Sunrise, route: '/briefing', category: 'overview',
    keywords: ['daily briefing', 'today', 'summary', 'morning', 'agenda', 'overview', 'plan', 'brief'], component: Briefing,
    contract: { dashboard: true } },
  { id: 'insights', name: 'Insights', icon: Lightbulb, route: '/insights', category: 'overview',
    keywords: ['insights', 'patterns', 'correlation', 'statistics', 'mood', 'habits', 'weekday', 'trends'], component: Insights,
    contract: { insights: true } },
  { id: 'assistant', name: 'Assistant', icon: MessageCircleQuestion, route: '/assistant', category: 'overview',
    keywords: ['assistant', 'ai', 'ask', 'question', 'chat', 'model', 'llm'], component: Assistant,
    contract: { assistant: true } },
  { id: 'calendar', name: 'Calendar', icon: CalendarDays, route: '/calendar', category: 'overview',
    keywords: ['month', 'schedule', 'agenda', 'day', 'date', 'activity', 'history', 'planner'], component: Calendar,
    contract: { calendar: true, insights: false } },
  { id: 'logbook', name: 'Logbook', icon: BookOpen, route: '/logbook', category: 'notes', shortcut: '2',
    keywords: ['journal', 'diary', 'entries', 'notes', 'mood', 'log'], component: Logbook,
    contract: { search: { type: 'logbook', textFields: ['title', 'body', 'tags', 'date'], supportsTags: true },
      linkable: { type: 'logbook', label: 'Journal entry' }, quickCapture: ['note'], calendar: true, insights: true } },
  { id: 'trades', name: 'Trades', icon: CandlestickChart, route: '/trades', category: 'money', shortcut: '3',
    keywords: ['trade tracker', 'trading', 'p&l', 'profit', 'loss', 'gold', 'xauusd', 'positions'], component: Trades,
    contract: { search: { type: 'trade', textFields: ['asset', 'notes', 'tags', 'date', 'direction'], supportsTags: true },
      linkable: { type: 'trade', label: 'Trade' }, quickCapture: ['trade'], calendar: true, insights: true } },
  { id: 'savings', name: 'Savings', icon: PiggyBank, route: '/savings', category: 'money', shortcut: '4',
    keywords: ['savings tracker', 'goals', 'money', 'balance', 'deposit', 'withdrawal'], component: Savings,
    contract: { search: { type: 'goal', textFields: ['name', 'notes'], supportsTags: false },
      linkable: { type: 'goal', label: 'Savings goal' }, quickCapture: ['deposit'], calendar: true, insights: true } },
  { id: 'expenses', name: 'Expenses', icon: Receipt, route: '/expenses', category: 'money',
    keywords: ['expenses', 'budget', 'spending', 'bills', 'subscriptions', 'receipts', 'transactions', 'income'], component: ExpensesPage,
    contract: {
      search: { type: 'expense_tx', textFields: ['payee', 'note', 'tags', 'date', 'type'], supportsTags: true },
      calendar: true,
      insights: true,
      dashboard: true
    } },
  { id: 'habits', name: 'Habits', icon: CalendarCheck, route: '/habits', category: 'productivity', shortcut: '5',
    keywords: ['habit tracker', 'streak', 'routine', 'daily', 'check-in'], component: Habits,
    contract: { quickCapture: ['habit'], insights: true } },
  { id: 'tasks', name: 'Tasks', icon: CheckSquare, route: '/tasks', category: 'productivity',
    keywords: ['task manager', 'todo', 'to do', 'checklist', 'planner', 'today', 'upcoming'], component: Tasks,
    contract: { search: { type: 'task', textFields: ['title', 'notes', 'project', 'tags'], supportsTags: true },
      linkable: { type: 'task', label: 'Task' }, quickCapture: ['task'], insights: true } },
  { id: 'focus', name: 'Focus', icon: Timer, route: '/focus', category: 'productivity',
    keywords: ['focus', 'pomodoro', 'timer', 'time tracking', 'deep work', 'break', 'sessions', 'stopwatch'], component: Focus,
    contract: {
      search: { type: 'time_session', textFields: ['project_name', 'note', 'type'], supportsTags: false },
      dashboard: true,
      insights: true,
      assistant: true,
      calendar: true
    } },
  { id: 'tools', name: 'Tools', icon: Wrench, route: '/tools', category: 'utilities',
    keywords: ['tools', 'loan', 'mortgage', 'percentage', 'stopwatch', 'scratchpad', 'snippet', 'date calculator', 'tip'], component: Tools,
    contract: {
      search: { type: 'snippet', textFields: ['title', 'body', 'tags'], supportsTags: true },
      dashboard: true
    } },
  { id: 'calculator', name: 'Calculator', icon: CalculatorIcon, route: '/calculator', category: 'utilities',
    keywords: ['calculator', 'calc', 'math', 'scientific', 'trig', 'angles', 'expressions', 'precision', 'solve'], component: Calculator },
  { id: 'content', name: 'Content', icon: Clapperboard, route: '/content', category: 'productivity',
    keywords: ['content', 'video', 'youtube', 'stream', 'shorts', 'pipeline', 'publish', 'ideas', 'script'], component: Content,
    contract: { search: { type: 'content', textFields: ['title', 'hook', 'platform', 'series', 'tags'], supportsTags: true },
      linkable: { type: 'content', label: 'Content item' }, calendar: true, insights: true } },
  { id: 'intelligence', name: 'Intelligence', icon: Brain, route: '/intelligence', category: 'productivity',
    keywords: ['intelligence', 'ai', 'settings', 'features', 'daily briefing', 'automations', 'smart', 'insights'], component: Intelligence,
    contract: { insights: true } },
  { id: 'notes', name: 'Notes', icon: StickyNote, route: '/notes', category: 'notes',
    keywords: ['notes', 'markdown', 'memo', 'wiki', 'idea', 'meeting', 'checklist', 'reference'], component: Notes,
    contract: { search: { type: 'note', textFields: ['title', 'body', 'tags'], supportsTags: true },
      linkable: { type: 'note', label: 'Note' }, insights: true } },
  { id: 'tags', name: 'Tags', icon: TagsIcon, route: '/tags', category: 'utilities',
    keywords: ['tags', 'labels', 'organise', 'merge', 'rename', 'colour'], component: TagsPage },
  { id: 'search', name: 'Search', icon: Search, route: '/search', category: 'utilities', shortcut: '6',
    keywords: ['find', 'lookup', 'everything'], component: SearchPage },
  { id: 'trash', name: 'Trash', icon: Trash2, route: '/trash', category: 'utilities',
    keywords: ['trash', 'deleted', 'undo', 'restore', 'bin', 'recycle'], component: Trash },
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
