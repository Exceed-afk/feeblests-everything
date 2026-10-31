// The design system as plain data, so every number a person can see is defined in ONE place and can be
// checked by a test (tests/design.ts). Nothing here touches the DOM or React.
//
//   colours   -> COLOR_TOKENS -> CSS variables (styles.css :root / .dark, and shared/appearance.ts)
//   type      -> TYPE_SCALE   -> the .page-title / .stat-value / ... rules in styles.css
//   spacing   -> SPACING      -> the 4px grid the densities are built from
//   rounded   -> RADIUS       -> cards, buttons, fields
//
// Rule of thumb: a page or component never writes a raw hex colour or a pixel value for its own layout;
// it uses a token class (see styles.css) or a value listed here.

// ---------- colour ----------

export type TokenName =
  | 'bg' | 'surface' | 'panel' | 'line' | 'fg' | 'muted'
  | 'accent' | 'accentFg' | 'pos' | 'neg' | 'warn' | 'mood' | 'moodMuted'

// The light and dark sets are designed side by side, not inverted from each other: the dark set is
// lifted off black and its gains / losses are lightened so they stay readable on a dark surface.
export interface ColorSet { bg: string; surface: string; panel: string; card: string; line: string; fg: string; muted: string; pos: string; neg: string; warn: string; mood: string }

// `mood` is the one neutral accent of the data charts (mood trend, goal progress). It is not a "good" colour:
// mood keeps its own words and dots, so a rising line never claims that any mood is wrong.
// `muted` is a shade darker than the starting #64748B so secondary text keeps 4.5:1 on the page itself, not only on cards.
export const COLOR_TOKENS: { light: ColorSet; dark: ColorSet } = {
  light: { bg: '#f4f5f4', surface: '#ffffff', card: '#ffffff', panel: '#ffffff', line: '#e5e7e7', fg: '#171a18', muted: '#63708a', pos: '#057a52', neg: '#c51b45', warn: '#8f5a06', mood: '#2f6f9f' },
  dark: { bg: '#111715', surface: '#1b2420', card: '#1b2420', panel: '#161d1a', line: '#303b35', fg: '#f1f5f2', muted: '#a1ada5', pos: '#42c58a', neg: '#f5849a', warn: '#e5b450', mood: '#74b2d8' }
}
// The dark loss colour is a step lighter than the starting #EF7188, which could not be read on the Frost palette's
// cards (4.08:1); every other palette passes with both.

// The accent used by the default look. Settings can still pick another one (lib/theme.ts ACCENT_PRESETS).
export const DEFAULT_ACCENT = { light: '#075b38', dark: '#42a879' }

// Spacing grid: every padding, margin and gap is a multiple of 4px.
export const SPACING = [0, 4, 8, 12, 16, 24, 32] as const

// Corner radii (px, scale 1x). Cards 16, buttons / inputs 10.
export const RADIUS = { card: 16, control: 10, chip: 8, pill: 999 } as const

// Type scale (px at the default text size; the Text size setting multiplies the whole page).
export const TYPE_SCALE = {
  pageTitle: 28,   // Review / Dashboard / page names
  cardLabel: 13,   // the label above a metric
  metric: 30,      // the main number of a summary card
  sectionTitle: 15, // card headings ("Trading", "Savings")
  body: 14,
  small: 12
} as const

// Durations (ms) for hover and state changes. Long enough to notice, short enough not to wait for.
// styles.css switches all of these off when the system asks for reduced motion.
export const MOTION = { fast: 150, base: 200 } as const

// ---------- contrast (WCAG 2) ----------

export type RGB = [number, number, number]

// "2026-10-28" -> "Wed 28 Oct". The date part is read as a calendar date (UTC), so the machine's time zone
// cannot shift it by a day.
export function shortDate(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number)
  const day = new Date(Date.UTC(y, m - 1, d))
  return `${['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][day.getUTCDay()]} ${d} ${MONTHS_SHORT[m - 1]}`
}

export const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

export const hexToRgb = (hex: string): RGB => {
  const n = parseInt(hex.slice(1), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

const channel = (v: number): number => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4 }
const luminance = (c: RGB): number => 0.2126 * channel(c[0]) + 0.7152 * channel(c[1]) + 0.0722 * channel(c[2])

// 1 (identical) to 21 (black on white). Body text should reach 4.5, large text and UI edges 3.
export function contrast(a: RGB, b: RGB): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}

// ---------- semantic colours ----------

// Money language, used by every page: a gain is green, a loss is red, nothing is neutral (never "red = empty").
export type Tone = 'pos' | 'neg' | 'muted'
export const toneOf = (n: number | null | undefined): Tone => (n === null || n === undefined || n === 0 ? 'muted' : n > 0 ? 'pos' : 'neg')

// The default accent depends on the mode, and the saved setting holds one value for both. So a saved colour that is
// exactly the other mode's default follows the mode (dark users get the light green, light users the deep one);
// any other colour the user picked is used as it is.
export function accentFor(saved: string, dark: boolean): string {
  if (saved === DEFAULT_ACCENT.dark && !dark) return DEFAULT_ACCENT.light
  if (saved === DEFAULT_ACCENT.light && dark) return DEFAULT_ACCENT.dark
  return saved
}
