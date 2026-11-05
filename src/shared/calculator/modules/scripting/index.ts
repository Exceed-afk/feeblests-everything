import { parse, type ASTNode } from '../../parser'
import { Evaluator } from '../../evaluator'
import { Decimal } from '../../numeric'
import { CALC_LIMITS, limitMessage } from '../../limits'
import { CalcError } from '../../errors'
import { toStringInput, requireDefined } from '../../inputs'

/** Word sizes a bitwise operation may use. */
const WORD_BITS = new Set([8, 16, 32, 64])

function wordBits(value: unknown): number {
  if (value === undefined) return 32
  const n = typeof value === 'bigint' ? Number(value) : value
  const bits = Number(n)
  if (!WORD_BITS.has(bits)) throw new CalcError('Word size must be 8, 16, 32 or 64 bits')
  return bits
}

function bigintInput(value: unknown, what: string): bigint {
  if (typeof value === 'bigint') return value
  if (typeof value === 'number' && Number.isInteger(value) && Number.isSafeInteger(value)) return BigInt(value)
  if (typeof value === 'string' && /^-?\d+$/.test(value.trim())) return BigInt(value.trim())
  throw new CalcError(`${what} must be a whole number`)
}

// ---------- Bitwise Operations ----------

export function bitwiseAnd(a: bigint | number | string, b: bigint | number | string): bigint {
  return bigintInput(a, 'a') & bigintInput(b, 'b')
}

export function bitwiseOr(a: bigint | number | string, b: bigint | number | string): bigint {
  return bigintInput(a, 'a') | bigintInput(b, 'b')
}

export function bitwiseXor(a: bigint | number | string, b: bigint | number | string): bigint {
  return bigintInput(a, 'a') ^ bigintInput(b, 'b')
}

export function bitwiseNot(a: bigint | number | string, bits: number | string = 32): bigint {
  const size = wordBits(bits)
  const mask = (1n << BigInt(size)) - 1n
  return (~bigintInput(a, 'a')) & mask
}

export function bitwiseShiftLeft(a: bigint | number | string, shift: number | string, bits: number | string = 32): bigint {
  const size = wordBits(bits)
  const n = Number(shift)
  if (!Number.isInteger(n) || n < 0 || n > size) throw new CalcError(`Shift must be between 0 and ${size}`)
  const mask = (1n << BigInt(size)) - 1n
  return (bigintInput(a, 'a') << BigInt(n)) & mask
}

export function bitwiseShiftRight(a: bigint | number | string, shift: number | string): bigint {
  const n = Number(shift)
  if (!Number.isInteger(n) || n < 0 || n > 1024) throw new CalcError('Shift must be between 0 and 1024')
  return bigintInput(a, 'a') >> BigInt(n)
}

export function formatBinaryWord(val: bigint | number | string, bits: number | string = 32): string {
  const size = wordBits(bits)
  const mask = (1n << BigInt(size)) - 1n
  const unsigned = bigintInput(val, 'val') & mask
  const bin = unsigned.toString(2).padStart(size, '0')
  // Group into 4-bit nibbles
  return bin.replace(/\B(?=(\d{4})+(?!\d))/g, ' ')
}

export function parseBinaryWord(str: string): bigint {
  const text = toStringInput(str, 'binary string')
  const clean = text.replace(/[\s,_]/g, '')
  if (!/^[01]{1,1024}$/.test(clean)) throw new CalcError('Binary string must be 1 to 1024 zeroes and ones')
  return BigInt(`0b${clean}`)
}

// ---------- Sandboxed Scripting Engine ----------

export interface ScriptContext {
  /** Callers may LOWER the step cap, never raise it above CALC_LIMITS.scriptSteps. */
  maxSteps?: number
  initialScope?: Record<string, string>
}

export interface ScriptExecutionResult {
  returnValue: string
  scope: Record<string, string>
  stepsCount: number
}

interface CustomFunc {
  param: string
  body: string[]
}

/**
 * Sandboxed line-based script interpreter with:
 * - Variable assignments (e.g. x = 10, fact = fact * n)
 * - Conditionals (if condition { ... } else { ... })
 * - Loops (while condition { ... })
 * - Function declarations (fn name(param) { ... })
 * - Return statements (return expr)
 * - Strict step counter limit ensuring termination
 */
export function executeScript(
  source: string,
  context: ScriptContext = {}
): ScriptExecutionResult {
  const text = toStringInput(source, 'script')
  if (text.length > CALC_LIMITS.scriptLength) {
    throw new CalcError(
      `${limitMessage('scriptLength', 'characters')} (this one has ${text.length.toLocaleString('en-US')})`
    )
  }
  if (!context || typeof context !== 'object') throw new CalcError('Script context must be an object')
  if (context.initialScope !== undefined && (context.initialScope === null || typeof context.initialScope !== 'object')) {
    throw new CalcError('initialScope must be an object of name: value pairs')
  }

  // A hard ceiling no caller can move: a loop can never freeze the UI.
  const requested = context.maxSteps === undefined ? CALC_LIMITS.scriptSteps : Number(context.maxSteps)
  if (!Number.isFinite(requested)) throw new CalcError('maxSteps must be a number')
  const maxSteps = Math.min(CALC_LIMITS.scriptSteps, Math.max(1, Math.floor(requested)))
  let step = 0

  if (typeof source !== 'string') throw new CalcError('Script must be text')
  source = text

  const scope: Record<string, Decimal> = {}
  for (const [k, v] of Object.entries(context.initialScope || {})) {
    try {
      scope[k.toLowerCase()] = new Decimal(requireDefined(v, `initialScope.${k}`))
    } catch {
      throw new CalcError(`initialScope.${k} must be a number`)
    }
  }

  const funcs: Record<string, CustomFunc> = {}

  const evalExpr = (exprStr: string): Decimal => {
    // Check if expression is a function call to a custom script function e.g. double(21)
    const fnMatch = exprStr.trim().match(/^([a-zA-Z_]\w*)\s*\((.*)\)$/)
    if (fnMatch) {
      const fnName = fnMatch[1].toLowerCase()
      if (funcs[fnName]) {
        const argVal = evalExpr(fnMatch[2])
        const customFn = funcs[fnName]
        const childContext: ScriptContext = {
          maxSteps: maxSteps - step,
          initialScope: {
            ...Object.fromEntries(Object.entries(scope).map(([k, v]) => [k, v.toString()])),
            [customFn.param]: argVal.toString()
          }
        }
        const childRes = executeScript(customFn.body.join('\n'), childContext)
        step += childRes.stepsCount
        return new Decimal(childRes.returnValue || '0')
      }
    }

    const ast = parse(exprStr)
    const evaluator = new Evaluator({ scope })
    return evaluator.evaluate(ast)
  }

  const evalCondition = (condStr: string): boolean => {
    const ops = ['==', '!=', '>=', '<=', '>', '<']
    for (const op of ops) {
      if (condStr.includes(op)) {
        const [lStr, rStr] = condStr.split(op)
        const lVal = evalExpr(lStr)
        const rVal = evalExpr(rStr)
        switch (op) {
          case '==':
            return lVal.equals(rVal)
          case '!=':
            return !lVal.equals(rVal)
          case '>':
            return lVal.greaterThan(rVal)
          case '<':
            return lVal.lessThan(rVal)
          case '>=':
            return lVal.greaterThanOrEqualTo(rVal)
          case '<=':
            return lVal.lessThanOrEqualTo(rVal)
        }
      }
    }
    return !evalExpr(condStr).isZero()
  }

  const rawLines = source
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !l.startsWith('#') && !l.startsWith('//'))

  let pc = 0
  let returnVal: string = '0'

  while (pc < rawLines.length) {
    if (++step > maxSteps) {
      throw new CalcError(`Step limit exceeded (${maxSteps} steps): possible infinite loop detected`)
    }

    const line = rawLines[pc]

    // Function declaration: fn name(x) { ... }
    const fnDecl = line.match(/^fn\s+([a-zA-Z_]\w*)\s*\(([a-zA-Z_]\w*)\)\s*\{?$/)
    if (fnDecl) {
      const fnName = fnDecl[1].toLowerCase()
      const param = fnDecl[2].toLowerCase()
      const body: string[] = []
      pc++
      while (pc < rawLines.length && rawLines[pc] !== '}') {
        body.push(rawLines[pc])
        pc++
      }
      funcs[fnName] = { param, body }
      pc++
      continue
    }

    // Return statement
    if (line.startsWith('return ')) {
      const expr = line.replace('return ', '').trim()
      returnVal = evalExpr(expr).toString()
      break
    }

    // If / else statement: if cond {
    if (line.startsWith('if ')) {
      const condMatch = line.match(/^if\s+(.+)\s*\{?$/)
      if (!condMatch) throw new CalcError(`Syntax error in if statement: "${line}"`)
      const cond = evalCondition(condMatch[1].replace('{', '').trim())

      const ifBody: string[] = []
      const elseBody: string[] = []
      let inElse = false
      pc++

      while (pc < rawLines.length) {
        const cur = rawLines[pc]
        if (cur === '}' || cur.startsWith('} else')) {
          if (cur.includes('else')) {
            inElse = true
            pc++
            continue
          }
          break
        }
        if (inElse) elseBody.push(cur)
        else ifBody.push(cur)
        pc++
      }

      const blockToRun = cond ? ifBody : elseBody
      if (blockToRun.length > 0) {
        const subRes = executeScript(blockToRun.join('\n'), {
          maxSteps: maxSteps - step,
          initialScope: Object.fromEntries(Object.entries(scope).map(([k, v]) => [k, v.toString()]))
        })
        step += subRes.stepsCount
        for (const [k, v] of Object.entries(subRes.scope)) {
          scope[k.toLowerCase()] = new Decimal(v)
        }
        if (subRes.returnValue !== '0') {
          returnVal = subRes.returnValue
          break
        }
      }
      pc++
      continue
    }

    // While loop: while cond {
    if (line.startsWith('while ')) {
      const condMatch = line.match(/^while\s+(.+)\s*\{?$/)
      if (!condMatch) throw new CalcError(`Syntax error in while loop: "${line}"`)
      const condStr = condMatch[1].replace('{', '').trim()

      const body: string[] = []
      pc++
      while (pc < rawLines.length && rawLines[pc] !== '}') {
        body.push(rawLines[pc])
        pc++
      }

      while (evalCondition(condStr)) {
        if (++step > maxSteps) {
          throw new CalcError(`Step limit exceeded (${maxSteps} steps): possible infinite loop in while`)
        }
        const subRes = executeScript(body.join('\n'), {
          maxSteps: maxSteps - step,
          initialScope: Object.fromEntries(Object.entries(scope).map(([k, v]) => [k, v.toString()]))
        })
        step += subRes.stepsCount
        for (const [k, v] of Object.entries(subRes.scope)) {
          scope[k.toLowerCase()] = new Decimal(v)
        }
        if (subRes.returnValue !== '0') {
          returnVal = subRes.returnValue
          break
        }
      }
      pc++
      continue
    }

    // Assignment: var = expr
    if (line.includes('=')) {
      const [varName, expr] = line.split('=').map((s) => s.trim())
      scope[varName.toLowerCase()] = evalExpr(expr)
      pc++
      continue
    }

    pc++
  }

  const finalScope: Record<string, string> = {}
  for (const [k, v] of Object.entries(scope)) {
    finalScope[k] = v.toString()
  }

  return {
    returnValue: returnVal,
    scope: finalScope,
    stepsCount: step
  }
}

// Re-export the Phase 9 program tooling (two's complement views, program file
// import/export) so one import site serves the whole module.
export {
  WORD_SIZES, twosView, toSigned, parseProgValue,
  parseProgramFile, serializeProgramFile, programFileLimitBytes,
  type WordSize, type TwosView, type ExportedProgram, type ProgramFile
} from './progTools'
