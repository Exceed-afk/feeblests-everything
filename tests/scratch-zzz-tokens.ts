// Scratch debug (deleted after use): shows the derived tokens for the palettes the tests fail on.
import { PALETTE_RECIPES, buildPalette } from '../src/shared/paletteRecipes'
for (const id of ['sage-garden', 'soft-linen', 'warm-sand', 'fresh-meadow', 'mocha-cream', 'espresso-night', 'royal-plum']) {
  const r = PALETTE_RECIPES.find((x) => x.id === id)!
  const b = buildPalette(r)
  console.log(r.name, 'light:', JSON.stringify(b.light))
  console.log(r.name, 'dark: ', JSON.stringify(b.dark))
}
