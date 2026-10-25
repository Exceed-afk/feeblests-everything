import type { Settings } from '../../../shared/types'

export const ACCENT_PRESETS = [
  { name: 'Violet', hex: '#8b5cf6' },
  { name: 'Emerald', hex: '#10b981' },
  { name: 'Rose', hex: '#f43f5e' },
  { name: 'Amber', hex: '#f59e0b' },
  { name: 'Slate', hex: '#64748b' }
]

const hexToRgb = (hex: string): string => {
  const n = parseInt(hex.replace('#', ''), 16)
  return `${(n >> 16) & 255} ${(n >> 8) & 255} ${n & 255}`
}

// Applies the saved theme to the page: toggles the `dark` class and sets --accent.
export function applyTheme(s: Settings): void {
  const dark = s.theme === 'dark' || (s.theme === 'system' && matchMedia('(prefers-color-scheme: dark)').matches)
  document.documentElement.classList.toggle('dark', dark)
  document.documentElement.style.setProperty('--accent', hexToRgb(s.accent))
}
