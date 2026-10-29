// What every tool must declare, without anything React-specific, so the rules can be checked
// in a plain test. The renderer's registry (src/renderer/src/tools.ts) adds the icon and the page.

// Tool groups, in the order the sidebar shows them. A new tool picks one of these; a new group is one line here.
// A group with `flat: true` has no heading and cannot be collapsed (used for the start page on its own).
// A group that has no tools yet (Health) is simply not shown until one arrives.
export const TOOL_CATEGORIES = [
  { id: 'overview', name: 'Overview', flat: true },
  { id: 'money', name: 'Money', flat: false },
  { id: 'health', name: 'Health', flat: false },
  { id: 'productivity', name: 'Productivity', flat: false },
  { id: 'notes', name: 'Notes', flat: false },
  { id: 'utilities', name: 'Utilities', flat: false }
] as const
export type ToolCategory = (typeof TOOL_CATEGORIES)[number]['id']

export interface ToolMeta {
  id: string // short and lowercase, e.g. "trades". Used in code ("go to trades").
  name: string // shown in the sidebar
  route: string // "/trades". Another way to name the same place (see findTool).
  category: ToolCategory
  keywords: string[] // lowercase words that should find this tool in search
  shortcut?: string // "1" to "9": Ctrl+<digit> opens it. Leave out for most tools.
  footer?: boolean // sits at the bottom of the sidebar, always visible, and cannot be pinned (Settings)
}

// Returns a list of mistakes (empty = fine), so a typo in one entry gives a clear message
// instead of a blank screen or a shortcut that quietly opens the wrong page.
export function validateTools(tools: ToolMeta[]): string[] {
  const problems: string[] = []
  if (tools.length === 0) problems.push('The registry is empty.')
  const seen = { id: new Set<string>(), route: new Set<string>(), shortcut: new Set<string>() }
  const categories = new Set<string>(TOOL_CATEGORIES.map((c) => c.id))
  const once = (kind: 'id' | 'route' | 'shortcut', value: string, who: string) => {
    if (seen[kind].has(value)) problems.push(`${who}: the ${kind} "${value}" is already used by another tool.`)
    seen[kind].add(value)
  }
  tools.forEach((t, i) => {
    const who = `Tool #${i + 1} (${t.id || 'no id'})`
    if (!/^[a-z][a-z0-9-]*$/.test(t.id)) problems.push(`${who}: the id must be lowercase letters, digits and dashes, starting with a letter.`)
    else once('id', t.id, who)
    if (!t.name.trim()) problems.push(`${who}: the name is empty.`)
    if (!/^\/[a-z][a-z0-9-]*$/.test(t.route)) problems.push(`${who}: the route must look like "/trades".`)
    else once('route', t.route, who)
    if (!categories.has(t.category)) problems.push(`${who}: unknown category "${t.category}".`)
    if (t.keywords.some((k) => !k.trim() || k !== k.trim().toLowerCase())) problems.push(`${who}: keywords must be non-empty and lowercase.`)
    if (t.shortcut !== undefined) {
      if (!/^[1-9]$/.test(t.shortcut)) problems.push(`${who}: the shortcut must be a single digit from 1 to 9.`)
      else once('shortcut', t.shortcut, who)
    }
  })
  if (tools[0]?.footer) problems.push('The first tool is the start page and cannot be a footer tool.')
  return problems
}

// ---------- Sidebar layout (pure, so it can be tested) ----------

export interface SidebarGroup<T> { id: ToolCategory; name: string; flat: boolean; tools: T[] }
export interface SidebarLayout<T> { pinned: T[]; groups: SidebarGroup<T>[]; footer: T[] }

// Works out what the sidebar shows:
//  - pinned: the user's pinned tools in the order they were pinned (unknown ids and footer tools are ignored)
//  - groups: every other tool under its category, in category order, skipping empty groups
//  - footer: the tools that always sit at the bottom
// A pinned tool is shown only in "Pinned", not twice, so the current page is marked in one place.
export function sidebarLayout<T extends ToolMeta>(tools: T[], pinnedIds: string[]): SidebarLayout<T> {
  const footer = tools.filter((t) => t.footer)
  const body = tools.filter((t) => !t.footer)
  const byId = new Map(body.map((t) => [t.id, t]))
  const pinned = [...new Set(pinnedIds)].map((id) => byId.get(id)).filter((t): t is T => t !== undefined)
  const taken = new Set(pinned.map((t) => t.id))
  const groups = TOOL_CATEGORIES
    .map((c) => ({ id: c.id, name: c.name, flat: c.flat, tools: body.filter((t) => t.category === c.id && !taken.has(t.id)) }))
    .filter((g) => g.tools.length > 0)
  return { pinned, groups, footer }
}

// Adds the id to the list, or removes it when it is already there (pin / unpin, close / open a group).
export const toggleId = (list: string[], id: string): string[] =>
  list.includes(id) ? list.filter((x) => x !== id) : [...list, id]
