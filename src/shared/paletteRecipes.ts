// Compatibility exports for local scripts that used the former recipe API.
// The canonical theme data now lives in PALETTES in appearance.ts.
import { PALETTES, type Tokens } from './appearance'

export interface PaletteRecipe { id: string; name: string }

export const PALETTE_RECIPES: PaletteRecipe[] = PALETTES.slice(6).map(({ id, name }) => ({ id, name }))

export function buildPalette(recipe: PaletteRecipe): { light: Tokens; dark: Tokens } {
  const found = PALETTES.find(({ id }) => id === recipe.id)
  if (!found) throw new Error(`Unknown theme: ${recipe.id}`)
  return { light: found.light, dark: found.dark }
}
