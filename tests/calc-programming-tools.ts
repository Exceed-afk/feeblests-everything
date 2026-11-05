// Known-answer tests for the Phase 9 programming tools: two's complement views
// at each word size and program file import/export. Pure, no DOM:
//   tsx tests/calc-programming-tools.ts
import assert from 'node:assert/strict'
import { twosView, toSigned, parseProgValue, parseProgramFile, serializeProgramFile, programFileLimitBytes, WORD_SIZES } from '../src/shared/calculator/modules/scripting'
import { bitwiseNot } from '../src/shared/calculator/modules/scripting'
import { bitwiseShiftLeft } from '../src/shared/calculator/modules/scripting'
import { CALC_LIMITS } from '../src/shared/calculator/limits'

let count = 0
const ok = () => { count++ }
const messageOf = (fn: () => unknown): string => {
  try { fn(); return '' } catch (e) { return e instanceof Error ? e.message : String(e) }
}

// ---------- 8-bit ----------
{
  // 0xFF is -1 signed
  const v = twosView('0xFF', 8, true)
  assert.equal(v.signed, '-1'); ok()
  assert.equal(v.unsigned, '255'); ok()
  assert.equal(v.hex, 'FF'); ok()
  assert.equal(v.binary, '1111 1111'); ok()
  assert.equal(v.overflowed, false); ok()
}
{
  // 0x80 is -128 signed
  const v = twosView('0x80', 8)
  assert.equal(v.signed, '-128'); ok()
  assert.equal(v.unsigned, '128'); ok()
  assert.equal(v.hex, '80'); ok()
}
{
  // 0x7F is 127 signed, the signed maximum
  const v = twosView('0x7F', 8)
  assert.equal(v.signed, '127'); ok()
  assert.equal(v.unsigned, '127'); ok()
  assert.equal(v.overflowed, false); ok()
}
{
  // Signed input at the signed range edges
  assert.equal(twosView(-128, 8).hex, '80'); ok()
  assert.equal(twosView(127, 8).hex, '7F'); ok()
  // Overflow: 128 as signed wraps to -128, flagged
  const over = twosView(128, 8)
  assert.equal(over.signed, '-128'); ok()
  assert.equal(over.overflowed, true); ok()
  assert.equal(over.unsigned, '128'); ok()
  // -129 wraps to 127
  assert.equal(twosView(-129, 8).signed, '127'); ok()
  assert.equal(twosView(-129, 8).overflowed, true); ok()
  // Unsigned input: 255 is fine unsigned, overflow only for out-of-range
  const u = twosView(255, 8, false)
  assert.equal(u.signed, '-1'); ok()
  assert.equal(u.overflowed, false); ok()
  const uOver = twosView(256, 8, false)
  assert.equal(uOver.unsigned, '0'); ok()
  assert.equal(uOver.overflowed, true); ok()
  const uNeg = twosView(-1, 8, false)
  assert.equal(uNeg.unsigned, '255'); ok()
  assert.equal(uNeg.overflowed, true); ok()
}

// ---------- 16-bit ----------
// -1 in 16-bit is 0xFFFF
{
  const v = twosView(-1, 16)
  assert.equal(v.hex, 'FFFF'); ok()
  assert.equal(v.signed, '-1'); ok()
  assert.equal(v.unsigned, '65535'); ok()
  assert.equal(v.binary, '1111 1111 1111 1111'); ok()
}
{
  const v = twosView('0x8000', 16)
  assert.equal(v.signed, '-32768'); ok()
  assert.equal(twosView('0x7FFF', 16).signed, '32767'); ok()
}

// ---------- 32-bit ----------
{
  const v = twosView(-1, 32)
  assert.equal(v.hex, 'FFFFFFFF'); ok()
  assert.equal(twosView('0x80000000', 32).signed, '-2147483648'); ok()
  assert.equal(twosView('0x7FFFFFFF', 32).signed, '2147483647'); ok()
  assert.equal(twosView('0xDEADBEEF', 32).unsigned, '3735928559'); ok()
  assert.equal(twosView('0xDEADBEEF', 32).signed, '-559038737'); ok()
}

// ---------- 64-bit (exact, no float rounding) ----------
{
  const min = twosView(-9223372036854775808n, 64)
  assert.equal(min.hex, '8000000000000000'); ok()
  assert.equal(min.signed, '-9223372036854775808'); ok()
  assert.equal(min.unsigned, '9223372036854775808'); ok()
  assert.equal(min.overflowed, false); ok()
}
{
  const max = twosView(9223372036854775807n, 64)
  assert.equal(max.hex, '7FFFFFFFFFFFFFFF'); ok()
  assert.equal(max.signed, '9223372036854775807'); ok()
  assert.equal(max.overflowed, false); ok()
}
{
  // 2^63 wraps to the signed minimum, flagged
  const over = twosView(1n << 63n, 64)
  assert.equal(over.signed, '-9223372036854775808'); ok()
  assert.equal(over.overflowed, true); ok()
  // Values beyond double precision stay exact
  const big = twosView('0x7FFFFFFFFFFFFFFF', 64)
  assert.equal(big.signed, '9223372036854775807'); ok() // NOT a float 9223372036854776000
}

// ---------- negation and NOT at each width ----------
for (const bits of WORD_SIZES) {
  // Negation: -n wraps to 2^bits - n; NOT a = -a - 1 (mod 2^bits)
  const n = twosView(-1, bits)
  assert.equal(n.signed, '-1', `${bits}-bit -1`); ok()
  assert.equal(n.hex, 'F'.repeat(bits / 4), `${bits}-bit -1 hex`); ok()
  // NOT of 0 is all ones = -1 signed
  const notZero = twosView(bitwiseNot(0, bits), bits)
  assert.equal(notZero.signed, '-1', `${bits}-bit NOT 0`); ok()
  // NOT of 1 is ...1110 = -2 signed
  const notOne = twosView(bitwiseNot(1, bits), bits)
  assert.equal(notOne.signed, '-2', `${bits}-bit NOT 1`); ok()
  // Negation of the signed minimum is itself (wraps), flagged as overflow
  const min = -(1n << BigInt(bits - 1))
  const negMin = twosView(-min, bits)
  assert.equal(negMin.signed, min.toString(), `${bits}-bit negation of min wraps back`); ok()
  assert.equal(negMin.overflowed, true, `${bits}-bit negation of min overflowed`); ok()
  // SHL by 1 overflows when the top bit is set
  const shifted = twosView(bitwiseShiftLeft(1n << BigInt(bits - 1), 1, bits), bits)
  assert.equal(shifted.unsigned, '0', `${bits}-bit SHL of top bit wraps to 0`); ok()
}

// ---------- parsing ----------
assert.equal(parseProgValue(' 12 ').toString(), '12'); ok()
assert.equal(parseProgValue('-5').toString(), '-5'); ok()
assert.equal(parseProgValue('0xFF').toString(), '255'); ok()
assert.equal(parseProgValue('0Xff').toString(), '255'); ok()
assert.equal(parseProgValue('0b1010').toString(), '10'); ok()
assert.equal(parseProgValue('1_000').toString(), '1000'); ok()
assert.match(messageOf(() => parseProgValue('1.5')), /must be a decimal, 0x hex or 0b binary integer/); ok()
assert.match(messageOf(() => parseProgValue('abc')), /must be a decimal/); ok()
assert.match(messageOf(() => parseProgValue('')), /cannot be empty/); ok()
assert.match(messageOf(() => twosView(1, 12)), /Word size must be 8, 16, 32 or 64/); ok()

// ---------- program files ----------
// Plain text
{
  const f = parseProgramFile('return 42', 'myprog.txt')
  assert.equal(f.format, 'text'); ok()
  assert.equal(f.programs.length, 1); ok()
  assert.equal(f.programs[0].name, 'myprog'); ok()
  assert.equal(f.programs[0].source, 'return 42'); ok()
}
// JSON single program
{
  const f = parseProgramFile('{"name": "Square", "source": "return x * x"}', 'p.json')
  assert.equal(f.format, 'json'); ok()
  assert.equal(f.programs[0].name, 'Square'); ok()
}
// JSON list and {"programs": [...]}
{
  const f = parseProgramFile('[{"source": "return 1"}, {"source": "return 2"}]')
  assert.equal(f.programs.length, 2); ok()
  assert.equal(f.programs[0].name, 'Imported 1'); ok()
  const g = parseProgramFile('{"programs": [{"name": "A", "source": "s"}]}')
  assert.equal(g.programs[0].name, 'A'); ok()
}
// Bad JSON shape
assert.match(messageOf(() => parseProgramFile('{"name": "x"}', 'p.json')), /no programs/); ok()
assert.match(messageOf(() => parseProgramFile('{not json', 'p.json')), /not valid JSON/); ok()
assert.match(messageOf(() => parseProgramFile('{"programs": [{"source": 5}]}', 'p.json')), /"source" string/); ok()
assert.match(messageOf(() => parseProgramFile('{"programs": []}', 'p.json')), /contains no programs/); ok()
// Empty / oversize
assert.match(messageOf(() => parseProgramFile('   ', 'p.txt')), /empty/); ok()
assert.match(messageOf(() => parseProgramFile('x'.repeat(programFileLimitBytes() + 1), 'p.txt')), /import limit/); ok()
assert.match(messageOf(() => parseProgramFile('{"programs": [{"name": "big", "source": "' + 'x'.repeat(CALC_LIMITS.scriptLength + 1) + '"}]}', 'p.json')), /script length is limited/); ok()
// Round-trip export
{
  const text = serializeProgramFile([{ name: 'A', source: 'return 1' }, { name: 'B', source: 'return 2' }])
  const f = parseProgramFile(text, 'exported.json')
  assert.deepEqual(f.programs, [{ name: 'A', source: 'return 1' }, { name: 'B', source: 'return 2' }]); ok()
}

console.log(`ok   ${count} programming tool reference checks passed`)
