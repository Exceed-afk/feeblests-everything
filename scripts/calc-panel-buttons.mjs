// Second pass on the calculator panels: buttons and sub-tabs use the project's real classes.
//   className="btn bg-accent text-on-accent"  -> className="btn-primary"
//   sub-tabs `<button ... className={cond ? 'bg-accent text-on-accent' : 'btn text-muted'}>`
//                                              -> <button ... aria-pressed={cond} className="btn">
//   node scripts/calc-panel-buttons.mjs
import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const dir = resolve('src/renderer/src/modules/Calculator/panels')
for (const file of readdirSync(dir).filter((f) => f.endsWith('.tsx'))) {
  const path = join(dir, file)
  let src = readFileSync(path, 'utf8')
  const before = src

  // Buttons: solid accent fill = the app's primary button (it picks the readable ink itself).
  src = src.replace(/className="btn bg-accent text-on-accent([^"]*)"/g, 'className="btn-primary$1"')

  // Sub-tab rows: three shapes exist after the first pass; all become "aria-pressed + btn".
  src = src.replace(
    /className=\{`px-3 py-1\.5 rounded-md font-medium \$\{\s*([\w.]+(?: === \w+| === '[^']+'| === \"[^\"]+\"))\s*\?\s*'bg-accent text-on-accent'\s*:\s*'btn text-muted'\s*\}`\}/g,
    (_m, cond) => `aria-pressed={${cond}} className="btn"`
  )
  src = src.replace(
    /className=\{`btn[^`]*\$\{\s*([\w.]+) === (\w+) \? 'bg-accent text-on-accent' : 'btn'\s*\}`\}/g,
    (_m, expr, value) => `aria-pressed={${expr} === ${value}} className="btn"`
  )
  // A tab row is a group of exclusive choices.
  src = src.replace(/<div className="flex gap-2 border-b border-line pb-2 text-sm">/g, '<div className="seg flex-wrap" role="group">')

  if (src !== before) {
    writeFileSync(path, src)
    console.log('updated', file)
  }
}
