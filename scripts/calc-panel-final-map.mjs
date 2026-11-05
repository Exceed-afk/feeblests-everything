// Final mapping pass: any class that does not exist in this project becomes the nearest real token.
//   node scripts/calc-panel-final-map.mjs
import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const dirs = [
  resolve('src/renderer/src/modules/Calculator/panels'),
  resolve('src/renderer/src/modules/Calculator')
]

const MAP = [
  [/\bbtn-subtle\b/g, 'btn'],
  [/\bbg-theme\/(\d+)\b/g, 'bg-accent-fg/10'],
  [/\bborder-theme\/(\d+)\b/g, 'border-line'],
  [/\bborder-theme\b/g, 'border-line'],
  [/\bbg-theme\b/g, 'bg-accent'],
  [/\btext-theme\b/g, 'text-accent-fg'],
  [/\bbg-surface\b/g, 'bg-card'],
  [/\btext-white\b/g, 'text-on-accent'],
  [/\bshadow-sm\b/g, 'shadow-card'],
  [/\btext-red-500\b/g, 'text-neg'],
  [/\btext-green-500\b/g, 'text-pos'],
  // a plain `.btn` already carries its own colours: drop the accent fill next to it
  [/className="btn bg-accent text-on-accent/g, 'className="btn-primary'],
  [/className="btn bg-accent/g, 'className="btn'],
  [/\bbg-black\/50 backdrop-blur-sm\b/g, 'scrim']
]

for (const dir of dirs) {
  for (const file of readdirSync(dir).filter((f) => f.endsWith('.tsx'))) {
    const path = join(dir, file)
    const before = readFileSync(path, 'utf8')
    let src = before
    for (const [re, to] of MAP) src = src.replace(re, to)
    if (src !== before) {
      writeFileSync(path, src)
      console.log('updated', file)
    }
  }
}
