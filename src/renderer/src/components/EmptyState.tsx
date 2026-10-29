import type { ReactNode } from 'react'
import type { LucideIcon } from 'lucide-react'

// Empty list or section: what it is for, then ONE clear next step.
// `compact` is the quiet version used inside dashboard cards.
export function EmptyState({ icon: Icon, title, text, action, compact }: {
  icon?: LucideIcon; title: string; text?: string; action?: ReactNode; compact?: boolean
}) {
  return (
    <div className={compact ? 'empty empty-sm' : 'empty'}>
      {Icon && !compact && <div className="empty-icon" aria-hidden="true"><Icon size={20} /></div>}
      <p className="empty-title">{title}</p>
      {text && <p className="empty-text">{text}</p>}
      {action}
    </div>
  )
}
