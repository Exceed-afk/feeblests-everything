// LaTeX for the calculator's results (rendered by KaTeX in the UI).
//
// Pure text in, LaTeX text out: no DOM, no KaTeX import here, so the rules are
// unit-testable and the renderer stays a thin wrapper. The output is always
// produced from the calculator's own text (CAS results, numbers), never from raw
// HTML, and the renderer calls KaTeX with `trust: false`.

import { toLatexResult } from './numeric'

/** Characters that would end the maths or start a command: escaped, never interpreted. */
function escapeText(text: string): string {
  // One pass, so the replacement text is never escaped again.
  return text.replace(/[\\{}%$#&_^~<>]/g, (ch) => {
    if (ch === '\\') return '\\textbackslash{}'
    if (ch === '^') return '\\^{}'
    if (ch === '~') return '\\~{}'
    if (ch === '<') return '\\textless{}'
    if (ch === '>') return '\\textgreater{}'
    return `\\${ch}`
  })
}

/**
 * CAS output (`x^3 + 4*x^2 - 7`, `(1/2)*x^2`, `sin(x)`) as LaTeX.
 * Only the calculator's own operators are rewritten; anything else is escaped.
 */
export function casToLatex(text: string): string {
  const trimmed = text.trim()
  if (!trimmed) return ''
  let out = ''
  let i = 0
  while (i < trimmed.length) {
    const ch = trimmed[i]
    if (ch === '*') {
      out += ' \\cdot '
      i++
      continue
    }
    if (ch === '^') {
      // The exponent is the next number, identifier or parenthesised group.
      i++
      if (trimmed[i] === '(') {
        let depth = 0
        let j = i
        for (; j < trimmed.length; j++) {
          if (trimmed[j] === '(') depth++
          else if (trimmed[j] === ')') {
            depth--
            if (depth === 0) break
          }
        }
        out += `^{${casToLatex(trimmed.slice(i + 1, j))}}`
        i = j + 1
      } else {
        let j = i
        while (j < trimmed.length && /[A-Za-z0-9.]/.test(trimmed[j])) j++
        out += `^{${casToLatex(trimmed.slice(i, j))}}`
        i = j
      }
      continue
    }
    if (ch === '/') {
      out += '/'
      i++
      continue
    }
    if (/[A-Za-z]/.test(ch)) {
      let j = i
      while (j < trimmed.length && /[A-Za-z]/.test(trimmed[j])) j++
      const word = trimmed.slice(i, j)
      // Known function names stay upright; single letters are variables.
      if (['sin', 'cos', 'tan', 'ln', 'log', 'exp', 'sqrt'].includes(word)) out += `\\${word}`
      else out += escapeText(word)
      i = j
      continue
    }
    out += escapeText(ch)
    i++
  }
  return out
}

/**
 * The LaTeX shown for a result. Numbers go through the existing toLatexResult
 * (fractions and scientific notation); CAS text goes through casToLatex.
 */
export function resultToLatex(text: string, kind: 'number' | 'cas' = 'number'): string {
  return kind === 'cas' ? casToLatex(text) : toLatexResult(text)
}
