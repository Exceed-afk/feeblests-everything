// Everything about how the app looks, as plain functions with no DOM access, so the
// window code (main) and the page code (renderer) share one source of truth.
//
//   Settings  ->  normalizeSettings()  ->  appearanceVars()  ->  CSS variables on <html>
//
// To add a colour scheme: add one entry to PALETTES (a light and a dark set). Nothing else to change.
import {
  DEFAULT_INTELLIGENCE, DEFAULT_SETTINGS,
  type ColorOverrides, type Density, type FontChoice, type IntelligenceSettings, type Radius, type Settings, type TaskLayout, type TaskSort, type TaskSavedView, type TaskPriority, type TaskView, type TextSize, type ThemeMode, type UiStyle
} from './types'
import { MAX_RECENT_TOOLS } from './palette'
import { COLOR_TOKENS, accentFor } from './design'

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

const channel = (v: number): number => { const s = v / 255; return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4 }
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
const INK: RGB = [17, 23, 21] // the design system's dark page colour

// Text colour for buttons filled with the accent: white, unless the accent is too light for it (amber, emerald).
// This is the icon/large-text grade (3:1). Body text uses onAccentText below, which reaches 4.5:1.
export const onAccent = (accent: RGB): RGB => (contrast(WHITE, accent) >= 3.5 ? WHITE : INK)

// Text and fill for a filled control (primary button, calculator's = key).
// The brand violet is 4.23:1 against white, so the FILL is mixed a little toward black until white
// clears 4.5:1 (same hue, readable label), and --on-accent is then chosen AGAINST THAT FILL.
// A very light custom accent, where white can never work, falls back to the design ink.
export const accentFill = (accent: RGB): RGB => {
  if (contrast(WHITE, accent) >= 4.5) return accent
  for (let t = 0; t <= 0.2001; t += 0.02) {
    const out = mix(accent, [0, 0, 0], t)
    if (contrast(WHITE, out) >= 4.5) return out
  }
  return accent
}

export const onAccentText = (fill: RGB): RGB => {
  const white = contrast(WHITE, fill)
  const ink = contrast(INK, fill)
  if (white >= 4.5) return WHITE
  if (ink >= 4.5) return INK
  return white >= ink ? WHITE : INK // a deliberately extreme custom accent: the more readable one
}

export function accentTint(accent: RGB, t: Tokens, dark: boolean): RGB {
  return mix(hexToRgb(t.surface), accent, dark ? 0.2 : 0.14)
}

// Accent fills remain unchanged; text and icons use this adjusted accent if needed.
export function accentText(accent: RGB, t: Tokens, dark = false): RGB {
  const bg = hexToRgb(t.bg), sidebar = hexToRgb(t.sidebar), surface = hexToRgb(t.surface), text = hexToRgb(t.text)
  const selected = accentTint(accent, t, dark)
  return ensureContrast(accent, [bg, sidebar, surface, selected], 4.5, text)
}

// ---------- colour schemes ----------

export interface Tokens {
  bg: string
  surface: string
  sidebar: string
  border: string
  text: string
  muted: string
} // #rrggbb
export interface Palette { id: string; name: string; light: Tokens; dark: Tokens }

const nearWhite = (rgb: RGB): RGB => rgb.every((c) => c === 255) ? [254, 254, 254] : rgb
const nearBlack = (rgb: RGB): RGB => rgb.every((c) => c === 0) ? [1, 1, 1] : rgb

function adjustedToRange(color: RGB, against: RGB, min: number, max: number, lighter: boolean): RGB {
  const current = contrast(color, against)
  if (current >= min && current <= max) return color
  const target = current > max ? against : lighter ? WHITE : [0, 0, 0] as RGB
  for (let step = 1; step <= 1000; step++) {
    const candidate = mix(color, target, step / 1000)
    const ratio = contrast(candidate, against)
    if ((current > max && ratio <= (min + max) / 2) || (current < min && ratio >= (min + max) / 2)) return candidate
  }
  return color
}

function setContrastAtLeast(color: RGB, against: RGB, min: number, target: RGB): RGB {
  if (contrast(color, against) >= min) return color
  for (let step = 1; step <= 1000; step++) {
    const candidate = mix(color, target, step / 1000)
    if (contrast(candidate, against) >= min) return candidate
  }
  return color
}

function surfaceInRange(surface: RGB, bg: RGB): RGB {
  const ratio = contrast(surface, bg)
  if (ratio >= 1.03 && ratio <= 1.18) return surface
  const target = ratio > 1.18 ? bg : WHITE
  for (let step = 1; step <= 1000; step++) {
    const candidate = mix(surface, target, step / 1000)
    const next = contrast(candidate, bg)
    if (ratio > 1.18 ? next <= 1.1 : next >= 1.08) return candidate
  }
  return surface
}

function checkedTokens(tokens: Tokens, dark: boolean): Tokens {
  const bg = dark ? nearBlack(hexToRgb(tokens.bg)) : nearWhite(hexToRgb(tokens.bg))
  let surface = dark ? nearBlack(hexToRgb(tokens.surface)) : nearWhite(hexToRgb(tokens.surface))
  let sidebar = dark ? nearBlack(hexToRgb(tokens.sidebar)) : nearWhite(hexToRgb(tokens.sidebar))
  let border = hexToRgb(tokens.border)
  let text = hexToRgb(tokens.text)
  let muted = hexToRgb(tokens.muted)
  surface = surfaceInRange(surface, bg)
  text = adjustedToRange(text, bg, 10, 14, dark)
  border = setContrastAtLeast(border, bg, 1.25, text)
  muted = setContrastAtLeast(muted, bg, 4.5, text)
  return {
    bg: rgbToHex(bg),
    surface: rgbToHex(surface),
    sidebar: rgbToHex(sidebar),
    border: rgbToHex(border),
    text: rgbToHex(text),
    muted: rgbToHex(muted)
  }
}

interface Hsl { h: number; s: number; l: number }
function toHsl([r0, g0, b0]: RGB): Hsl {
  const [r, g, b] = [r0, g0, b0].map((c) => c / 255)
  const max = Math.max(r, g, b), min = Math.min(r, g, b), delta = max - min
  const l = (max + min) / 2
  let h = 0
  if (delta) {
    if (max === r) h = ((g - b) / delta) % 6
    else if (max === g) h = (b - r) / delta + 2
    else h = (r - g) / delta + 4
    h *= 60
    if (h < 0) h += 360
  }
  return { h, s: delta === 0 ? 0 : delta / (1 - Math.abs(2 * l - 1)), l }
}

function fromHsl({ h, s, l }: Hsl): RGB {
  const c = (1 - Math.abs(2 * l - 1)) * s
  const x = c * (1 - Math.abs((h / 60) % 2 - 1))
  const m = l - c / 2
  const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x]
  return [r, g, b].map((v) => Math.round((v + m) * 255)) as RGB
}

function companionTokens(seed: Tokens, dark: boolean): Tokens {
  const tone = (hex: string, lightness: number): RGB => {
    const source = toHsl(hexToRgb(hex))
    return fromHsl({ h: source.h, s: Math.min(source.s, 0.14), l: lightness })
  }
  const bg = tone(seed.bg, dark ? 0.11 : 0.96)
  return {
    bg: rgbToHex(bg),
    surface: rgbToHex(tone(seed.surface, dark ? 0.14 : 0.985)),
    sidebar: rgbToHex(tone(seed.sidebar, dark ? 0.08 : 0.92)),
    border: rgbToHex(tone(seed.border, dark ? 0.21 : 0.86)),
    text: rgbToHex(tone(seed.text, dark ? 0.88 : 0.2)),
    muted: rgbToHex(tone(seed.muted, dark ? 0.63 : 0.42))
  }
}

type PaletteSource = { id: string; name: string; light?: Tokens; dark?: Tokens }
const palette = (source: PaletteSource): Palette => {
  const light = source.light ?? companionTokens(source.dark!, false)
  const dark = source.dark ?? companionTokens(source.light!, true)
  return { id: source.id, name: source.name, light: checkedTokens(light, false), dark: checkedTokens(dark, true) }
}

const fromDesign = (set: typeof COLOR_TOKENS.light): Tokens => ({
  bg: set.bg, surface: set.surface, sidebar: set.panel, border: set.line, text: set.fg, muted: set.muted
})

export const PALETTES: Palette[] = [
  palette({
    id: 'default', name: 'Default',
    light: { ...fromDesign(COLOR_TOKENS.light), surface: '#fefefe' },
    dark: fromDesign(COLOR_TOKENS.dark)
  }),
  palette({ id: 'midnight', name: 'Midnight',
    light: { bg: '#eef2fa', surface: '#fefefe', sidebar: '#fefefe', border: '#d9e0ef', text: '#121a2e', muted: '#5a6784' },
    dark: { bg: '#0b1020', surface: '#141c33', sidebar: '#0f1629', border: '#25304f', text: '#e6ebf7', muted: '#93a0bd' } }),
  palette({ id: 'paper', name: 'Paper',
    light: { bg: '#f6f1e7', surface: '#fffdf8', sidebar: '#fbf8f1', border: '#e3dac8', text: '#2b2620', muted: '#6f6455' },
    dark: { bg: '#1a1714', surface: '#27221d', sidebar: '#201c18', border: '#3a342c', text: '#ece4d6', muted: '#a39786' } }),
  palette({ id: 'forest', name: 'Forest',
    light: { bg: '#eff5f1', surface: '#fefefe', sidebar: '#fefefe', border: '#d5e3da', text: '#14211b', muted: '#56695f' },
    dark: { bg: '#0d1512', surface: '#172420', sidebar: '#111c18', border: '#26382f', text: '#e4efe9', muted: '#8ca59a' } }),
  palette({ id: 'frost', name: 'Frost',
    light: { bg: '#eceff4', surface: '#fefefe', sidebar: '#f7f8fb', border: '#d8dee9', text: '#2e3440', muted: '#586378' },
    dark: { bg: '#2a303c', surface: '#323947', sidebar: '#252b36', border: '#434c5e', text: '#eceff4', muted: '#a8b1c4' } }),
  palette({ id: 'graphite', name: 'Graphite',
    light: { bg: '#f3f3f4', surface: '#fefefe', sidebar: '#fefefe', border: '#e2e2e4', text: '#111111', muted: '#636363' },
    dark: { bg: '#0a0a0a', surface: '#161616', sidebar: '#111111', border: '#2a2a2a', text: '#ededed', muted: '#9a9a9a' } }),
  palette({ id: 'mocha-cream', name: 'Mocha Cream',
    light: { bg: '#F8F4E6', surface: '#FDFBF3', sidebar: '#F0E9D6', border: '#E0D4BC', text: '#4A3320', muted: '#80654A' } }),
  palette({ id: 'espresso-night', name: 'Espresso Night',
    dark: { bg: '#1B130C', surface: '#251B12', sidebar: '#130D08', border: '#3A2B1B', text: '#DDD6C3', muted: '#A0957C' } }),
  palette({ id: 'soft-linen', name: 'Soft Linen',
    light: { bg: '#F9F8F6', surface: '#FEFEFD', sidebar: '#F1ECE7', border: '#E0D7CF', text: '#3A322B', muted: '#776B60' } }),
  palette({ id: 'fresh-meadow', name: 'Fresh Meadow',
    light: { bg: '#EFF7F0', surface: '#FAFDFA', sidebar: '#E4F1E5', border: '#C6DEC8', text: '#1F3A23', muted: '#4C7050' } }),
  palette({ id: 'warm-sand', name: 'Warm Sand',
    light: { bg: '#f2ecde', surface: '#faf8f3', sidebar: '#f6f2e9', border: '#cfc6b1', text: '#544d41', muted: '#6f685c' },
    dark: { bg: '#2f2c28', surface: '#3d3a35', sidebar: '#36332f', border: '#504b42', text: '#ebe2cc', muted: '#aba494' } }),
  palette({ id: 'royal-plum', name: 'Royal Plum',
    dark: { bg: '#1F1527', surface: '#291C34', sidebar: '#190F20', border: '#3E2B4D', text: '#E5DBEE', muted: '#A58EB8' } }),
  palette({ id: 'sage-garden', name: 'Sage Garden',
    dark: { bg: '#1C241B', surface: '#212C20', sidebar: '#161E15', border: '#364634', text: '#DBEADC', muted: '#9BB399' } })
]

export const OVERRIDE_KEYS = ['bg', 'sidebar', 'surface', 'text'] as const

export function cardBorder(tokens: Tokens, style: UiStyle): RGB {
  return style === 'minimal'
    ? hexToRgb(tokens.border)
    : mix(hexToRgb(tokens.surface), hexToRgb(tokens.border), 0.65)
}

export interface ContrastMetrics {
  textOnBackground: number
  mutedOnBackground: number
  borderOnBackground: number
  surfaceOnBackground: number
  cardBorderOnSurface: number
}

export function themeContrast(tokens: Tokens, style: UiStyle): ContrastMetrics {
  const bg = hexToRgb(tokens.bg), surface = hexToRgb(tokens.surface)
  const border = cardBorder(tokens, style)
  return {
    textOnBackground: contrast(hexToRgb(tokens.text), bg),
    mutedOnBackground: contrast(hexToRgb(tokens.muted), bg),
    borderOnBackground: contrast(border, bg),
    surfaceOnBackground: contrast(surface, bg),
    cardBorderOnSurface: contrast(border, surface)
  }
}

// Migrate the former theme selector and recipe-era camelCase palette ids.
export function migrateColorScheme(paletteValue: unknown, colorSchemeValue?: unknown): string | null {
  const aliases: Record<string, string> = {
    mochacream: 'mocha-cream', espressonight: 'espresso-night', softlinen: 'soft-linen',
    freshmeadow: 'fresh-meadow', warmsand: 'warm-sand', royalplum: 'royal-plum', sagegarden: 'sage-garden'
  }
  const findId = (value: unknown): string | null => {
    if (typeof value !== 'string') return null
    const slug = value.trim().toLowerCase().replace(/[\s_]+/g, '-')
    const candidate = aliases[slug.replace(/-/g, '')] ?? slug
    return PALETTES.some((p) => p.id === candidate) ? candidate : null
  }
  const savedTheme = findId(colorSchemeValue)
  const savedPalette = findId(paletteValue)
  return savedPalette && (savedPalette !== 'default' || !savedTheme) ? savedPalette : savedTheme ?? savedPalette
}

// The palette's own tokens, with per-mode user overrides applied afterward.
export function resolveTokens(s: Pick<Settings, 'palette' | 'colors'>, dark: boolean): Tokens {
  const pal = PALETTES.find((p) => p.id === s.palette) ?? PALETTES[0]
  const t: Tokens = { ...(dark ? pal.dark : pal.light) }
  const picked = s.colors?.[dark ? 'dark' : 'light'] ?? {}
  let changed = false
  for (const key of OVERRIDE_KEYS) {
    const value = picked[key]
    if (isHex(value)) { t[key] = value; changed = true }
  }
  if (changed) {
    const bg = hexToRgb(t.bg), text = hexToRgb(t.text)
    t.border = rgbToHex(mix(bg, text, dark ? 0.16 : 0.12))
    t.muted = rgbToHex(ensureContrast(mix(text, bg, 0.4), [bg, hexToRgb(t.sidebar), hexToRgb(t.surface)], 4.5, text))
  }
  return t
}

// ---------- shape, spacing, type ----------

// Multipliers: radius scales every rounded-* corner, density every padding/margin/gap (see tailwind.config.js).
export const RADIUS_SCALE: Record<Radius, number> = { sharp: 0.2, soft: 1.3, round: 1.7 }
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
// "soft" is the scale 1.3 (see RADIUS_SCALE): a card lands on its designed 16px radius, a button and a field on 10px.
export const STYLE_PRESETS: Record<UiStyle, Pick<Settings, 'radius' | 'density'>> = {
  modern: { radius: 'soft', density: 'comfortable' },
  minimal: { radius: 'sharp', density: 'compact' }
}

// ---------- validation ----------

const pick = <T extends string>(v: unknown, allowed: readonly T[], fallback: T): T => (allowed.includes(v as T) ? (v as T) : fallback)
const cleanOverrides = (v: unknown): ColorOverrides => {
  const out: ColorOverrides = {}
  if (v && typeof v === 'object') {
    const raw = v as Record<string, unknown>
    const aliases: Record<string, (typeof OVERRIDE_KEYS)[number]> = { panel: 'sidebar', card: 'surface', fg: 'text' }
    for (const key of OVERRIDE_KEYS) {
      const oldKey = Object.keys(aliases).find((candidate) => aliases[candidate] === key)
      const color = raw[key] ?? (oldKey ? raw[oldKey] : undefined)
      if (isHex(color)) out[key] = color
    }
  }
  return out
}

// A list of tool or group ids from the saved settings: only well-formed text, no repeats, a sane length.
const cleanIds = (v: unknown, max = 200): string[] =>
  Array.isArray(v) ? [...new Set(v.filter((x): x is string => typeof x === 'string' && /^[a-z][a-z0-9-]*$/.test(x)))].slice(0, max) : []

const cleanTaskViews = (value: unknown): TaskSavedView[] => {
  if (!Array.isArray(value)) return []
  return value.filter((item): item is TaskSavedView => {
    if (!item || typeof item !== 'object') return false
    const view = item as Partial<TaskSavedView>
    return typeof view.id === 'string' && /^[a-z0-9-]{1,48}$/.test(view.id) &&
      typeof view.name === 'string' && Boolean(view.name.trim()) &&
      Boolean(view.filter && typeof view.filter === 'object')
  }).slice(0, 20).map((view) => ({
    id: view.id,
    name: view.name.trim().slice(0, 40),
    filter: {
      view: pick<TaskView>(view.filter.view, ['today', 'upcoming', 'overdue', 'all', 'completed'], 'all'),
      text: typeof view.filter.text === 'string' ? view.filter.text.slice(0, 100) : '',
      priority: (['low', 'medium', 'high'] as unknown[]).includes(view.filter.priority) ? view.filter.priority as TaskPriority : undefined,
      project: typeof view.filter.project === 'string' ? view.filter.project.slice(0, 100) : undefined,
      tag: typeof view.filter.tag === 'string' ? view.filter.tag.slice(0, 60) : undefined
    }
  }))
}

// Settings can come from an imported or hand-edited backup, so anything unexpected falls back to the default.
export type SettingsInput = Partial<Record<keyof Settings, unknown>> & { colorScheme?: unknown; colourScheme?: unknown }
export function normalizeSettings(raw: SettingsInput | null | undefined): Settings {
  const r = raw ?? {}
  const d = DEFAULT_SETTINGS
  const colors = (r.colors && typeof r.colors === 'object' ? r.colors : {}) as Record<string, unknown>
  return {
    theme: pick<ThemeMode>(r.theme, ['dark', 'light', 'system'], d.theme),
    accent: isHex(r.accent) ? r.accent : d.accent,
    tagColors: r.tagColors && typeof r.tagColors === 'object' ? (r.tagColors as Settings['tagColors']) : d.tagColors,
    palette: migrateColorScheme(r.palette, r.colorScheme ?? r.colourScheme) ?? d.palette,
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
    taskLayout: pick<TaskLayout>(r.taskLayout, ['list', 'board'], d.taskLayout),
    taskSort: pick<TaskSort>(r.taskSort, ['manual', 'due-date', 'priority'], d.taskSort),
    taskSavedViews: cleanTaskViews(r.taskSavedViews),
    disabledModules: cleanIds(r.disabledModules),
    trash: r.trash && typeof r.trash === 'object' && typeof (r.trash as { purgeDays?: unknown }).purgeDays === 'number'
      ? { purgeDays: Math.max(1, Math.min(365, Math.floor((r.trash as { purgeDays: number }).purgeDays))) }
      : d.trash,
    focus: r.focus && typeof r.focus === 'object'
      ? {
          focusDuration: Math.max(1, Math.min(180, Math.floor(Number((r.focus as { focusDuration?: unknown }).focusDuration) || d.focus.focusDuration))),
          shortBreakDuration: Math.max(1, Math.min(60, Math.floor(Number((r.focus as { shortBreakDuration?: unknown }).shortBreakDuration) || d.focus.shortBreakDuration))),
          longBreakDuration: Math.max(1, Math.min(120, Math.floor(Number((r.focus as { longBreakDuration?: unknown }).longBreakDuration) || d.focus.longBreakDuration))),
          longBreakInterval: Math.max(1, Math.min(12, Math.floor(Number((r.focus as { longBreakInterval?: unknown }).longBreakInterval) || d.focus.longBreakInterval))),
          autoStartBreaks: (r.focus as { autoStartBreaks?: unknown }).autoStartBreaks === true,
          autoStartFocus: (r.focus as { autoStartFocus?: unknown }).autoStartFocus === true,
          soundEnabled: (r.focus as { soundEnabled?: unknown }).soundEnabled !== false
        }
      : d.focus,
    intelligence: r.intelligence && typeof r.intelligence === 'object'
      ? {
          features: { ...DEFAULT_INTELLIGENCE.features, ...((r.intelligence as { features?: Partial<IntelligenceSettings['features']> }).features ?? {}) }
        }
      : DEFAULT_INTELLIGENCE,
    // A malformed value is kept as-is here and falls back to the default layout in the Dashboard
    // (parseLayout), so a damaged backup never loses the rest of the settings with it.
    dashboardLayout: typeof r.dashboardLayout === 'string' ? r.dashboardLayout : ''
  }
}

// ---------- the result ----------

// Every CSS variable the stylesheet reads. The renderer sets these on <html>.
export function appearanceVars(s: Settings, dark: boolean): Record<string, string> {
  const t = resolveTokens(s, dark)
  const accent = hexToRgb(accentFor(s.accent, dark))
  const fill = accentFill(accent)
  const modernBorder = cardBorder(t, 'modern')
  return {
    '--bg': triple(hexToRgb(t.bg)), '--surface': triple(hexToRgb(t.surface)), '--sidebar': triple(hexToRgb(t.sidebar)),
    '--border': triple(hexToRgb(t.border)), '--text': triple(hexToRgb(t.text)), '--muted': triple(hexToRgb(t.muted)),
    '--panel': triple(hexToRgb(t.sidebar)), '--card': triple(hexToRgb(t.surface)), '--line': triple(hexToRgb(t.border)), '--fg': triple(hexToRgb(t.text)),
    '--card-border': triple(modernBorder), '--selected': triple(accentTint(accent, t, dark)),
    // --accent stays the identity colour (tints, charts, borders). --accent-fill is the same colour
    // darkened just enough that --on-accent text on it reaches 4.5:1 (filled buttons and keys).
    '--accent': triple(accent), '--accent-fill': triple(fill), '--on-accent': triple(onAccentText(fill)), '--accent-fg': triple(accentText(accent, t, dark)),
    // A full rgb() colour, not a triple: the charts use it as plain CSS text (fill: var(--mood)), where a triple is invalid.
    '--mood': `rgb(${hexToRgb(dark ? COLOR_TOKENS.dark.mood : COLOR_TOKENS.light.mood).join(' ')})`,
    '--rs': String(RADIUS_SCALE[s.radius]), '--d': String(DENSITY_SCALE[s.density]), '--ts': String(TEXT_SCALE[s.textSize]),
    '--font-ui': FONT_STACKS[s.font]
  }
}
