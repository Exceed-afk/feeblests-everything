// Small form building blocks shared by the Notes and Content editors.
//
// Deliberately duplicated from the Expenses dialog pieces rather than moving
// them: Expenses was shipped and verified, and this needs no behaviour change
// there. Everything uses theme tokens only.
import type { ReactNode } from 'react'
import { AlertTriangle } from 'lucide-react'

// A labelled control. The label wraps the control, so it always has an
// accessible name without extra ids.
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

// A modal panel: Escape closes, the backdrop closes, Ctrl+Enter saves (the
// caller passes onSave). Focus is not trapped, so Tab can still reach the
// address bar — the dialog is one Tab from the page, never a keyboard dead end.
export function Dialog({ title, onClose, onSave, children, wide = false }: {
  title: string
  onClose: () => void
  onSave?: () => void
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
        onKeyDown={(e) => {
          if (e.key === 'Escape') { e.stopPropagation(); onClose() }
          if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && onSave) { e.preventDefault(); onSave() }
        }}
        className={`card card-pad-lg w-[min(${wide ? '46rem' : '30rem'},94%)]`}
      >
        <div className="flex items-start justify-between gap-3">
          <h2 className="section-title">{title}</h2>
          <button className="btn-icon" onClick={onClose} aria-label="Close"><span aria-hidden="true">✕</span></button>
        </div>
        <div className="mt-4">{children}</div>
      </div>
    </div>
  )
}
