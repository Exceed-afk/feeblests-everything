import type { Settings } from '../../../shared/types'
import { appearanceVars } from '../../../shared/appearance'

export const ACCENT_PRESETS = [
  { name: 'Green', hex: '#075b38' },
  { name: 'Violet', hex: '#8b5cf6' },
  { name: 'Emerald', hex: '#10b981' },
  { name: 'Rose', hex: '#f43f5e' },
  { name: 'Amber', hex: '#f59e0b' },
  { name: 'Slate', hex: '#64748b' },
  { name: 'Sky', hex: '#0ea5e9' },
  { name: 'Orange', hex: '#f97316' }
]

// Is the app in dark mode right now? ("System" follows Windows.)
export function isDark(s: Pick<Settings, 'theme'>): boolean {
  return s.theme === 'dark' || (s.theme === 'system' && matchMedia('(prefers-color-scheme: dark)').matches)
}

// Puts the saved look onto the page: the `dark` class, the style name, and every colour / size variable.
// What each variable means is in shared/appearance.ts; where it is used is in styles.css.
export function applyAppearance(s: Settings): void {
  const dark = isDark(s)
  const root = document.documentElement
  root.classList.toggle('dark', dark)
  root.dataset.style = s.uiStyle
  for (const [name, value] of Object.entries(appearanceVars(s, dark))) root.style.setProperty(name, value)
}
