// LaTeX for rendered maths output (KaTeX in the UI).
// The builder is pure text -> text; these tests check the normal case, the
// escaping edge case, and that nothing user-typed can become a command.
import assert from 'node:assert/strict'
import { casToLatex, resultToLatex } from '../src/shared/calculator/latex'

let checks = 0
const ok = () => { checks++ }

// ---------- Normal case ----------
assert.equal(casToLatex('x^3 + 4*x^2 - 7'), 'x^{3} + 4 \\cdot x^{2} - 7'); ok()
assert.equal(casToLatex('(1/2)*x^2'), '(1/2) \\cdot x^{2}'); ok()
assert.equal(casToLatex('sin(x)'), '\\sin(x)'); ok()
assert.equal(casToLatex('x^(n+1)'), 'x^{n+1}'); ok()
assert.equal(casToLatex(''), ''); ok()

// Numbers keep the existing copy-out rules (fractions, scientific notation).
assert.equal(resultToLatex('-3/4'), '-\\frac{3}{4}'); ok()
assert.equal(resultToLatex('1.5e+6'), '1.5 \\times 10^{6}'); ok()
assert.equal(resultToLatex('x^2', 'cas'), 'x^{2}'); ok()

// ---------- Edge case: escaping ----------
// A backslash, braces, percent, dollar, ampersand, underscore and caret in text
// are escaped, never passed through as a command or a maths delimiter.
const escaped = casToLatex('a\\b{c}%d$e&f_g^h')
assert.ok(!/(^|[^\\])\{c\}/.test(escaped.replace(/\\\{/g, '')), 'braces are escaped'); ok()
assert.ok(escaped.includes('\\%'), 'percent is escaped'); ok()
assert.ok(escaped.includes('\\$'), 'dollar is escaped'); ok()
assert.ok(escaped.includes('\\&'), 'ampersand is escaped'); ok()
assert.ok(escaped.includes('\\_'), 'underscore is escaped'); ok()
assert.ok(escaped.includes('\\textbackslash{}'), 'backslash is escaped'); ok()
// No raw HTML can come out of the builder.
assert.ok(!casToLatex('<script>alert(1)</script>').includes('<script>')); ok()

// ---------- Rejected / safe input ----------
// An unbalanced exponent group does not throw and does not swallow the rest.
assert.doesNotThrow(() => casToLatex('x^(2')); ok()
assert.equal(casToLatex('x^(2'), 'x^{2}'); ok()
// A lone caret at the end is harmless.
assert.doesNotThrow(() => casToLatex('x^')); ok()

console.log(`ok   ${checks} LaTeX output checks passed`)
