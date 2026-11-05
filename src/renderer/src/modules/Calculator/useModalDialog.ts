import { useEffect, useRef, type KeyboardEvent, type RefObject } from 'react'

/**
 * Shared modal-dialog behaviour for the calculator: focus moves into the dialog when it
 * opens (first focusable element, or the overlay itself when nothing is focusable),
 * Tab / Shift+Tab stay inside while it is open, Escape closes, and focus returns to the
 * trigger that opened it when it closes. The overlay element must carry role="dialog".
 */
export function useModalDialog(open: boolean, onClose: () => void): {
  overlayRef: RefObject<HTMLDivElement>
  triggerRef: RefObject<HTMLButtonElement>
  onKeyDown: (e: KeyboardEvent<HTMLDivElement>) => void
} {
  const overlayRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!open) return
    const overlay = overlayRef.current
    const focusables = overlay
      ? Array.from(
        overlay.querySelectorAll<HTMLElement>('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])')
      ).filter((el) => !el.hasAttribute('disabled'))
      : []
    const first = focusables[0]
    if (first) first.focus()
    else overlay?.focus()

    // The trigger that opened the dialog gets focus back on close, whatever closed it.
    const previouslyFocused = document.activeElement as HTMLElement | null
    return () => {
      const trigger = triggerRef.current
      if (trigger && trigger.isConnected) trigger.focus()
      else previouslyFocused?.focus?.()
    }
  }, [open])

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Escape') {
      e.stopPropagation()
      onClose()
      return
    }
    if (e.key !== 'Tab') return
    // Keep Tab cycling inside the dialog while it is open.
    const overlay = overlayRef.current
    if (!overlay) return
    const focusables = Array.from(
      overlay.querySelectorAll<HTMLElement>('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])')
    ).filter((el) => !el.hasAttribute('disabled') && el.offsetParent !== null)
    if (focusables.length === 0) {
      e.preventDefault()
      return
    }
    const first = focusables[0]
    const last = focusables[focusables.length - 1]
    const active = document.activeElement
    if (e.shiftKey) {
      if (active === first || !overlay.contains(active)) {
        e.preventDefault()
        last.focus()
      }
    } else if (active === last || !overlay.contains(active)) {
      e.preventDefault()
      first.focus()
    }
  }

  return { overlayRef, triggerRef, onKeyDown }
}
