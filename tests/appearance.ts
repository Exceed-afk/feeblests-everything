// Every colour scheme must stay readable in both modes, and the meaning colours
// (gain / loss) must be readable on light and dark cards. Needs no DOM:
//   npm test
import assert from 'node:assert/strict'
import { PALETTES, accentText, contrast, hexToRgb, mix, type RGB } from '../src/shared/appearance'
import { COLOR_TOKENS } from '../src/shared/design'

let n = 0
const test = (name: string, fn: () => void) => { fn(); n++; console.log('ok  ', name) }
const ratio = (a: string, b: string) => contrast(hexToRgb(a), hexToRgb(b))

for (const p of PALETTES) {
  for (const mode of ['light', 'dark'] as const) {
    const t = p[mode]
    test(`${p.id} ${mode}: text and secondary text are readable on page, sidebar and cards`, () => {
      for (const surface of [t.bg, t.panel, t.card]) {
        assert.ok(ratio(t.fg, surface) >= 7, `fg on ${surface}`)
        assert.ok(ratio(t.muted, surface) >= 4.5, `muted on ${surface}`)
      }
    })
    test(`${p.id} ${mode}: cards stand out from the page, and borders are visible`, () => {
      assert.ok(ratio(t.card, t.bg) >= 1.04, 'card vs page')
      assert.ok(ratio(t.line, t.card) >= 1.2, 'border vs card')
    })
  }
}

// Accent-coloured text (active sidebar item, matched letters in the palette, tag chips) must be readable on every surface
// it can sit on, for every accent the colour picker offers: the page, sidebar and cards, the active sidebar tile, and the
// selected palette row in both styles (accent tint in Modern, grey tint in Classic minimal).
const ACCENTS = ['#075b38', '#8b5cf6', '#10b981', '#f43f5e', '#f59e0b', '#64748b', '#0ea5e9', '#f97316'] // = ACCENT_PRESETS in lib/theme.ts
for (const p of PALETTES) for (const mode of ['light', 'dark'] as const) {
  test(`${p.id} ${mode}: accent text reaches 4.5:1 on the sidebar tile and palette rows for every accent`, () => {
    const t = p[mode], [bg, panel, card, fg] = [t.bg, t.panel, t.card, t.fg].map(hexToRgb)
    for (const hex of ACCENTS) {
      const accent = hexToRgb(hex)
      const text = accentText(accent, t)
      const surfaces: [string, RGB][] = [['page', bg], ['sidebar', panel], ['card', card],
        ['active sidebar tile', mix(panel, accent, 0.14)], ['selected palette row', mix(card, accent, 0.14)], ['selected palette row (minimal)', mix(card, fg, 0.07)]]
      for (const [name, surface] of surfaces) assert.ok(contrast(text, surface) >= 4.5, `${hex} on ${name}: ${contrast(text, surface).toFixed(2)}`)
    }
  })
}

// The same numbers as --pos / --neg / --warn in styles.css (and the meaning colours of src/shared/design.ts).
const POS = { light: COLOR_TOKENS.light.pos, dark: COLOR_TOKENS.dark.pos }
const NEG = { light: COLOR_TOKENS.light.neg, dark: COLOR_TOKENS.dark.neg }
const WARN = { light: COLOR_TOKENS.light.warn, dark: COLOR_TOKENS.dark.warn }
for (const p of PALETTES) for (const mode of ['light', 'dark'] as const) {
  test(`${p.id} ${mode}: gain, loss and caution colours reach 4.5:1 on cards and page`, () => {
    for (const c of [POS[mode], NEG[mode], WARN[mode]]) for (const surface of [p[mode].card, p[mode].bg]) assert.ok(ratio(c, surface) >= 4.5, `${c} on ${surface}`)
  })
}

console.log(`\n${n} appearance checks passed`)
