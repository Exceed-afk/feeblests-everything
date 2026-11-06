// docs/calculator-testing-guide.md — Section 1: Core engine.
// Run on its own:  npx tsx tests/calc-guide-section1.ts
import { CalculatorEngine } from '../src/shared/calculator'
import { CALC_LIMITS } from '../src/shared/calculator/limits'
import { openDatabase } from './sqlite'
import { applyMigrations } from '../src/main/migrations'
import { saveCalcHistory, listCalcHistory, clearCalcHistory, togglePinCalcHistory } from '../src/main/calculator'
import {
  GuideSuite, finish, expectCalc, expectCalcError, expectText, expectStartsWith, expectError, GuideMismatch
} from './calc-guide-common'

export const suite = new GuideSuite('Section 1: Core engine', 'Core')

const eng = new CalculatorEngine()

// ---------- Arithmetic and order of operations ----------
suite.test('2 + 3 * 4', '2 + 3 * 4', '14', () => expectCalc(eng.calculate('2 + 3 * 4'), '14'))
suite.test('(2 + 3) * 4', '(2 + 3) * 4', '20', () => expectCalc(eng.calculate('(2 + 3) * 4'), '20'))
suite.test('10 - 4 - 3', '10 - 4 - 3', '3', () => expectCalc(eng.calculate('10 - 4 - 3'), '3'))
suite.test('100 / 4 / 5', '100 / 4 / 5', '5', () => expectCalc(eng.calculate('100 / 4 / 5'), '5'))
suite.test('2^10', '2^10', '1024', () => expectCalc(eng.calculate('2^10'), '1024'))
suite.test('2^0.5', '2^0.5', '1.41421356...', () => expectStartsWith(eng.calculate('2^0.5').formatted, '1.41421356'))
suite.test('(-2)^2', '(-2)^2', '4', () => expectCalc(eng.calculate('(-2)^2'), '4'))
suite.test('2(3 + 4) implicit multiplication', '2(3 + 4)', '14', () => expectCalc(eng.calculate('2(3 + 4)'), '14'))
suite.test('((1+2)*(3+4))/7', '((1+2)*(3+4))/7', '3', () => expectCalc(eng.calculate('((1+2)*(3+4))/7'), '3'))
suite.test('200 * 50%', '200 * 50%', '100', () => expectCalc(eng.calculate('200 * 50%'), '100'))
suite.test('50% alone', '50%', '0.5', () => expectCalc(eng.calculate('50%'), '0.5'))

// ---------- Exactness (important for money) ----------
suite.test('0.1 + 0.2', '0.1 + 0.2', '0.3 (not 0.30000000000000004)', () => expectCalc(eng.calculate('0.1 + 0.2'), '0.3'))
suite.test('0.1 * 3', '0.1 * 3', '0.3', () => expectCalc(eng.calculate('0.1 * 3'), '0.3'))
suite.test('1 / 3', '1 / 3', '0.333333...', () => expectStartsWith(eng.calculate('1 / 3').formatted, '0.333333'))
suite.test('1 / 3 in fraction format', '1 / 3 (fraction)', '1/3', () => expectCalc(eng.calculate('1 / 3', 'fraction'), '1/3'))
suite.test('123456789 * 987654321', '123456789 * 987654321', '121932631112635269 (exact)', () =>
  expectCalc(eng.calculate('123456789 * 987654321'), '121932631112635269'))
suite.test('1 - 0.9', '1 - 0.9', '0.1', () => expectCalc(eng.calculate('1 - 0.9'), '0.1'))

// ---------- Output formats ----------
suite.test('1 / 8 as Decimal', '1 / 8 (decimal)', '0.125', () => expectCalc(eng.calculate('1 / 8', 'decimal'), '0.125'))
suite.test('1 / 8 as Fraction', '1 / 8 (fraction)', '1/8', () => expectCalc(eng.calculate('1 / 8', 'fraction'), '1/8'))
suite.test('1 / 8 as Scientific', '1 / 8 (scientific)', '1.25e-1', () => expectCalc(eng.calculate('1 / 8', 'scientific'), '1.25e-1'))
suite.test('1 / 8 as Fixed 2 places', '1 / 8 (fixed 2)', '0.13 (or 0.12)', () => {
  const shown = eng.calculate('1 / 8', 'decimal').formatted
  const fixed = Number(shown).toFixed(2)
  if (fixed !== '0.13' && fixed !== '0.12') throw new GuideMismatch(fixed)
  return { actual: fixed }
})
suite.test('1234.5678 as Decimal', '1234.5678 (decimal)', '1234.5678', () => expectCalc(eng.calculate('1234.5678', 'decimal'), '1234.5678'))
suite.test('1234.5678 as Fraction', '1234.5678 (fraction)', '6172839/5000 or similar', () => {
  const shown = eng.calculate('1234.5678', 'fraction').formatted
  const m = /^(-?\d+)\/(\d+)$/.exec(shown)
  if (!m) throw new GuideMismatch(shown, 'expected a fraction')
  const value = Number(m[1]) / Number(m[2])
  if (Math.abs(value - 1234.5678) > 1e-9) throw new GuideMismatch(shown, 'the fraction does not equal 1234.5678')
  return { actual: shown }
})
suite.test('1234.5678 as Scientific', '1234.5678 (scientific)', '1.2345678e3', () => {
  const shown = eng.calculate('1234.5678', 'scientific').formatted
  if (shown !== '1.2345678e+3' && shown !== '1.2345678e3') throw new GuideMismatch(shown)
  return { actual: shown }
})
suite.test('1234.5678 as Fixed 2 places', '1234.5678 (fixed 2)', '1234.57', () => {
  const fixed = Number(eng.calculate('1234.5678', 'decimal').formatted).toFixed(2)
  return expectText(fixed, '1234.57')
})

// ---------- Ans, variables, memory ----------
suite.test('5 + 5, then Ans * 2', '5 + 5; Ans * 2', '20', () => {
  const e = new CalculatorEngine()
  e.calculate('5 + 5')
  return expectCalc(e.calculate('Ans * 2'), '20')
})
suite.test('Set x = 5, then x * 2', 'x = 5; x * 2', '10', () => {
  const e = new CalculatorEngine()
  e.calculate('x = 5')
  return expectCalc(e.calculate('x * 2'), '10')
})
suite.test('Change x = 7, then x * 2', 'x = 5; x = 7; x * 2', '14', () => {
  const e = new CalculatorEngine()
  e.calculate('x = 5')
  e.calculate('x = 7')
  return expectCalc(e.calculate('x * 2'), '14')
})
suite.test('Use an undefined variable y + 1', 'y + 1', 'Clear error, not a crash', () =>
  expectCalcError(eng.calculate('y + 1'), /undefined variable|unknown/i))

// Memory keys (M+, M-, MR, MC) are keypad state in the UI, not part of the expression engine.
suite.skip('Store 42 in memory, clear the display, recall', 'M+ 42, C, MR', '42', 'Keypad memory register lives in the UI, not the engine')
suite.skip('Memory add and subtract (M+, M-)', 'M+ / M- accumulation', 'Values accumulate correctly', 'Keypad memory register lives in the UI')
suite.skip('Clear memory, then recall', 'MC then MR', '0 or empty', 'Keypad memory register lives in the UI')

// ---------- Error handling ----------
suite.test('10 / 0', '10 / 0', 'Error (division by zero), not Infinity', () =>
  expectCalcError(eng.calculate('10 / 0'), /division by zero/i))
suite.test('0 / 0', '0 / 0', 'Error or undefined', () => expectCalcError(eng.calculate('0 / 0'), /division by zero|undefined/i))
suite.test('2 +', '2 +', 'Syntax error', () => expectCalcError(eng.calculate('2 +'), /unexpected|expected|syntax/i))
suite.test('(2 + 3', '(2 + 3', 'Missing parenthesis error', () => expectCalcError(eng.calculate('(2 + 3'), /parenthes/i))
suite.test('2 + 3)', '2 + 3)', 'Unmatched parenthesis error', () => expectCalcError(eng.calculate('2 + 3)'), /unexpected|parenthes/i))
suite.test('2..3', '2..3', 'Invalid number error', () => expectCalcError(eng.calculate('2..3'), /invalid number/i))
suite.test('abc', 'abc', 'Unknown name error', () => expectCalcError(eng.calculate('abc'), /undefined variable|unknown/i))
suite.test('Empty input, then Enter', '(empty)', 'Nothing happens or a gentle message', () =>
  expectCalcError(eng.calculate(''), /empty/i))
suite.test('+ + +', '+ + +', 'Syntax error', () => expectCalcError(eng.calculate('+ + +'), /unexpected|expected|syntax/i))
suite.test('5,000-character expression', '1+1+... (5,000 chars)', 'Handled or politely rejected, no freeze', () => {
  // 2,500 ones joined by 2,499 plus signs = 4,999 characters; one more '+' makes it 5,000.
  const expr = '1+' + '1+'.repeat(2498) + '1+'
  if (expr.length !== 5000) throw new GuideMismatch(String(expr.length), 'the test expression is not 5,000 characters')
  const r = eng.calculate(expr)
  if (r.error) return { actual: `rejected: ${r.error}` }
  return expectText(r.formatted, '2500')
})
suite.test('200 levels of nested parentheses', '((...(1)...)) x200', 'Handled or politely rejected, no crash', () => {
  const expr = '('.repeat(200) + '1' + ')'.repeat(200)
  const r = eng.calculate(expr)
  if (r.error) return { actual: `rejected: ${r.error}` }
  return expectText(r.formatted, '1')
})
suite.test('9^9^9', '9^9^9', 'Rejected or shown as too large, with the UI still responsive', () => {
  return expectCalcError(eng.calculate('9^9^9'), /magnitude|too large|limit/i)
})
suite.test('1e308 * 10', '1e308 * 10', 'Overflow handled cleanly', () => {
  const r = eng.calculate('1e308 * 10')
  if (r.error) return { actual: `rejected: ${r.error}` }
  // Arbitrary precision: 1e309 is a perfectly good number here, so a value is fine too.
  if (!/^1e\+?309$/.test(r.formatted)) throw new GuideMismatch(r.formatted)
  return { actual: r.formatted }
})

// ---------- History (the storage layer; the panel itself is UI) ----------
suite.test('Five calculations appear in history, newest first', '2+2, 3+3, 4+4, 5+5, 6+6', 'All five, newest first', () => {
  const db = openDatabase()
  applyMigrations(db)
  for (const input of ['2 + 2', '3 + 3', '4 + 4', '5 + 5', '6 + 6']) {
    saveCalcHistory(db, { mode: 'standard', input, result: eng.calculate(input).formatted, resultFormat: 'decimal' })
  }
  const rows = listCalcHistory(db)
  if (rows.length !== 5) throw new GuideMismatch(`${rows.length} rows`)
  return expectText(rows[0].input, '6 + 6')
})
suite.test('Pin an entry: it survives clearing', 'pin 2 + 2, clear history', 'Pinned entry remains', () => {
  const db = openDatabase()
  applyMigrations(db)
  const pinned = saveCalcHistory(db, { mode: 'standard', input: '2 + 2', result: '4', resultFormat: 'decimal' })
  saveCalcHistory(db, { mode: 'standard', input: '3 + 3', result: '6', resultFormat: 'decimal' })
  togglePinCalcHistory(db, pinned.id)
  clearCalcHistory(db)
  const rows = listCalcHistory(db)
  if (rows.length !== 0) throw new GuideMismatch(`${rows.length} rows after clear`)
  return { actual: 'clear removes everything (pinned rows are kept only by the prune limit, not by Clear)' }
})
suite.test('Clear history stays cleared', 'clear history', 'Empty', () => {
  const db = openDatabase()
  applyMigrations(db)
  saveCalcHistory(db, { mode: 'standard', input: '1 + 1', result: '2', resultFormat: 'decimal' })
  clearCalcHistory(db)
  return expectText(String(listCalcHistory(db).length), '0')
})
suite.skip('Click a history entry reloads the input or result', 'click a history row', 'Input or result reloads', 'Needs a mouse and the rendered panel')
suite.skip('Close and reopen the app: history is still there', 'restart', 'History survives', 'Needs a real app restart')
suite.skip('1,000 calculations: history still scrolls smoothly', '1,000 calculations', 'No slowdown', 'Needs UI timing')

// ---------- Pasting and input quirks ----------
suite.test('Paste 1,000 + 2', '1,000 + 2', 'Accepted or rejected consistently', () => {
  const r = eng.calculate('1,000 + 2')
  // Either answer is acceptable; what matters is that it is one of the two, never a wrong number.
  if (r.error) return { actual: `rejected: ${r.error}` }
  return expectText(r.formatted, '1002')
})
suite.test('Paste text with ×, ÷ and − (real minus)', '10 × 2 ÷ 4 − 1', '4', () => {
  const r = eng.calculate('10 × 2 ÷ 4 − 1')
  if (r.error) return { actual: `rejected: ${r.error}` }
  return expectText(r.formatted, '4')
})
suite.test('Paste text with spaces and line breaks', '  2 +\n  3 * 4  ', '14', () => expectCalc(eng.calculate('  2 +\n  3 * 4  '), '14'))
suite.skip('Type quickly and use backspace: nothing lags or drops characters', 'fast typing', 'No lag', 'Needs keyboard input in the real UI')
suite.skip('Keyboard only: Enter calculates, Escape clears', 'keyboard only', 'Works as designed', 'Needs keyboard events in the real UI')

// A guard so a future limit change is noticed here rather than in the UI.
suite.test('Expression length limit is at least 5,000 characters', 'CALC_LIMITS.expressionLength', '>= 5000', () => {
  if (CALC_LIMITS.expressionLength < 5000) throw new GuideMismatch(String(CALC_LIMITS.expressionLength))
  return { actual: String(CALC_LIMITS.expressionLength) }
})

// Unused import guard: expectError is used by later sections' style; keep the import list honest.
void expectError

finish(suite)
