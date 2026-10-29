// Turns the two things the palette can offer, tools (tools.ts) and actions (actions.ts), into one list of items.
// This is the only place that knows about both; the palette window itself (components/CommandPalette.tsx) just
// shows whatever items it is given and calls `run` on the one the user picks.
import type { LucideIcon } from 'lucide-react'
import { TOOL_CATEGORIES } from '../../../shared/tools'
import { resolveRecent, type PaletteEntry } from '../../../shared/palette'
import type { ToolDef } from '../tools'
import type { ActionContext, ActionDef } from '../actions'

export interface PaletteItem extends PaletteEntry {
  icon?: LucideIcon
  current?: boolean // the page you are on: marked "Current" so it is clear why opening it does nothing
  run: () => void
}

const categoryName = (id: string): string => TOOL_CATEGORIES.find((c) => c.id === id)?.name ?? id

export const toolItems = (tools: ToolDef[], activeId: string, navigate: (id: string) => void): PaletteItem[] =>
  tools.map((t) => ({
    id: `tool:${t.id}`, title: t.name, group: categoryName(t.category), keywords: t.keywords,
    icon: t.icon, current: t.id === activeId, run: () => navigate(t.id)
  }))

export const actionItems = (actions: ActionDef[], ctx: ActionContext): PaletteItem[] =>
  actions.map((a) => ({
    id: `action:${a.id}`, title: a.title, group: 'Action', keywords: a.keywords ?? [],
    icon: a.icon, run: () => a.run(ctx)
  }))

// The tools the user opened lately (Settings.recentTools, newest first), minus the page they are already on.
export const recentToolItems = (tools: PaletteItem[], recentIds: string[], activeId: string): PaletteItem[] =>
  resolveRecent(recentIds.map((id) => `tool:${id}`), tools, `tool:${activeId}`)
