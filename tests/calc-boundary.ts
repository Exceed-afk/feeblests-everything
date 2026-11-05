import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

// Architectural rule: src/shared/calculator must not import react, electron, window, document, or better-sqlite3
const calcDir = path.resolve('src/shared/calculator')

function scanFiles(dir: string): string[] {
  const entries = fs.readdirSync(dir, { withFileTypes: true })
  let files: string[] = []
  for (const entry of entries) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      files = files.concat(scanFiles(full))
    } else if (entry.name.endsWith('.ts') || entry.name.endsWith('.tsx')) {
      files.push(full)
    }
  }
  return files
}

const forbidden = ['react', 'electron', 'better-sqlite3']

for (const file of scanFiles(calcDir)) {
  const content = fs.readFileSync(file, 'utf8')
  for (const term of forbidden) {
    const regex = new RegExp(`from\\s+['"]${term}['"]|import\\s+['"]${term}['"]`, 'i')
    assert.ok(
      !regex.test(content),
      `Boundary violation in ${path.relative(process.cwd(), file)}: forbidden import of "${term}"`
    )
  }
  assert.ok(!content.includes('window.'), `Boundary violation in ${file}: references window`)
  assert.ok(!content.includes('document.'), `Boundary violation in ${file}: references document`)
  assert.ok(!content.includes('eval('), `Security violation in ${file}: references eval`)
  assert.ok(!/\bnew\s+Function\s*\(/.test(content), `Security violation in ${file}: dynamic code constructor 'new Function(...)'`)
}

console.log('ok   calculator boundary and security contract tests passed')
