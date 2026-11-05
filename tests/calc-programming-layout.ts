// Layout QA for the Programming panel's new states (Phase 9): two's complement
// grid geometry, overflow messaging, program CRUD flows and import validation.
// Pure, no DOM:   tsx tests/calc-programming-layout.ts
import assert from 'node:assert/strict'
import { twosView, parseProgramFile, programFileLimitBytes, WORD_SIZES, type TwosView } from '../src/shared/calculator/modules/scripting'

let n = 0
const test = (name: string, fn: () => void) => { fn(); n++; console.log('ok  ', name) }

// The grid shows four cells side by side (2 columns on narrow screens). The
// data must exist for every width and every interpretation, and hex/binary must
// always match the unsigned column (the same word, two readings).
const rowsMatch = (v: TwosView) => {
  const bits = BigInt(v.bits)
  const unsigned = BigInt(v.unsigned)
  assert.ok(unsigned >= 0n && unsigned < 1n << bits, 'unsigned in range')
  assert.equal(BigInt('0x' + v.hex), unsigned, 'hex matches the unsigned word')
  assert.equal(BigInt('0b' + v.binary.replace(/ /g, '')), unsigned, 'binary matches the unsigned word')
  const half = 1n << (bits - 1n)
  assert.equal(BigInt(v.signed), unsigned >= half ? unsigned - (1n << bits) : unsigned, 'signed matches two\u2019s complement')
}

test('the four-column view is complete and self-consistent at every width', () => {
  const samples: bigint[] = [0n, 1n, 255n, 256n, -1n, -(1n << 63n), (1n << 63n) - 1n, 1n << 64n]
  for (const bits of WORD_SIZES) {
    for (const s of samples) {
      for (const signedInput of [true, false]) {
        rowsMatch(twosView(s, bits, signedInput))
      }
    }
  }
})

test('overflow is detected exactly at the range boundaries', () => {
  for (const bits of WORD_SIZES) {
    const lo = -(1n << BigInt(bits - 1))
    const hi = (1n << BigInt(bits - 1)) - 1n
    assert.equal(twosView(lo, bits).overflowed, false, `signed min ${lo} at ${bits} fits`)
    assert.equal(twosView(hi, bits).overflowed, false, `signed max ${hi} at ${bits} fits`)
    assert.equal(twosView(lo - 1n, bits).overflowed, true, `signed min - 1 overflows at ${bits}`)
    assert.equal(twosView(hi + 1n, bits).overflowed, true, `signed max + 1 overflows at ${bits}`)
    assert.equal(twosView(hi, bits, false).overflowed, false, `unsigned max ${hi} in unsigned mode fits`)
    assert.equal(twosView(lo, bits, false).overflowed, true, `signed min in unsigned mode overflows`)
  }
})

test('the overflow note has the numbers it needs', () => {
  const v = twosView(300, 8)
  assert.equal(v.overflowed, true)
  assert.equal(v.signed, '44') // the wrapped reading shown next to the note
  assert.equal(v.input, '300') // the typed value quoted in the note
})

test('program import validation covers the documented failure modes', () => {
  const msg = (fn: () => unknown) => {
    try { fn(); return '' } catch (e) { return e instanceof Error ? e.message : String(e) }
  }
  // bad JSON
  assert.match(msg(() => parseProgramFile('{oops', 'p.json')), /not valid JSON/)
  // wrong JSON shape
  assert.match(msg(() => parseProgramFile('{"name": "x"}', 'p.json')), /no programs/)
  // empty
  assert.match(msg(() => parseProgramFile('', 'p.txt')), /empty/)
  // oversize (file cap and per-program cap)
  assert.match(msg(() => parseProgramFile('x'.repeat(programFileLimitBytes() + 1), 'p.txt')), /import limit/)
  const bigProgram = JSON.stringify({ programs: [{ name: 'big', source: 'x'.repeat(20_001) }] })
  assert.match(msg(() => parseProgramFile(bigProgram, 'p.json')), /script length is limited/)
  // binary garbage (decodes with replacement chars) is still text-shape-checked
  const garbage = '\uFFFD\uFFFD\uFFFD'
  assert.doesNotThrow(() => parseProgramFile(garbage, 'p.txt'), 'readability is the renderer\u2019s check; the parser only needs text')
})

test('imported programs always parse to reviewable editor content, never run', () => {
  // Contract check: parseProgramFile returns source strings only — there is no
  // execution path in the module. The renderer assigns the source to the
  // editor; the Run button is the only way code is executed.
  for (const text of ['return 999', '{"programs":[{"name":"A","source":"while true { x = 1 }"}]}']) {
    const f = parseProgramFile(text, 'p')
    for (const p of f.programs) {
      assert.equal(typeof p.source, 'string')
      assert.ok(p.source.length <= 20_000)
    }
  }
})

console.log(`\n${n} programming layout checks passed`)
