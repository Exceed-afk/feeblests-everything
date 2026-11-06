// docs/calculator-testing-guide.md — Section 9: Programming and number tools.
// Run on its own:  npx tsx tests/calc-guide-section9.ts
import {
  bitwiseAnd, bitwiseOr, bitwiseXor, bitwiseNot, bitwiseShiftLeft, bitwiseShiftRight,
  executeScript, twosView, parseProgramFile, serializeProgramFile
} from '../src/shared/calculator/modules/scripting'
import { openDatabase } from './sqlite'
import { applyMigrations } from '../src/main/migrations'
import { saveCalcProgram, listCalcPrograms, deleteCalcProgram } from '../src/main/calculator'
import { GuideSuite, finish, expectText, expectError, GuideMismatch } from './calc-guide-common'

export const suite = new GuideSuite('Section 9: Programming and number tools', 'Programming')

// ---------- Bitwise ----------
suite.test('12 AND 10', '12 AND 10', '8', () => expectText(bitwiseAnd(12, 10).toString(), '8'))
suite.test('12 OR 10', '12 OR 10', '14', () => expectText(bitwiseOr(12, 10).toString(), '14'))
suite.test('12 XOR 10', '12 XOR 10', '6', () => expectText(bitwiseXor(12, 10).toString(), '6'))
suite.test('NOT 12', 'NOT 12', '-13 (signed)', () => {
  // bitwiseNot returns the unsigned word (4294967283 in 32 bits); the signed reading is -13.
  const view = twosView(bitwiseNot(12), 32)
  return expectText(view.signed, '-13')
})
suite.test('1 << 4', '1 << 4', '16', () => expectText(bitwiseShiftLeft(1, 4).toString(), '16'))
suite.test('256 >> 2', '256 >> 2', '64', () => expectText(bitwiseShiftRight(256, 2).toString(), '64'))
suite.test('-8 >> 1', '-8 >> 1', '-4 (arithmetic shift)', () => expectText(bitwiseShiftRight(-8, 1).toString(), '-4'))
suite.test('8-bit two\'s complement of -1', '-1 in 8 bits', '11111111', () =>
  expectText(twosView(-1, 8).binary.replace(/\s/g, ''), '11111111'))
suite.test('0 AND anything', '0 AND 999999', '0', () => expectText(bitwiseAnd(0, 999999).toString(), '0'))
suite.test('Bitwise with decimals (2.5 AND 1)', '2.5 AND 1', 'Error', () =>
  expectError(() => bitwiseAnd('2.5', 1), /whole number/i))

// ---------- Custom functions ----------
suite.test('Define f(x) = x^2 + 1, then f(3)', 'fn f(x) { return x^2 + 1 }; f(3)', '10', () =>
  expectText(executeScript('fn f(x) {\n return x^2 + 1\n}\nreturn f(3)').returnValue, '10'))
suite.test('Define g(x) = f(x) * 2, then g(3)', 'g(x) = f(x) * 2; g(3)', '20', () =>
  expectText(executeScript('fn f(x) {\n return x^2 + 1\n}\nfn g(x) {\n return f(x) * 2\n}\nreturn g(3)').returnValue, '20'),
  'A script function body is run by a fresh executeScript, which does not receive the other functions, so f is undefined inside g')
suite.test('Redefine f: dependent results update', 'f(x) = x * 2; g(3)', '12', () =>
  expectText(executeScript('fn f(x) {\n return x * 2\n}\nfn g(x) {\n return f(x) * 2\n}\nreturn g(3)').returnValue, '12'),
  'Same cause: a function body cannot call another script function')
suite.test('Delete f: using it gives a clear "unknown function" message', 'delete f, then f(3)', 'Clear error', () => {
  // The script engine has no delete statement; a call to a function that was never
  // defined must still be a clear error rather than a crash.
  return expectError(() => executeScript('return f(3)'), /undefined function|unknown/i)
})
suite.test('Define h(a, b) = a * b: h(3, 4) = 12 and h(3) is an arity error', 'fn h(a, b)', '12 and an arity error', () => {
  const res = executeScript('fn h(a, b) {\n return a * b\n}\nreturn h(3, 4)')
  expectText(res.returnValue, '12')
  return expectError(() => executeScript('fn h(a, b) {\n return a * b\n}\nreturn h(3)'), /expects 2 arguments|arity/i)
})
suite.test('Recursion without an end condition stops with an error', 'f(n) = n * f(n - 1)', 'Stopped by a step or call limit, not a hang', () =>
  expectError(() => executeScript('fn f(n) {\n return n * f(n - 1)\n}\nreturn f(5)', { maxSteps: 500 }), /recursion depth exceeded|step limit/i))
suite.skip('Functions persist after restarting the app', 'restart', 'Functions restored', 'Needs a real app restart')

// ---------- Scripts and saved programs ----------
suite.test('Loop adding 1 to 100', 'sum 1..100', '5050', () =>
  expectText(executeScript('sum = 0\ni = 1\nwhile i <= 100 {\n sum = sum + i\n i = i + 1\n}\nreturn sum').returnValue, '5050'))
suite.test('10th Fibonacci number (1, 1, 2, 3, 5...)', 'fibonacci(10)', '55', () =>
  expectText(executeScript('a = 0\nb = 1\ncount = 10\nwhile count > 1 {\n temp = a + b\n a = b\n b = temp\n count = count - 1\n}\nreturn b').returnValue, '55'))
suite.test('Factorial of 6 using a loop', '6! by loop', '720', () =>
  expectText(executeScript('n = 6\nfact = 1\nwhile n > 1 {\n fact = fact * n\n n = n - 1\n}\nreturn fact').returnValue, '720'))
suite.test('Script with a syntax error', 'if {', 'A message that names the line', () =>
  expectError(() => executeScript('if { \n return 1'), /syntax error/i),
  'The condition is empty, so the parser reports "Empty expression at position 0" instead of naming the line')
suite.test('Endless loop (while true)', 'while 1 == 1', 'Stopped by a step or time limit with a message', () =>
  expectError(() => executeScript('while 1 == 1 {\n x = 1\n}', { maxSteps: 200 }), /step limit exceeded/i))
suite.test('Script trying to read files, open the network, or reach internals', 'require("fs")', 'Blocked', () =>
  expectError(() => executeScript('return require("fs")'), /syntax|unexpected|undefined/i))
suite.test('Script trying to reach the app internals (window / process)', 'window, process', 'Blocked', () => {
  expectError(() => executeScript('return window'), /undefined variable|unknown/i)
  return expectError(() => executeScript('return process'), /undefined variable|unknown/i)
})
suite.todo('Script producing huge output (a million lines)', 'a million lines of output', 'Capped, no freeze', 'The script engine returns one value; the console output cap lives in the panel')

// Saved programs: the storage layer (the panel itself is UI).
suite.test('Save a program, reopen: it is still there and still runs', 'save, reload from the database', 'Present and runs', () => {
  const db = openDatabase()
  applyMigrations(db)
  saveCalcProgram(db, { name: 'Sum', source: 'sum = 0\ni = 1\nwhile i <= 100 {\n sum = sum + i\n i = i + 1\n}\nreturn sum' })
  const programs = listCalcPrograms(db)
  if (programs.length !== 1) throw new GuideMismatch(`${programs.length} programs`)
  return expectText(executeScript(programs[0].source).returnValue, '5050')
})
suite.test('Rename and delete a program', 'rename, then delete', 'Renamed, then gone', () => {
  const db = openDatabase()
  applyMigrations(db)
  const p = saveCalcProgram(db, { name: 'Old', source: 'return 1' })
  saveCalcProgram(db, { id: p.id, name: 'New', source: 'return 1' })
  const renamed = listCalcPrograms(db)[0]
  if (renamed.name !== 'New') throw new GuideMismatch(renamed.name)
  deleteCalcProgram(db, p.id)
  return expectText(String(listCalcPrograms(db).length), '0')
})
suite.test('Export a program to a file and import it back', 'serialize, then parse', 'Same program', () => {
  const json = serializeProgramFile([{ name: 'Sum', source: 'return 1 + 1' }])
  const back = parseProgramFile(json, 'sum.json')
  return expectText(`${back.programs[0].name}: ${back.programs[0].source}`, 'Sum: return 1 + 1')
})
suite.test('Import a broken or malicious file: rejected or shown as text, never run', '{"programs": [{"name": 1}]}', 'Rejected', () =>
  expectError(() => parseProgramFile('{"programs": [{"name": 1}]}', 'bad.json'), /source/i))
suite.skip('Save a program, close the app, reopen: it is still there', 'restart', 'Persisted', 'Needs a real app restart')

finish(suite)
