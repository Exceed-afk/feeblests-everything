// The customizable Dashboard (Phase 6): layout rules as plain data and pure
// functions, so every rule can be checked by a test and nothing React-specific
// lives here.
//
// A layout is an ORDERED list of placed widgets on a 12-column grid. There is
// no free-form drag-resize in v1: a widget picks one of its preset sizes
// (S, M, L) and the grid places it next to its neighbours, wrapping when the
// row is full.
//
// The registry of widgets themselves (id, title, sizes, loader) is the
// renderer's (src/renderer/src/widgets.ts), because each one needs React and
// the module's own API. This file only knows the sizes and the placement
// arithmetic, which is the part worth testing.

export const WIDGET_SIZES = ['s', 'm', 'l'] as const
export type WidgetSize = (typeof WIDGET_SIZES)[number]

// Columns each preset size takes on the 12-column grid.
// S = 3 (1/4 width: 4 per row), M = 6 (1/2 width: 2 per row), L = 12 (full width).
// Using clean divisors of 12 ensures rows are always balanced without awkward orphan gaps.
export const WIDGET_COLUMNS: Record<WidgetSize, number> = { s: 3, m: 6, l: 12 }
export const GRID_COLUMNS = 12

export const WIDGET_SIZE_LABELS: Record<WidgetSize, string> = { s: 'Small', m: 'Medium', l: 'Large' }

export interface PlacedWidget {
  // The widget registry id ("trades-pnl", "savings-goals", ...).
  id: string
  size: WidgetSize
}

export type DashboardPreset = 'default' | 'minimal' | 'money' | 'daily'

export const DASHBOARD_PRESETS: { id: DashboardPreset; name: string; hint: string }[] = [
  { id: 'default', name: 'Reset to default', hint: 'The arrangement the app ships with.' },
  { id: 'minimal', name: 'Minimal', hint: 'Just today: habits, tasks and what is left to spend.' },
  { id: 'money', name: 'Money focus', hint: 'Savings, trading and spending first.' },
  { id: 'daily', name: 'Daily', hint: 'Today at a glance: habits, focus, notes and content.' }
]

// The shipped arrangement. Every row packs completely on a 12-column grid:
// Row 1: 4 stat tiles (3+3+3+3 = 12)
// Row 2: Tasks & Habits (6+6 = 12)
// Row 3: Savings goals & P&L chart (6+6 = 12)
// Row 4: Recent log & Recent trades (6+6 = 12)
// Row 5: Daily doors full width (12)
export const DEFAULT_LAYOUT: PlacedWidget[] = [
  { id: 'saved', size: 's' },
  { id: 'trades-pnl', size: 's' },
  { id: 'trades-count', size: 's' },
  { id: 'log-streak', size: 's' },
  { id: 'tasks', size: 'm' },
  { id: 'habits', size: 'm' },
  { id: 'savings-goals', size: 'm' },
  { id: 'pnl-chart', size: 'm' },
  { id: 'recent-log', size: 'm' },
  { id: 'recent-trades', size: 'm' },
  { id: 'briefing-doors', size: 'l' }
]

export const LAYOUT_PRESETS: Record<DashboardPreset, PlacedWidget[]> = {
  default: DEFAULT_LAYOUT,
  minimal: [
    { id: 'habits', size: 'm' },
    { id: 'tasks', size: 'm' },
    { id: 'left-to-spend', size: 'm' },
    { id: 'saved', size: 's' },
    { id: 'log-streak', size: 's' }
  ],
  money: [
    { id: 'left-to-spend', size: 'm' },
    { id: 'saved', size: 's' },
    { id: 'trades-pnl', size: 's' },
    { id: 'savings-goals', size: 'm' },
    { id: 'pnl-chart', size: 'm' },
    { id: 'recent-trades', size: 'm' },
    { id: 'spending-month', size: 'm' }
  ],
  daily: [
    { id: 'habits', size: 'm' },
    { id: 'tasks', size: 'm' },
    { id: 'focus-today', size: 's' },
    { id: 'saved', size: 's' },
    { id: 'left-to-spend', size: 'm' },
    { id: 'pinned-notes', size: 'm' },
    { id: 'content-next', size: 'm' },
    { id: 'recent-log', size: 'l' }
  ]
}

// How many widgets a preset adds at most. A guard so a hand-edited settings
// value cannot make the page render thousands of cells.
const MAX_WIDGETS = 40

// A widget may appear at most once: two copies of the same loader would show
// the same numbers twice and share one React key. Sizes must be a known preset,
// otherwise the widget falls back to the middle one.
export function sanitizeLayout(value: unknown): PlacedWidget[] {
  if (!Array.isArray(value)) return []
  const seen = new Set<string>()
  const out: PlacedWidget[] = []
  for (const item of value) {
    if (!item || typeof item !== 'object') continue
    const raw = item as { id?: unknown; size?: unknown }
    if (typeof raw.id !== 'string' || !/^[a-z][a-z0-9-]*$/.test(raw.id)) continue
    if (seen.has(raw.id)) continue
    seen.add(raw.id)
    out.push({ id: raw.id, size: (WIDGET_SIZES as readonly string[]).includes(raw.size as string) ? (raw.size as WidgetSize) : 'm' })
    if (out.length >= MAX_WIDGETS) break
  }
  return out
}

// Settings hold the layout as JSON text (one settings row, so it survives a
// backup like every other choice). Anything unreadable means "use the default".
export function parseLayout(json: unknown): PlacedWidget[] | null {
  if (typeof json !== 'string' || !json.trim()) return null
  try { return sanitizeLayout(JSON.parse(json)) } catch { return null }
}

export const serializeLayout = (layout: PlacedWidget[]): string => JSON.stringify(sanitizeLayout(layout))

// Removes widgets the app no longer offers (a module switched off, or a widget
// that was removed in an update) and any duplicate. Used at render time, so a
// stored layout never has to be rewritten just because a module is off.
export function resolveLayout(layout: PlacedWidget[], isKnown: (id: string) => boolean): PlacedWidget[] {
  return sanitizeLayout(layout).filter((w) => isKnown(w.id))
}

// The sizes a widget offers, narrowed to the ones the user may pick: a widget
// placed at a size it no longer offers keeps the nearest allowed one.
export function normaliseSize(size: WidgetSize, allowed: WidgetSize[]): WidgetSize {
  if (allowed.includes(size)) return size
  const order: WidgetSize[] = ['m', 'l', 's']
  return order.find((s) => allowed.includes(s)) ?? allowed[0] ?? 'm'
}

// Moves one widget to a new index. Out-of-range targets clamp to the ends, and
// an unknown id changes nothing, so keyboard "move up/down" can be called freely.
export function moveWidget(layout: PlacedWidget[], id: string, toIndex: number): PlacedWidget[] {
  const from = layout.findIndex((w) => w.id === id)
  if (from < 0) return layout
  const to = Math.max(0, Math.min(layout.length - 1, toIndex))
  if (to === from) return layout
  const next = [...layout]
  const [item] = next.splice(from, 1)
  next.splice(to, 0, item)
  return next
}

export const moveWidgetBy = (layout: PlacedWidget[], id: string, delta: number): PlacedWidget[] =>
  moveWidget(layout, id, layout.findIndex((w) => w.id === id) + delta)

export function removeWidget(layout: PlacedWidget[], id: string): PlacedWidget[] {
  return layout.filter((w) => w.id !== id)
}

// Appends a widget. Adding one already placed changes nothing: there is one of each.
export function addWidget(layout: PlacedWidget[], id: string, size: WidgetSize = 'm'): PlacedWidget[] {
  if (layout.some((w) => w.id === id)) return layout
  return sanitizeLayout([...layout, { id, size }])
}

export function setWidgetSize(layout: PlacedWidget[], id: string, size: WidgetSize): PlacedWidget[] {
  return layout.map((w) => (w.id === id ? { ...w, size } : w))
}

// A widget's row inside the grid, worked out from its order.
// `columns` is the number of grid columns in use (12, 6, 4 or 1), so the layout
// adapts predictably to any window size without awkward partial spans or broken wraps.
export interface WidgetSlot extends PlacedWidget {
  columns: number // how many of the grid's columns this widget spans
  offset: number // which column it starts at (0-based)
  row: number // which row of the grid it lands on (0-based)
}

/**
 * Maps preset sizes to responsive column spans based on available grid columns:
 * - 12 columns (desktop): S = 3 (1/4), M = 4 or 6, L = 6 (1/2) or 12
 * - 6 columns (compact / split): S = 3 (1/2), M = 6 (full), L = 6 (full)
 * - 4 columns (tablet / narrow): S = 2 (1/2), M = 4 (full), L = 4 (full)
 * - 1 column (mobile / phone): all = 1 (stacked full width)
 */
export function getSpanForSize(size: WidgetSize, totalColumns: number): number {
  if (totalColumns <= 1) return 1
  if (totalColumns === 6) {
    // On 6-column grid (compact / half-window):
    // Small tiles take 3 columns (half width -> 2 per row)
    // Medium and Large take full width (6 columns)
    return size === 's' ? 3 : 6
  }
  // Default 12 columns: S = 3, M = 6, L = 12
  return WIDGET_COLUMNS[size] ?? 6
}

export function placeWidgets(layout: PlacedWidget[], columns: number = GRID_COLUMNS): WidgetSlot[] {
  const total = Math.max(1, Math.min(GRID_COLUMNS, Math.floor(columns)))
  let offset = 0
  let row = 0
  return layout.map((w) => {
    const span = Math.min(getSpanForSize(w.size, total), total)
    if (offset > 0 && offset + span > total) { offset = 0; row++ }
    const slot: WidgetSlot = { ...w, columns: span, offset, row }
    offset += span
    if (offset >= total) { offset = 0; row++ }
    return slot
  })
}

// The widgets still available to add (registry order), given what is placed.
export function availableWidgets<T extends { id: string }>(registry: T[], layout: PlacedWidget[]): T[] {
  const taken = new Set(layout.map((w) => w.id))
  return registry.filter((w) => !taken.has(w.id))
}
