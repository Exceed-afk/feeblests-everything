// Rendered maths output (KaTeX), with plain text as the fallback.
//
// - KaTeX is bundled locally (CSS + fonts through the build): no CDN, no network.
// - `trust: false` and `throwOnError: true`: anything KaTeX cannot parse falls back
//   to the plain text, and no raw HTML from user input is ever inserted.
// - Colours come from theme tokens (the .calc-math class in styles.css), so the
//   same output reads correctly in light and dark themes.
import { useMemo } from 'react'
import katex from 'katex'

export interface MathOutputProps {
  /** LaTeX source, built by the calculator (never raw HTML). */
  latex: string
  /** Plain text shown if rendering fails. */
  fallback: string
  /** Accessible label for the rendered block. */
  label?: string
  className?: string
}

export function MathOutput({ latex, fallback, label, className }: MathOutputProps) {
  const rendered = useMemo(() => {
    if (!latex.trim()) return null
    try {
      return katex.renderToString(latex, {
        displayMode: true,
        throwOnError: true,
        trust: false,
        strict: 'ignore',
        output: 'html'
      })
    } catch {
      return null // plain text is the fallback
    }
  }, [latex])

  if (!rendered) {
    return (
      <div className={`calc-math-fallback font-mono ${className ?? ''}`} data-testid="calc-math-fallback">
        {fallback}
      </div>
    )
  }

  return (
    <div
      className={`calc-math ${className ?? ''}`}
      role="img"
      aria-label={label ?? fallback}
      data-testid="calc-math"
      // KaTeX's own output for our LaTeX, with trust: false. Not user HTML.
      dangerouslySetInnerHTML={{ __html: rendered }}
    />
  )
}

export default MathOutput
