// Renders a note's markdown as SAFE HTML (Phase 2).
//
// The HTML comes from src/shared/markdown.ts, which disables raw HTML in the
// parser and sanitises with DOMPurify. That is why dangerouslySetInnerHTML is
// acceptable here and nowhere else: the string is allow-listed to a small set
// of tags with no scripts, styles or event handlers.
//
// Clicks are handled by ONE delegated listener on the container:
//   - `note:` links ([[wiki links]]) close over to the note by its slug;
//   - http(s) links are opened by the OS browser through Electron's navigation
//     guard (src/shared/url.ts + shell.openExternal), never inside the app.
// Nothing here opens anything itself, and nothing navigates the window.
import { useEffect, useRef } from 'react'
import { renderMarkdown, WIKI_PROTOCOL } from '../../../shared/markdown'

export function MarkdownView({ markdown, onOpenNote, className = '' }: {
  markdown: string
  onOpenNote?: (slug: string) => void
  className?: string
}) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const root = ref.current
    if (!root) return
    const onClick = (event: MouseEvent) => {
      const anchor = (event.target as HTMLElement | null)?.closest('a')
      if (!anchor) return
      const href = anchor.getAttribute('href') ?? ''
      if (href.startsWith(WIKI_PROTOCOL)) {
        event.preventDefault()
        onOpenNote?.(decodeURIComponent(href.slice(WIKI_PROTOCOL.length)))
        return
      }
      // External links: let the main process's navigation guard decide
      // (window.open with an http(s) URL opens the OS browser; anything else
      // is blocked). preventDefault stops the page itself from navigating.
      event.preventDefault()
      if (/^https?:\/\//i.test(href)) window.open(href, '_blank', 'noopener,noreferrer')
    }
    root.addEventListener('click', onClick)
    return () => root.removeEventListener('click', onClick)
  }, [onOpenNote, markdown])

  return (
    <div
      ref={ref}
      className={`md ${className}`}
      // Sanitised in renderMarkdown (raw HTML off + DOMPurify allow-list).
      dangerouslySetInnerHTML={{ __html: renderMarkdown(markdown) }}
    />
  )
}
