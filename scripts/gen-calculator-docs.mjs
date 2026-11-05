import fs from 'node:fs'
import path from 'node:path'
import { registry } from '../src/shared/calculator/registry.ts'
import '../src/shared/calculator/modules/scientific/index.ts'
import '../src/shared/calculator/modules/statistics/index.ts'
import '../src/shared/calculator/modules/finance/index.ts'
import '../src/shared/calculator/modules/conversions/index.ts'
import '../src/shared/calculator/modules/linear-algebra/index.ts'
import '../src/shared/calculator/modules/complex/index.ts'
import '../src/shared/calculator/modules/cas/index.ts'

const functions = registry.listFunctions()
const constants = registry.listConstants()

const categories = {
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

let doc = `# Calculator Functions & Constants Reference

This document is automatically generated from the calculator's centralized function registry (\`src/shared/calculator/registry.ts\`).

---

## Constants

| Constant | Symbol / Alias | Description | Value |
|---|---|---|---|
`

for (const c of constants) {
  const aliases = c.aliases ? c.aliases.join(', ') : '—'
  doc += `| \`${c.name}\` | ${aliases} | ${c.description} | \`${c.value.toDecimalPlaces(8).toString()}\` |\n`
}

doc += `\n---

## Functions Reference

`

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

const outPath = path.resolve('docs/calculator-functions.md')
fs.writeFileSync(outPath, doc, 'utf8')
console.log(`Generated calculator function reference with ${functions.length} functions at ${outPath}`)
