import type { ReactNode } from 'react'
import { tagStyle, useTagColors } from '../lib/tagColors'

// One tag, drawn in its chosen colour (or the accent colour when none is chosen).
// Pass `onClick` to make it a button; `children` is extra content such as a remove button.
export function TagChip({ tag, onClick, children }: { tag: string; onClick?: (e: React.MouseEvent) => void; children?: ReactNode }) {
  const hex = useTagColors()[tag]
  const base = 'inline-flex items-center gap-1 rounded-lg px-2 py-0.5 text-xs'
  const cls = hex ? base : `${base} bg-accent/15 text-accent`
  return onClick
    ? <button onClick={onClick} style={tagStyle(hex)} className={`${cls} hover:brightness-125`}>#{tag}{children}</button>
    : <span style={tagStyle(hex)} className={cls}>#{tag}{children}</span>
}
