import type { Mood } from '../../../shared/types'

// Full class names are written out so Tailwind can find them.
export const MOOD_STYLE: Record<Mood, { label: string; dot: string }> = {
  great: { label: 'Great', dot: 'bg-emerald-500' },
  good: { label: 'Good', dot: 'bg-sky-500' },
  okay: { label: 'Okay', dot: 'bg-amber-400' },
  low: { label: 'Low', dot: 'bg-orange-500' },
  rough: { label: 'Rough', dot: 'bg-rose-500' }
}

// Safe lookup for any text: an unknown mood gets a neutral dot instead of crashing the page.
export const moodStyle = (mood: string): { label: string; dot: string } =>
  MOOD_STYLE[mood as Mood] ?? { label: mood, dot: 'bg-muted' }
