// Two's complement views and program-file import/export for the Programming
// panel (Phase 9). Pure numeric/text logic: no DOM, no colours, no execution.
//
// Everything uses BigInt, so 64-bit values are exact (never a float). Overflow
// behaviour is wrapping: a value outside the word is reduced modulo 2^bits into
// the word, and the result reports overflowed: true so the UI can say so.
import { CALC_LIMITS, limitMessage } from '../../limits'
import { CalcError } from '../../errors'
import { toStringInput } from '../../inputs'

export const WORD_SIZES = [8, 16, 32, 64] as const
export type WordSize = (typeof WORD_SIZES)[number]

function wordSize(bits: unknown): WordSize {
  const n = Number(bits)
  if (!(WORD_SIZES as readonly number[]).includes(n)) {
    throw new CalcError('Word size must be 8, 16, 32 or 64 bits')
  }
  return n as WordSize
}

export interface TwosView {
  bits: WordSize
  /** Value wrapped into the word, as an unsigned integer 0 .. 2^bits-1. */
  unsigned: string
  /** The same bits read as a two's complement signed integer. */
  signed: string
  /** Zero-padded hex of the unsigned word (uppercase, no prefix). */
  hex: string
  /** Zero-padded binary of the unsigned word, nibble-grouped. */
  binary: string
  /** True when the given value did not fit the chosen interpretation range and was wrapped. */
  overflowed: boolean
  /** The exact value the user typed, before wrapping (for the overflow note). */
  input: string
}

/**
 * Parse a value written as decimal ("12", "-5"), hex ("0xFF", "0Xff") or
 * binary ("0b1010", "0B1010"). Whitespace and _ separators allowed.
 */
export function parseProgValue(text: unknown, what = 'value'): bigint {
  if (typeof text === 'bigint') return text
  if (typeof text === 'number') {
    if (!Number.isInteger(text)) throw new CalcError(`${what} must be a whole number`)
    return BigInt(text)
  }
  const raw = toStringInput(text, what).replace(/[\s_]/g, '')
  if (/^[+-]?0[xX][0-9a-fA-F]+$/.test(raw)) return BigInt(raw)
  if (/^[+-]?0[bB][01]+$/.test(raw)) return BigInt(raw)
  if (/^[+-]?\d+$/.test(raw)) return BigInt(raw)
  throw new CalcError(`${what} must be a decimal, 0x hex or 0b binary integer (got "${raw.slice(0, 32)}")`)
}

function mask(bits: number): bigint {
  return (1n << BigInt(bits)) - 1n
}

/** Read an unsigned word as a two's complement signed integer. */
export function toSigned(unsigned: bigint, bits: number): bigint {
  const half = 1n << BigInt(bits - 1)
  return unsigned >= half ? unsigned - (1n << BigInt(bits)) : unsigned
}

/**
 * The full side-by-side view for one value at one word size.
 *
 * Interpretation: with signedInput the decimal value is read as a two's
 * complement integer in [-2^(bits-1), 2^(bits-1)-1]; with unsigned input it is
 * read as [0, 2^bits-1]. Anything outside that range is wrapped modulo 2^bits
 * (documented overflow behaviour) and overflowed is set.
 */
export function twosView(value: bigint | number | string, bits: number | string, signedInput = true): TwosView {
  const size = wordSize(bits)
  const raw = typeof value === 'bigint' ? value : parseProgValue(value)
  const m = mask(size)
  let wrapped: bigint
  let overflowed: boolean
  if (signedInput) {
    const lo = -(1n << BigInt(size - 1))
    const hi = (1n << BigInt(size - 1)) - 1n
    // Hex/binary input (0x…, 0b…) names a bit pattern directly, never overflows.
    const isPattern = /^[+-]?0[xXbB]/.test(String(value).replace(/[\s_]/g, ''))
    overflowed = !isPattern && (raw < lo || raw > hi)
    wrapped = ((raw % (m + 1n)) + (m + 1n)) % (m + 1n) // wrap into 0..2^bits-1
  } else {
    overflowed = raw < 0n || raw > m
    wrapped = raw < 0n ? ((raw % (m + 1n)) + (m + 1n)) % (m + 1n) : raw & m
  }
  const hex = wrapped.toString(16).toUpperCase().padStart(size / 4, '0')
  const binary = wrapped.toString(2).padStart(size, '0').replace(/\B(?=(\d{4})+(?!\d))/g, ' ')
  return {
    bits: size,
    unsigned: wrapped.toString(10),
    signed: toSigned(wrapped, size).toString(10),
    hex,
    binary,
    overflowed,
    input: raw.toString(10)
  }
}

// ---------- Program files (.txt / .json) ----------

export interface ExportedProgram {
  name: string
  source: string
}

export interface ProgramFile {
  programs: ExportedProgram[]
  /** Whether the file was the JSON shape or a plain .txt script. */
  format: 'json' | 'text'
}

/** Hard cap for one imported program file, from the limits file (script length). */
export function programFileLimitBytes(): number {
  return CALC_LIMITS.scriptLength * 4 // a few programs of the max script size each
}

/**
 * Parse an imported program file. Accepts either:
 *  - a JSON document {"programs": [{"name": "...", "source": "..."}, ...]} or
 *    a single {"name": "...", "source": "..."} object, or
 *  - plain script text (the whole file is one unnamed program).
 * Size limit (from CALC_LIMITS), readable text and JSON shape are validated.
 * The returned source is NEVER executed by the caller — it opens in the editor.
 */
export function parseProgramFile(text: string, fileName = 'program'): ProgramFile {
  if (typeof text !== 'string') throw new CalcError('Program file must be text')
  const limit = programFileLimitBytes()
  if (text.length > limit) {
    throw new CalcError(`${fileName} is ${text.length.toLocaleString('en-US')} characters; the import limit is ${limit.toLocaleString('en-US')} (${limitMessage('scriptLength', 'characters')})`)
  }
  const trimmed = text.trim()
  if (trimmed.length === 0) throw new CalcError(`${fileName} is empty`)

  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    let parsed: unknown
    try {
      parsed = JSON.parse(trimmed)
    } catch (e) {
      throw new CalcError(`${fileName} is not valid JSON: ${e instanceof Error ? e.message : 'parse error'}`)
    }
    const asList = Array.isArray(parsed)
      ? parsed
      : isRecord(parsed) && Array.isArray((parsed as { programs?: unknown }).programs)
        ? (parsed as { programs: unknown[] }).programs
        : isRecord(parsed) && typeof (parsed as { source?: unknown }).source === 'string'
          ? [parsed]
          : null
    if (!asList) {
      throw new CalcError(`${fileName} is JSON but has no programs: expected {"programs": [{"name", "source"}]} or {"name", "source"}`)
    }
    const programs: ExportedProgram[] = []
    for (const [i, entry] of asList.entries()) {
      if (!isRecord(entry) || typeof entry.source !== 'string') {
        throw new CalcError(`${fileName}: program ${i + 1} must be an object with a "source" string`)
      }
      const name = typeof entry.name === 'string' && entry.name.trim() ? entry.name.trim() : `Imported ${i + 1}`
      const source = entry.source
      if (source.length > CALC_LIMITS.scriptLength) {
        throw new CalcError(`${fileName}: program "${name}" is over the ${limitMessage('scriptLength', 'characters')}`)
      }
      programs.push({ name, source })
    }
    if (programs.length === 0) throw new CalcError(`${fileName} contains no programs`)
    return { programs, format: 'json' }
  }

  // Plain text: one script, named after the file.
  if (trimmed.length > CALC_LIMITS.scriptLength) {
    throw new CalcError(`${fileName} is over the ${limitMessage('scriptLength', 'characters')}`)
  }
  const base = fileName.replace(/\.(txt|json)$/i, '').trim()
  return { programs: [{ name: base || 'Imported program', source: trimmed }], format: 'text' }
}

/** The JSON text written by the export button. */
export function serializeProgramFile(programs: ExportedProgram[]): string {
  return JSON.stringify({ programs }, null, 2)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
