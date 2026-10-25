// Tag colours: one shared lookup so every page draws a tag the same way.
// Saved in Settings as { tagName: "#rrggbb" }. A tag with no colour uses the accent colour.
import { useSyncExternalStore } from 'react'

export const TAG_PALETTE = [
  { name: 'Violet', hex: '#8b5cf6' }, { name: 'Blue', hex: '#3b82f6' }, { name: 'Sky', hex: '#0ea5e9' },
  { name: 'Teal', hex: '#14b8a6' }, { name: 'Green', hex: '#22c55e' }, { name: 'Amber', hex: '#f59e0b' },
  { name: 'Orange', hex: '#f97316' }, { name: 'Rose', hex: '#f43f5e' }, { name: 'Pink', hex: '#ec4899' },
  { name: 'Slate', hex: '#64748b' }
]

type Colors = Record<string, string>
let colors: Colors = {}
const listeners = new Set<() => void>()

// Ignore anything that is not a plain #rrggbb (e.g. from an edited backup file).
const clean = (c: unknown): Colors => {
  const out: Colors = {}
  if (c && typeof c === 'object') {
    for (const [k, v] of Object.entries(c)) if (typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v)) out[k] = v
  }
  return out
}

// Replaces the colours (used at startup, and after a change in Settings).
export function setTagColors(next: unknown): void {
  colors = clean(next)
  listeners.forEach((l) => l())
}

export const useTagColors = (): Colors =>
  useSyncExternalStore((cb) => { listeners.add(cb); return () => { listeners.delete(cb) } }, () => colors, () => colors)

// Chip styling for one tag. Text is blended with the page text colour so it stays readable in light and dark.
export function tagStyle(hex: string | undefined): { backgroundColor?: string; color?: string } {
  if (!hex) return {}
  return { backgroundColor: `${hex}26`, color: `color-mix(in srgb, ${hex} 65%, rgb(var(--fg)))` }
}
