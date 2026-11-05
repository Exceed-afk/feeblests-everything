import assert from 'node:assert/strict'
import {
  bitwiseAnd,
  bitwiseOr,
  bitwiseXor,
  bitwiseNot,
  bitwiseShiftLeft,
  bitwiseShiftRight,
  formatBinaryWord,
  parseBinaryWord,
  executeScript,
  type ScriptContext
} from '../src/shared/calculator/modules/scripting'

let checks = 0
const ok = () => { checks++ }

// ---------- 1. Bitwise Operations (Arbitrary Width & Words) ----------
// 12 & 10 = 8 (1100 & 1010 = 1000)
assert.equal(bitwiseAnd(12n, 10n), 8n); ok()
// 12 | 10 = 14 (1100 | 1010 = 1110)
assert.equal(bitwiseOr(12n, 10n), 14n); ok()
// 12 ^ 10 = 6  (1100 ^ 1010 = 0110)
assert.equal(bitwiseXor(12n, 10n), 6n); ok()

// Bitwise NOT with 8-bit word size: ~0x0F = 0xF0 (240)
assert.equal(bitwiseNot(0x0fn, 8), 0xf0n); ok()
// Bitwise NOT with 16-bit word size: ~0x00FF = 0xFF00
assert.equal(bitwiseNot(0x00ffn, 16), 0xff00n); ok()

// Shifts
// 1 << 4 = 16
assert.equal(bitwiseShiftLeft(1n, 4, 16), 16n); ok()
// 16 >> 2 = 4
assert.equal(bitwiseShiftRight(16n, 2), 4n); ok()
// Left shift overflow clamped to word size (8-bit): 0x80 << 1 = 0x00
assert.equal(bitwiseShiftLeft(0x80n, 1, 8), 0x00n); ok()

// Binary Word Formatting
assert.equal(formatBinaryWord(0x0fn, 8), '0000 1111'); ok()
assert.equal(formatBinaryWord(0x1234n, 16), '0001 0010 0011 0100'); ok()

// Binary Word Parsing
assert.equal(parseBinaryWord('0000 1111'), 15n); ok()
assert.equal(parseBinaryWord('1111_0000'), 240n); ok()

// ---------- 2. Sandboxed Scripting Language ----------
// Simple arithmetic & variable assignment
const script1 = `
x = 10
y = 20
return x + y
`
const res1 = executeScript(script1)
assert.equal(res1.returnValue, '30'); ok()

// Conditionals (if / else)
const script2 = `
a = 15
if a > 10 {
  res = 100
} else {
  res = 200
}
return res
`
const res2 = executeScript(script2)
assert.equal(res2.returnValue, '100'); ok()

// While loop (factorial of 5: 5! = 120)
const script3 = `
n = 5
fact = 1
while n > 1 {
  fact = fact * n
  n = n - 1
}
return fact
`
const res3 = executeScript(script3)
assert.equal(res3.returnValue, '120'); ok()

// Fibonacci sequence (10th Fibonacci number = 55)
const script4 = `
a = 0
b = 1
count = 10
while count > 1 {
  temp = a + b
  a = b
  b = temp
  count = count - 1
}
return b
`
const res4 = executeScript(script4)
assert.equal(res4.returnValue, '55'); ok()

// Security & infinite loop step limit protection
const runawayScript = `
i = 0
while 1 == 1 {
  i = i + 1
}
`
assert.throws(() => executeScript(runawayScript, { maxSteps: 500 }), /Step limit exceeded/); ok()

// Custom function definition & call
const scriptFunc = `
fn double(x) {
  return x * 2
}
return double(21)
`
const resFunc = executeScript(scriptFunc)
assert.equal(resFunc.returnValue, '42'); ok()

console.log(`ok   ${checks} programming & scripting tests passed`)
