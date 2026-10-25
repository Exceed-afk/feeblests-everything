import type { Mood } from '../../../shared/types'

// Full class names are written out so Tailwind can find them.
export const MOOD_STYLE: Record<Mood, { label: string; dot: string }> = {
  great: { label: 'Great', dot: 'bg-emerald-500' },
  good: { label: 'Good', dot: 'bg-sky-500' },
  okay: { label: 'Okay', dot: 'bg-amber-400' },
  low: { label: 'Low', dot: 'bg-orange-500' },
  rough: { label: 'Rough', dot: 'bg-rose-500' }
}
