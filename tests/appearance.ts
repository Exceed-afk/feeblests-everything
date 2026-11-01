import assert from 'node:assert/strict'
import { DEFAULT_SETTINGS } from '../src/shared/types'
import {
  PALETTES, accentText, accentTint, appearanceVars, cardBorder, contrast, hexToRgb, migrateColorScheme, rgbToHex,
  mix, normalizeSettings, themeContrast
} from '../src/shared/appearance'

let n = 0
const test = (name: string, fn: () => void) => { fn(); n++; console.log('ok  ', name) }
const byId = (id: string) => PALETTES.find((palette) => palette.id === id)!

test('all thirteen themes have stable ids and complete light/dark token ramps', () => {
  assert.equal(PALETTES.length, 13)
  assert.equal(new Set(PALETTES.map((palette) => palette.id)).size, PALETTES.length)
  for (const palette of PALETTES) for (const mode of ['light', 'dark'] as const) {
    assert.deepEqual(Object.keys(palette[mode]).sort(), ['bg', 'border', 'muted', 'sidebar', 'surface', 'text'])
    for (const color of Object.values(palette[mode])) {
      assert.match(color, /^#[0-9a-f]{6}$/i)
      assert.notEqual(color.toLowerCase(), '#000000')
      assert.notEqual(color.toLowerCase(), '#ffffff')
    }
  }
})

test('the six supplied palette ramps use their specified home-mode values', () => {
  assert.deepEqual(byId('mocha-cream').light, {
    bg: '#f8f4e6', surface: '#fdfbf3', sidebar: '#f0e9d6', border: '#e0d4bc', text: '#4a3320', muted: '#80654a'
  })
  assert.deepEqual(byId('espresso-night').dark, {
    bg: '#1b130c', surface: '#251b12', sidebar: '#130d08', border: '#3a2b1b', text: '#ddd6c3', muted: '#a0957c'
  })
  assert.deepEqual(byId('soft-linen').light, {
    bg: '#f9f8f6', surface: '#fefefd', sidebar: '#f1ece7', border: '#e0d7cf', text: '#3a322b', muted: '#776b60'
  })
  assert.deepEqual(byId('fresh-meadow').light, {
    bg: '#eff7f0', surface: '#fafdfa', sidebar: '#e4f1e5', border: '#c6dec8', text: '#1f3a23', muted: '#4c7050'
  })
  assert.deepEqual(byId('royal-plum').dark, {
    bg: '#1f1527', surface: '#291c34', sidebar: '#190f20', border: '#3e2b4d', text: '#e5dbee', muted: '#a58eb8'
  })
  assert.deepEqual(byId('sage-garden').dark, {
    bg: '#1c241b', surface: '#212c20', sidebar: '#161e15', border: '#364634', text: '#dbeadc', muted: '#9bb399'
  })
})

for (const palette of PALETTES) for (const mode of ['light', 'dark'] as const) {
  for (const style of ['modern', 'minimal'] as const) {
    test(`${palette.name} ${mode} ${style}: palette contrast stays in range`, () => {
      const metrics = themeContrast(palette[mode], style)
      assert.ok(metrics.textOnBackground >= 10 && metrics.textOnBackground <= 14, `text/bg ${metrics.textOnBackground.toFixed(2)}:1`)
      assert.ok(metrics.mutedOnBackground >= 4.5, `muted/bg ${metrics.mutedOnBackground.toFixed(2)}:1`)
      assert.ok(metrics.surfaceOnBackground >= 1.03 && metrics.surfaceOnBackground <= 1.18, `surface/bg ${metrics.surfaceOnBackground.toFixed(2)}:1`)
      if (style === 'minimal') {
        assert.ok(metrics.borderOnBackground >= 1.25, `border/bg ${metrics.borderOnBackground.toFixed(2)}:1`)
        assert.ok(metrics.borderOnBackground <= 3, `border/bg ${metrics.borderOnBackground.toFixed(2)}:1 is too strong`)
      }
      if (style === 'modern') {
        assert.deepEqual(cardBorder(palette[mode], style),
          mix(hexToRgb(palette[mode].surface), hexToRgb(palette[mode].border), 0.65))
      }
    })
  }
}

const ACCENTS = ['#075b38', '#8b5cf6', '#10b981', '#f43f5e', '#f59e0b', '#64748b', '#0ea5e9', '#f97316']
for (const palette of PALETTES) for (const mode of ['light', 'dark'] as const) {
  test(`${palette.name} ${mode}: accent tint and adjusted text work for every preset`, () => {
    const tokens = palette[mode]
    for (const value of ACCENTS) {
      const vars = appearanceVars({ ...DEFAULT_SETTINGS, palette: palette.id, accent: value }, mode === 'dark')
      const accent = vars['--accent'].split(' ').map(Number) as [number, number, number]
      const tint = accentTint(accent, tokens, mode === 'dark')
      assert.deepEqual(tint, mix(hexToRgb(tokens.surface), accent, mode === 'dark' ? 0.2 : 0.14))
      const text = accentText(accent, tokens, mode === 'dark')
      for (const surface of [tokens.bg, tokens.sidebar, tokens.surface, rgbToHex(tint)]) {
        assert.equal(vars['--selected'], tint.join(' '))
        assert.ok(contrast(text, hexToRgb(surface)) >= 4.5, `${value} text on ${palette.name} ${mode} ${surface}`)
      }
    }
  })
}

test('saved legacy colour schemes and recipe palette ids migrate to unified theme ids', () => {
  assert.equal(migrateColorScheme(undefined, 'Forest'), 'forest')
  assert.equal(normalizeSettings({ colorScheme: 'Frost' } as Parameters<typeof normalizeSettings>[0]).palette, 'frost')
  assert.equal(normalizeSettings({ palette: 'mochaCream' }).palette, 'mocha-cream')
  assert.equal(normalizeSettings({ palette: 'default', colorScheme: 'Frost' }).palette, 'frost')
  assert.equal(normalizeSettings({ palette: 'royalPlum', colorScheme: 'Midnight' }).palette, 'royal-plum')
})

test('existing customised colours are migrated and remain independent of the selected theme', () => {
  const settings = normalizeSettings({ palette: 'fresh-meadow', colors: { light: { panel: '#123456', card: '#234567', fg: '#345678' }, dark: {} } })
  assert.deepEqual(settings.colors.light, { sidebar: '#123456', surface: '#234567', text: '#345678' })
  const resolved = appearanceVars({ ...settings, palette: 'royal-plum' }, false)
  assert.equal(resolved['--sidebar'], '18 52 86')
  assert.equal(resolved['--surface'], '35 69 103')
  assert.equal(resolved['--text'], '52 86 120')
})

console.log(`\n${n} appearance checks passed`)
