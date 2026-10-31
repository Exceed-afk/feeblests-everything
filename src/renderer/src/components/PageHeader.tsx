import { ChevronLeft, ChevronRight } from 'lucide-react'
import type { ReactNode } from 'react'

// The one header every page uses: title, optional subtitle (with any status badge), and the primary action on the right.
export function PageHeader({ title, subtitle, children }: { title: string; subtitle?: ReactNode; children?: ReactNode }) {
  return (
    <header className="page-head">
      <div className="min-w-0">
        <h1 className="page-title">{title}</h1>
        {subtitle && <p className="page-sub">{subtitle}</p>}
      </div>
      {children && <div className="page-actions">{children}</div>}
    </header>
  )
}

// Previous / next period arrows, always the same width so the header does not jump between periods.
// `disabled` still keeps the button in place (and readable to screen readers) instead of removing it.
export function PeriodArrows({ onPrev, onNext, prevLabel, nextLabel, nextDisabled }: {
  onPrev: () => void; onNext: () => void; prevLabel: string; nextLabel: string; nextDisabled?: boolean
}) {
  return (
    <div className="flex items-center">
      <button className="arrow" onClick={onPrev} aria-label={prevLabel} title={prevLabel}><ChevronLeft size={18} aria-hidden="true" /></button>
      <button className="arrow" onClick={onNext} aria-label={nextLabel} title={nextLabel} disabled={nextDisabled}><ChevronRight size={18} aria-hidden="true" /></button>
    </div>
  )
}
