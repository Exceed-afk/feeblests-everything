import assert from 'node:assert/strict'
import { PALETTES } from '../src/shared/appearance'

const expected = [
  ['default', 'Default'], ['midnight', 'Midnight'], ['paper', 'Paper'], ['forest', 'Forest'],
  ['frost', 'Frost'], ['graphite', 'Graphite'], ['mocha-cream', 'Mocha Cream'],
  ['espresso-night', 'Espresso Night'], ['soft-linen', 'Soft Linen'], ['fresh-meadow', 'Fresh Meadow'],
  ['warm-sand', 'Warm Sand'], ['royal-plum', 'Royal Plum'], ['sage-garden', 'Sage Garden']
]

assert.deepEqual(PALETTES.map(({ id, name }) => [id, name]), expected)
for (const palette of PALETTES) {
  assert.notDeepEqual(palette.light, palette.dark, `${palette.name} must provide both distinct variants`)
}
console.log(`ok   all ${expected.length} themes share one palette registry and have both mode variants`)
