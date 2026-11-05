import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { registry } from '../src/shared/calculator/registry'
import { CalculatorEngine } from '../src/shared/calculator'
import '../src/shared/calculator/modules/scientific'
import '../src/shared/calculator/modules/statistics'
import '../src/shared/calculator/modules/finance'
import '../src/shared/calculator/modules/conversions'
import '../src/shared/calculator/modules/linear-algebra'
import '../src/shared/calculator/modules/complex'
import '../src/shared/calculator/modules/cas'

let passedChecks = 0
const ok = () => {
  passedChecks++
}

console.log('Running tests/calc-registry.ts...')

const functions = registry.listFunctions()
const constants = registry.listConstants()

// ---------------------------------------------------------------------------
// 1. Unique names and aliases, no collisions, aliases resolve to same impl
// ---------------------------------------------------------------------------
// Reserved words that must not be used as function or constant names
const RESERVED_WORDS = ['ans']
for (const word of RESERVED_WORDS) {
  assert.ok(!registry.getFunction(word), `Function name must not collide with reserved word "${word}"`)
  assert.ok(!registry.getConstant(word), `Constant name must not collide with reserved word "${word}"`)
}

const nameToEntity = new Map<string, { kind: 'function' | 'constant'; name: string }>()

for (const c of constants) {
  const normName = c.name.toLowerCase()
  assert.ok(!nameToEntity.has(normName), `Duplicate constant name: ${c.name}`)
  nameToEntity.set(normName, { kind: 'constant', name: c.name })

  if (c.aliases) {
    for (const alias of c.aliases) {
      const normAlias = alias.toLowerCase()
      if (normAlias === normName) {
        // Alias is case-variant of its own name (e.g. PI for pi, E for e)
        continue
      }
      assert.ok(
        !nameToEntity.has(normAlias),
        `Constant alias collision: "${alias}" of constant "${c.name}" collides with ${JSON.stringify(nameToEntity.get(normAlias))}`
      )
      nameToEntity.set(normAlias, { kind: 'constant', name: c.name })
      const resolved = registry.getConstant(alias)
      assert.ok(resolved, `Alias "${alias}" failed to resolve to constant`)
      assert.equal(resolved?.name, c.name, `Alias "${alias}" resolved to different constant`)
      ok()
    }
  }
  ok()
}

for (const fn of functions) {
  const normName = fn.name.toLowerCase()
  // Collision check with constants or other functions
  assert.ok(
    !nameToEntity.has(normName),
    `Function name "${fn.name}" collides with ${JSON.stringify(nameToEntity.get(normName))}`
  )
  nameToEntity.set(normName, { kind: 'function', name: fn.name })

  if (fn.aliases) {
    for (const alias of fn.aliases) {
      const normAlias = alias.toLowerCase()
      if (normAlias === normName) {
        // Alias is case-variant of its own name
        continue
      }
      assert.ok(
        !nameToEntity.has(normAlias),
        `Function alias "${alias}" of "${fn.name}" collides with ${JSON.stringify(nameToEntity.get(normAlias))}`
      )
      nameToEntity.set(normAlias, { kind: 'function', name: fn.name })

      const resolved = registry.getFunction(alias)
      assert.ok(resolved, `Alias "${alias}" failed to resolve`)
      assert.equal(resolved?.impl, fn.impl, `Alias "${alias}" does not resolve to the same implementation as "${fn.name}"`)
      assert.equal(resolved?.name, fn.name, `Alias "${alias}" does not resolve to function "${fn.name}"`)
      ok()
    }
  }
  ok()
}

// Check reserved word collision: function names must not be 'ans'
for (const word of RESERVED_WORDS) {
  assert.ok(!registry.getFunction(word), `Function name or alias must not collide with reserved word "${word}"`)
}
ok()

// ---------------------------------------------------------------------------
// 2. description, category, examples present and non-empty
// ---------------------------------------------------------------------------
const ALLOWED_CATEGORIES = new Set([
  'core',
  'scientific',
  'stats',
  'finance',
  'conversion',
  'matrix',
  'cas',
  'programming',
  'date'
])

for (const fn of functions) {
  assert.ok(fn.description && fn.description.trim().length > 0, `Function "${fn.name}" must have non-empty description`)
  assert.ok(fn.category && ALLOWED_CATEGORIES.has(fn.category), `Function "${fn.name}" has invalid category: ${fn.category}`)
  assert.ok(Array.isArray(fn.examples) && fn.examples.length >= 1, `Function "${fn.name}" must have at least one example`)
  for (const ex of fn.examples) {
    assert.ok(typeof ex === 'string' && ex.trim().length > 0, `Function "${fn.name}" has empty example: ${ex}`)
  }
  ok()
}

for (const c of constants) {
  assert.ok(c.description && c.description.trim().length > 0, `Constant "${c.name}" must have non-empty description`)
  assert.ok(c.value !== undefined && c.value !== null, `Constant "${c.name}" must have a value`)
  ok()
}

// ---------------------------------------------------------------------------
// 3. Every example runs through the real engine without error
// ---------------------------------------------------------------------------
const engine = new CalculatorEngine()

const failedExamples: Array<{ fn: string; example: string; error: string }> = []

for (const fn of functions) {
  for (const ex of fn.examples) {
    // Check if example includes an expected result format like 'expr = expected' or 'expr -> expected'
    let expr = ex
    let expected: string | null = null

    if (ex.includes('->')) {
      const parts = ex.split('->').map((s) => s.trim())
      expr = parts[0]
      expected = parts[1]
    } else if (ex.includes('=')) {
      // Avoid matching variable assignments like 'x = 3'
      const parts = ex.split('=').map((s) => s.trim())
      if (parts.length === 2 && !/^[a-zA-Z_]\w*$/.test(parts[0])) {
        expr = parts[0]
        expected = parts[1]
      }
    }

    const res = engine.calculate(expr)
    if (res.error) {
      failedExamples.push({ fn: fn.name, example: ex, error: res.error })
    } else if (expected !== null && res.formatted !== expected) {
      failedExamples.push({
        fn: fn.name,
        example: ex,
        error: `Expected ${expected}, got ${res.formatted}`
      })
    } else {
      ok()
    }
  }
}

// Check failed examples
if (failedExamples.length > 0) {
  console.log(`\nRegistry Example Failures (${failedExamples.length}):`)
  for (const f of failedExamples) {
    console.log(`  - [${f.fn}] "${f.example}": ${f.error}`)
  }
  assert.fail(
    `${failedExamples.length} registry example(s) failed: ${failedExamples.map((f) => `${f.fn}: "${f.example}" (${f.error})`).join('; ')}`
  )
}

// ---------------------------------------------------------------------------
// 4. Calling with too few or too many arguments gives a clear calculator error, never a raw TypeError
// ---------------------------------------------------------------------------
for (const fn of functions) {
  // Too few arguments (if minArity > 0)
  if (fn.minArity > 0) {
    const tooFewArgs = Array.from({ length: fn.minArity - 1 }, () => '1').join(', ')
    const exprTooFew = `${fn.name}(${tooFewArgs})`
    const resTooFew = engine.calculate(exprTooFew)
    assert.ok(
      resTooFew.error,
      `Calling "${fn.name}" with too few arguments (${fn.minArity - 1} < ${fn.minArity}) should produce an error`
    )
    assert.ok(
      !resTooFew.error.includes('TypeError') && !resTooFew.error.includes('Cannot read propert'),
      `Calling "${fn.name}" with too few arguments threw a raw TypeError/leak: ${resTooFew.error}`
    )
    assert.match(
      resTooFew.error,
      /expects between|received|at position/i,
      `Error for too few arguments on "${fn.name}" should be clear: ${resTooFew.error}`
    )
    ok()
  }

  // Too many arguments (if maxArity is finite and < 99)
  if (fn.maxArity < 90) {
    const tooManyArgs = Array.from({ length: fn.maxArity + 1 }, () => '1').join(', ')
    const exprTooMany = `${fn.name}(${tooManyArgs})`
    const resTooMany = engine.calculate(exprTooMany)
    assert.ok(
      resTooMany.error,
      `Calling "${fn.name}" with too many arguments (${fn.maxArity + 1} > ${fn.maxArity}) should produce an error`
    )
    assert.ok(
      !resTooMany.error.includes('TypeError') && !resTooMany.error.includes('Cannot read propert'),
      `Calling "${fn.name}" with too many arguments threw a raw TypeError/leak: ${resTooMany.error}`
    )
    assert.match(
      resTooMany.error,
      /expects between|received|at position/i,
      `Error for too many arguments on "${fn.name}" should be clear: ${resTooMany.error}`
    )
    ok()
  }
}

// ---------------------------------------------------------------------------
// 5. docs/calculator-functions.md is up to date: regenerate it to a temp location and fail if it differs
// ---------------------------------------------------------------------------
function generateDocsContent(): string {
  const categories: Record<string, string> = {
    core: 'Core Arithmetic & Utility',
    scientific: 'Scientific & Trigonometry',
    stats: 'Statistics & Probability',
    finance: 'Financial Calculations',
    conversion: 'Unit & Currency Conversion',
    matrix: 'Linear Algebra & Complex Numbers',
    cas: 'Symbolic Math (CAS)',
    programming: 'Programming & Bitwise',
    date: 'Date & Time'
  }

  let doc = `# Calculator Functions & Constants Reference\n\n`
  doc += `This document is automatically generated from the calculator's centralized function registry (\`src/shared/calculator/registry.ts\`).\n\n`
  doc += `---\n\n## Constants\n\n`
  doc += `| Constant | Symbol / Alias | Description | Value |\n`
  doc += `|---|---|---|---|\n`

  for (const c of constants) {
    const aliases = c.aliases ? c.aliases.join(', ') : '—'
    doc += `| \`${c.name}\` | ${aliases} | ${c.description} | \`${c.value.toDecimalPlaces(8).toString()}\` |\n`
  }

  doc += `\n---\n\n## Functions Reference\n\n`

  for (const [catKey, catTitle] of Object.entries(categories)) {
    const catFuncs = functions.filter((f) => f.category === catKey)
    if (catFuncs.length === 0) continue

    doc += `### ${catTitle}\n\n`
    doc += `| Function | Arity | Description | Examples |\n`
    doc += `|---|---|---|---|\n`

    for (const fn of catFuncs) {
      const arityStr = fn.minArity === fn.maxArity ? String(fn.minArity) : `${fn.minArity}..${fn.maxArity}`
      const exStr = fn.examples.map((ex) => `\`${ex}\``).join(', ')
      doc += `| \`${fn.name}\` | ${arityStr} | ${fn.description} | ${exStr} |\n`
    }

    doc += '\n'
  }

  return doc
}

const committedDocsPath = path.resolve('docs/calculator-functions.md')
assert.ok(fs.existsSync(committedDocsPath), 'docs/calculator-functions.md must exist')

const tempDocsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'calc-docs-'))
const tempDocsFile = path.join(tempDocsDir, 'calculator-functions.md')
const freshDocsContent = generateDocsContent()
fs.writeFileSync(tempDocsFile, freshDocsContent, 'utf8')

const committedContent = fs.readFileSync(committedDocsPath, 'utf8').replace(/\r\n/g, '\n')
const tempContent = fs.readFileSync(tempDocsFile, 'utf8').replace(/\r\n/g, '\n')

try {
  fs.rmSync(tempDocsDir, { recursive: true, force: true })
} catch {
  // ignore
}

assert.equal(
  tempContent,
  committedContent,
  'docs/calculator-functions.md is out of date! Run `npm run gen:calc-docs` to update it.'
)
ok()

// ---------------------------------------------------------------------------
// 6. Every function name appears in at least one known-answer test somewhere under tests/calc-*.ts
//    (list the ones that don't)
// ---------------------------------------------------------------------------
const testFiles = fs
  .readdirSync('tests')
  .filter((f) => f.startsWith('calc-') && f.endsWith('.ts') && f !== 'calc-registry.ts')
  .map((f) => path.join('tests', f))

const allTestSources = testFiles.map((file) => ({
  file,
  content: fs.readFileSync(file, 'utf8')
}))

const missingFromKnownAnswerTests: string[] = []

for (const fn of functions) {
  // Test if function name appears in at least one test file
  // We check word boundary or function invocation syntax
  const regex = new RegExp(`\\b${fn.name}\\b`)
  const found = allTestSources.some((src) => regex.test(src.content))

  if (!found) {
    missingFromKnownAnswerTests.push(fn.name)
  } else {
    ok()
  }
}

console.log(`\nRegistry Coverage Summary:`)
console.log(`- Functions in registry: ${functions.length}`)
console.log(`- Constants in registry: ${constants.length}`)
console.log(`- Tested in known-answer test files: ${functions.length - missingFromKnownAnswerTests.length}`)
console.log(`- Missing from known-answer test files: ${missingFromKnownAnswerTests.length}`)

if (missingFromKnownAnswerTests.length > 0) {
  console.log('Functions not found in any tests/calc-*.ts known-answer tests:')
  for (const name of missingFromKnownAnswerTests) {
    console.log(`  - ${name}`)
  }
}

console.log(`ok   tests/calc-registry.ts passed (${passedChecks} checks)`)
