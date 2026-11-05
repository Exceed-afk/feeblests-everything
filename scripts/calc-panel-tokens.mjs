// One-off codemod: the calculator panels were written against CSS classes that do not exist in
// this project (border-theme, bg-theme, text-theme, btn-subtle, text-red-500...). Map them to the
// project's real theme tokens so the panels follow light/dark like every other module.
//   node scripts/calc-panel-tokens.mjs
import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const dir = resolve('src/renderer/src/modules/Calculator/panels')

const REPLACEMENTS = [
  // segmented / sub-tab buttons: selected = raised surface with accent text, not a hard fill
  [/\$\{\s*([\w.]+) === ([^}]+?) \? 'bg-theme text-white'\s*:\s*'btn-subtle text-muted'\s*\}/g, ''],
  // borders
  [/\bborder-theme\/(\d+)\b/g, 'border-line'],
  [/\bborder-theme\/20\b/g, 'border-line/60'],
  [/\bborder-theme\b/g, 'border-line'],
  // surfaces / ink
  [/\bbg-surface\b/g, 'bg-card'],
  [/\btext-theme\b/g, 'text-accent-fg'],
  [/\bbg-theme\/(\d+)\b/g, 'bg-accent-fg/10'],
  [/\bbg-theme\b/g, 'bg-accent'],
  [/\bt\b/g, 't']
]
void REPLACEMENTS

for (const file of readdirSync(dir).filter((f) => f.endsWith('.tsx'))) {
  const path = join(dir, file)
  let src = readFileSync(path, 'utf8')
  const before = src

  // 1. class helpers that do not exist
  src = src.replace(/\bbtn-subtle\b/g, 'btn')
  src = src.replace(/\b(bg-theme|border-theme|text-theme)\b/g, (m) => ({ 'bg-theme': 'bg-accent', 'border-theme': 'border-line', 'text-theme': 'text-accent-fg' })[m])
  src = src.replace(/(bg-theme|border-theme|text-theme)\/(\d+)/g, (m, base, n) => {
    const op = Math.min(100, Number(n))
    const mapped = { 'bg-theme': 'bg-accent', 'border-theme': 'border-line', 'text-theme': 'text-accent-fg' }[base]
    return `${mapped}/${op}`
  })
  src = src.replace(/\bbg-surface\b/g, 'bg-card')
  src = src.replace(/\btext-red-500\b/g, 'text-neg')
  src = src.replace(/\btext-green-500\b/g, 'text-pos')
  src = src.replace(/\btext-white\b/g, 'text-on-accent')
  src = src.replace(/\bshadow-sm\b/g, 'shadow-card')
  src = src.replace(/\bhover:text-theme\b/g, 'hover:text-accent-fg')
  src = src.replace(/\bborder-t border-theme\b/g, 'border-t border-line')
  src = src.replace(/\bhover:border-theme\/60\b/g, 'hover:border-fg/30')

  // 2. pressed buttons must use the app's selected state (aria-pressed is what styles.css keys on).
  src = src.replace(
    /className=\{`([^`]*?)\$\{\s*([^`]*?=== \w+) \? 'bg-accent font-medium text-on-accent' : 'text-muted'\s*`\}/g,
    (m, head, cond) => `aria-pressed={${cond}} className={\`${head}\`}`
  )

  if (src !== before) {
    writeFileSync(path, src)
    console.log('updated', file)
  }
}
