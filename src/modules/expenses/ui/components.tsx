// Small building blocks shared by the Expenses tabs (Phase 1 UI).
// Theme tokens only (no literal colours): everything here reads the same CSS
// variables as the rest of the app, so Modern and Classic and every theme work.
import type { ReactNode } from 'react'
import { AlertTriangle } from 'lucide-react'
import { PeriodArrows } from '../../../renderer/src/components/PageHeader'
import { addMonths, monthLabel } from './format'

// One month, moved with the previous/next arrows. `nextDisabled` stops the user
// walking past the current month when the page only looks at the past.
export function MonthPicker({ month, onChange, nextDisabled }: {
  month: string
  onChange: (month: string) => void
  nextDisabled?: boolean
}) {
  return (
    <div className="flex items-center gap-2">
      <PeriodArrows
        onPrev={() => onChange(addMonths(month, -1))}
        onNext={() => onChange(addMonths(month, 1))}
        prevLabel="Previous month"
        nextLabel="Next month"
        nextDisabled={nextDisabled}
      />
      <span className="min-w-[9.5rem] text-sm font-medium num" aria-live="polite">{monthLabel(month)}</span>
    </div>
  )
}

// A labelled form field. The label wraps the control, so the control has a real
// accessible name without an extra id.
export function Field({ label, hint, children, className = '' }: {
  label: string
  hint?: string
  children: ReactNode
  className?: string
}) {
  return (
    <label className={`block text-xs text-muted ${className}`}>
      {label}
      <div className="mt-1">{children}</div>
      {hint && <p className="mt-1 text-xs text-muted">{hint}</p>}
    </label>
  )
}

// A short message under a form: errors speak up (role=alert), everything else
// is a quiet status line.
export function FormMessage({ error, note }: { error?: string; note?: string }) {
  if (error) {
    return (
      <p role="alert" className="inline-flex items-center gap-1.5 text-sm text-neg">
        <AlertTriangle size={14} aria-hidden="true" /> {error}
      </p>
    )
  }
  if (note) return <p role="status" className="text-sm text-muted">{note}</p>
  return null
}

// A modal panel. Escape closes it, the backdrop closes it, and the first field
// receives focus so the dialog is usable from the keyboard alone.
export function Dialog({ title, onClose, children, wide = false }: {
  title: string
  onClose: () => void
  children: ReactNode
  wide?: boolean
}) {
  return (
    <div className="scrim fixed inset-0 z-30 flex items-start justify-center overflow-y-auto py-10" onMouseDown={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); onClose() } }}
        className={`card card-pad-lg w-[min(${wide ? '40rem' : '30rem'},92%)]`}
      >
        <div className="flex items-start justify-between gap-3">
          <h2 className="section-title">{title}</h2>
          <button className="btn-icon" onClick={onClose} aria-label="Close">
            <span aria-hidden="true">✕</span>
          </button>
        </div>
        <div className="mt-4">{children}</div>
      </div>
    </div>
  )
}

// A busy state for buttons: the label stays, and the button reports that work
// is running to assistive technology via aria-busy (set by the caller).
export function BusyLabel({ busy, children }: { busy: boolean; children: ReactNode }) {
  return (
    <>
      <span aria-hidden={busy} className={busy ? 'opacity-70' : undefined}>{children}</span>
    </>
  )
}

// A card showing one headline number with a caption. Used for the left-to-spend
// figure and the month totals.
export function StatTile({ label, value, caption, tone = 'default' }: {
  label: string
  value: string
  caption?: string
  tone?: 'default' | 'pos' | 'neg'
}) {
  const valueClass = tone === 'pos' ? 'text-pos' : tone === 'neg' ? 'text-neg' : 'text-fg'
  return (
    <div className="card card-pad">
      <p className="meta">{label}</p>
      <p className={`stat-value num ${valueClass}`}>{value}</p>
      {caption && <p className="meta mt-1">{caption}</p>}
    </div>
  )
}
