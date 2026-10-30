// Everything about how the app looks, as plain functions with no DOM access, so the
// window code (main) and the page code (renderer) share one source of truth.
//
//   Settings  ->  normalizeSettings()  ->  appearanceVars()  ->  CSS variables on <html>
//
// To add a colour scheme: add one entry to PALETTES (a light and a dark set). Nothing else to change.
import {
  DEFAULT_SETTINGS,
  type ColorOverrides, type Density, type FontChoice, type Radius, type Settings, type TaskLayout, type TextSize, type ThemeMode, type UiStyle
} from './types'
import { MAX_RECENT_TOOLS } from './palette'

// ---------- colour maths ----------

export type RGB = [number, number, number]

export const isHex = (v: unknown): v is string => typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v)
export const hexToRgb = (hex: string): RGB => {
  const n = parseInt(hex.slice(1), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}
export const rgbToHex = (c: RGB): string => '#' + c.map((x) => x.toString(16).padStart(2, '0')).join('')
const triple = (c: RGB): string => c.join(' ') // "R G B", so Tailwind can add opacity (bg-accent/20)

// t = 0 gives a, t = 1 gives b.
export const mix = (a: RGB, b: RGB, t: number): RGB => a.map((x, i) => Math.round(x + (b[i] - x) * t)) as RGB

const channel = (v: number): number => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4 }
const luminance = (c: RGB): number => 0.2126 * channel(c[0]) + 0.7152 * channel(c[1]) + 0.0722 * channel(c[2])

// WCAG contrast ratio, 1 (none) to 21 (black on white). Body text should reach 4.5.
export function contrast(a: RGB, b: RGB): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}

// Moves `color` toward `target` in small steps until it reaches `min` contrast against every colour in `against`.
function ensureContrast(color: RGB, against: RGB[], min: number, target: RGB): RGB {
  let out = color
  for (let t = 0; t <= 1.0001; t += 0.05) {
    out = mix(color, target, Math.min(t, 1))
    if (against.every((a) => contrast(out, a) >= min)) return out
  }
  return out
}

const WHITE: RGB = [255, 255, 255]
const INK: RGB = [15, 17, 23]

// Text colour for buttons filled with the accent: white, unless the accent is too light for it (amber, emerald).
export const onAccent = (accent: RGB): RGB => (contrast(WHITE, accent) >= 3.5 ? WHITE : INK)

// The accent as *text* (sidebar highlight, tag chips): darkened or lightened until it can be read on the page.
export function accentText(accent: RGB, t: Tokens): RGB {
  const bg = hexToRgb(t.bg), panel = hexToRgb(t.panel), card = hexToRgb(t.card), fg = hexToRgb(t.fg)
  const tinted = mix(panel, accent, 0.15) // the highlighted sidebar item
  const pickedRow = mix(card, accent, 0.14) // the selected command palette row (modern style)
  const pickedRowMinimal = mix(card, fg, 0.07) // ...and in the classic minimal style, where it is a grey tint (lighter than the card in dark mode)
  return ensureContrast(accent, [bg, panel, card, tinted, pickedRow, pickedRowMinimal], 4.5, fg)
}

// ---------- colour schemes ----------

export interface Tokens { bg: string; panel: string; card: string; line: string; fg: string; muted: string } // #rrggbb
export interface Palette { id: string; name: string; light: Tokens; dark: Tokens }

// bg = page, panel = sidebar, card = raised surfaces, line = borders, fg = text, muted = secondary text.
export const PALETTES: Palette[] = [
  { id: 'default', name: 'Default',
    light: { bg: '#f4f5f8', panel: '#ffffff', card: '#ffffff', line: '#e2e5ec', fg: '#181c26', muted: '#687080' },
    dark: { bg: '#0f1117', panel: '#14171f', card: '#1a1e28', line: '#2a2f3d', fg: '#e8ebf3', muted: '#8c94a6' } },
  { id: 'midnight', name: 'Midnight',
    light: { bg: '#eef2fa', panel: '#ffffff', card: '#ffffff', line: '#d9e0ef', fg: '#121a2e', muted: '#5a6784' },
    dark: { bg: '#0b1020', panel: '#0f1629', card: '#141c33', line: '#25304f', fg: '#e6ebf7', muted: '#93a0bd' } },
  { id: 'paper', name: 'Paper',
    light: { bg: '#f6f1e7', panel: '#fbf8f1', card: '#fffdf8', line: '#e3dac8', fg: '#2b2620', muted: '#6f6455' },
    dark: { bg: '#1a1714', panel: '#201c18', card: '#27221d', line: '#3a342c', fg: '#ece4d6', muted: '#a39786' } },
  { id: 'forest', name: 'Forest',
    light: { bg: '#eff5f1', panel: '#ffffff', card: '#ffffff', line: '#d5e3da', fg: '#14211b', muted: '#56695f' },
    dark: { bg: '#0d1512', panel: '#111c18', card: '#172420', line: '#26382f', fg: '#e4efe9', muted: '#8ca59a' } },
  { id: 'frost', name: 'Frost',
    light: { bg: '#eceff4', panel: '#f7f8fb', card: '#ffffff', line: '#d8dee9', fg: '#2e3440', muted: '#586378' },
    dark: { bg: '#2a303c', panel: '#252b36', card: '#323947', line: '#434c5e', fg: '#eceff4', muted: '#a8b1c4' } },
  { id: 'graphite', name: 'Graphite',
    light: { bg: '#f3f3f4', panel: '#ffffff', card: '#ffffff', line: '#e2e2e4', fg: '#111111', muted: '#636363' },
    dark: { bg: '#0a0a0a', panel: '#111111', card: '#161616', line: '#2a2a2a', fg: '#ededed', muted: '#9a9a9a' } }
]

export const OVERRIDE_KEYS = ['bg', 'panel', 'card', 'fg'] as const

// The six colours in use: the palette's own, with the user's hand-picked ones on top.
// Borders and secondary text are re-derived from the final background and text, so they always fit.
export function resolveTokens(s: Pick<Settings, 'palette' | 'colors'>, dark: boolean): Tokens {
  const pal = PALETTES.find((p) => p.id === s.palette) ?? PALETTES[0]
  const t: Tokens = { ...(dark ? pal.dark : pal.light) }
  const picked = s.colors?.[dark ? 'dark' : 'light'] ?? {}
  let changed = false
  for (const k of OVERRIDE_KEYS) if (isHex(picked[k])) { t[k] = picked[k]!; changed = true }
  if (changed) {
    const bg = hexToRgb(t.bg), fg = hexToRgb(t.fg)
    t.line = rgbToHex(mix(bg, fg, dark ? 0.16 : 0.12))
    t.muted = rgbToHex(ensureContrast(mix(fg, bg, 0.4), [bg, hexToRgb(t.panel), hexToRgb(t.card)], 4.5, fg))
  }
  return t
}

// ---------- shape, spacing, type ----------

// Multipliers: radius scales every rounded-* corner, density every padding/margin/gap (see tailwind.config.js).
export const RADIUS_SCALE: Record<Radius, number> = { sharp: 0.2, soft: 1, round: 1.7 }
export const DENSITY_SCALE: Record<Density, number> = { compact: 0.8, comfortable: 1, spacious: 1.2 }
export const TEXT_SCALE: Record<TextSize, number> = { small: 0.9, default: 1, large: 1.12 }
// System fonts only: the page may not load anything from the internet (see the CSP in index.html).
export const FONT_STACKS: Record<FontChoice, string> = {
  system: '"Segoe UI Variable", "Segoe UI", system-ui, sans-serif',
  clean: '"Helvetica Neue", Arial, "Segoe UI", sans-serif',
  serif: 'Cambria, "Iowan Old Style", "Palatino Linotype", Georgia, serif',
  mono: '"Cascadia Mono", "Cascadia Code", Consolas, "Courier New", monospace'
}

// What picking a style also sets, so one click gives the whole look (each can then be fine-tuned).
export const STYLE_PRESETS: Record<UiStyle, Pick<Settings, 'radius' | 'density'>> = {
  modern: { radius: 'soft', density: 'comfortable' },
  minimal: { radius: 'sharp', density: 'compact' }
}

// ---------- validation ----------

const pick = <T extends string>(v: unknown, allowed: readonly T[], fallback: T): T => (allowed.includes(v as T) ? (v as T) : fallback)
const cleanOverrides = (v: unknown): ColorOverrides => {
  const out: ColorOverrides = {}
  if (v && typeof v === 'object') for (const k of OVERRIDE_KEYS) { const c = (v as Record<string, unknown>)[k]; if (isHex(c)) out[k] = c }
  return out
}

// A list of tool or group ids from the saved settings: only well-formed text, no repeats, a sane length.
const cleanIds = (v: unknown, max = 200): string[] =>
  Array.isArray(v) ? [...new Set(v.filter((x): x is string => typeof x === 'string' && /^[a-z][a-z0-9-]*$/.test(x)))].slice(0, max) : []

// Settings can come from an imported or hand-edited backup, so anything unexpected falls back to the default.
export function normalizeSettings(raw: Partial<Record<keyof Settings, unknown>> | null | undefined): Settings {
  const r = raw ?? {}
  const d = DEFAULT_SETTINGS
  const colors = (r.colors && typeof r.colors === 'object' ? r.colors : {}) as Record<string, unknown>
  return {
    theme: pick<ThemeMode>(r.theme, ['dark', 'light', 'system'], d.theme),
    accent: isHex(r.accent) ? r.accent : d.accent,
    tagColors: r.tagColors && typeof r.tagColors === 'object' ? (r.tagColors as Settings['tagColors']) : d.tagColors,
    palette: PALETTES.some((p) => p.id === r.palette) ? (r.palette as string) : d.palette,
    uiStyle: pick<UiStyle>(r.uiStyle, ['modern', 'minimal'], d.uiStyle),
    radius: pick<Radius>(r.radius, ['sharp', 'soft', 'round'], d.radius),
    density: pick<Density>(r.density, ['compact', 'comfortable', 'spacious'], d.density),
    textSize: pick<TextSize>(r.textSize, ['small', 'default', 'large'], d.textSize),
    font: pick<FontChoice>(r.font, ['system', 'clean', 'serif', 'mono'], d.font),
    colors: { light: cleanOverrides(colors.light), dark: cleanOverrides(colors.dark) },
    sidebarCollapsed: r.sidebarCollapsed === true,
    pinnedTools: cleanIds(r.pinnedTools),
    sidebarClosedGroups: cleanIds(r.sidebarClosedGroups),
    recentTools: cleanIds(r.recentTools, MAX_RECENT_TOOLS),
    taskLayout: pick<TaskLayout>(r.taskLayout, ['list', 'board'], d.taskLayout)
  }
}

// ---------- the result ----------

// Every CSS variable the stylesheet reads. The renderer sets these on <html>.
export function appearanceVars(s: Settings, dark: boolean): Record<string, string> {
  const t = resolveTokens(s, dark)
  const accent = hexToRgb(s.accent)
  return {
    '--bg': triple(hexToRgb(t.bg)), '--panel': triple(hexToRgb(t.panel)), '--card': triple(hexToRgb(t.card)),
    '--line': triple(hexToRgb(t.line)), '--fg': triple(hexToRgb(t.fg)), '--muted': triple(hexToRgb(t.muted)),
    '--accent': triple(accent), '--on-accent': triple(onAccent(accent)), '--accent-fg': triple(accentText(accent, t)),
    '--rs': String(RADIUS_SCALE[s.radius]), '--d': String(DENSITY_SCALE[s.density]), '--ts': String(TEXT_SCALE[s.textSize]),
    '--font-ui': FONT_STACKS[s.font]
  }
}
