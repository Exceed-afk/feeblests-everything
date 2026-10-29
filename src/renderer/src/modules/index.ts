// The module registry. To add a feature (habit tracker, notes...):
//  1. create a page component, 2. add one line below. The sidebar,
//  keyboard shortcut and routing update automatically.
import type { ComponentType } from 'react'
import type { LucideIcon } from 'lucide-react'
import { LayoutDashboard, BookOpen, CandlestickChart, PiggyBank, CalendarCheck, Search, Settings as Cog } from 'lucide-react'
import { Dashboard } from './Dashboard'
import { Logbook } from './Logbook'
import { Trades } from './Trades'
import { Savings } from './Savings'
import { Habits } from './Habits'
import { Search as SearchPage } from './Search'
import { SettingsPage } from './SettingsPage'
import type { ModuleProps } from '../lib/navigation'

export interface AppModule {
  id: string
  label: string
  icon: LucideIcon
  page: ComponentType<ModuleProps>
  pinned?: boolean // shown at the bottom of the sidebar (Settings)
}

export const MODULES: AppModule[] = [
  { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard, page: Dashboard },
  { id: 'logbook', label: 'Logbook', icon: BookOpen, page: Logbook },
  { id: 'trades', label: 'Trades', icon: CandlestickChart, page: Trades },
  { id: 'savings', label: 'Savings', icon: PiggyBank, page: Savings },
  { id: 'habits', label: 'Habits', icon: CalendarCheck, page: Habits },
  { id: 'search', label: 'Search', icon: Search, page: SearchPage },
  { id: 'settings', label: 'Settings', icon: Cog, page: SettingsPage, pinned: true }
]
