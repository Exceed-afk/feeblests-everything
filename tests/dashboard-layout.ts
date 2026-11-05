// The customizable Dashboard's layout rules (src/shared/dashboardLayout.ts).
// Pure, so no database and no DOM:
//   npm test
import assert from 'node:assert/strict'
import {
  DEFAULT_LAYOUT, GRID_COLUMNS, LAYOUT_PRESETS, WIDGET_COLUMNS, addWidget, availableWidgets, moveWidget,
  moveWidgetBy, normaliseSize, parseLayout, placeWidgets, removeWidget, resolveLayout, sanitizeLayout,
  serializeLayout, setWidgetSize, type PlacedWidget
} from '../src/shared/dashboardLayout'

let n = 0
const test = (name: string, fn: () => void) => { fn(); n++; console.log('ok  ', name) }

const ids = (l: PlacedWidget[]) => l.map((w) => w.id)

// ---- the affected-column check as a small helper ----
// A widget with `span` columns starting at `offset` fits a row of `total`.
const fits = (offset: number, span: number, total: number) => offset + span <= total

test('the sizes are the documented ones: 3, 6 and 12 of 12 columns', () => {
  assert.deepEqual(WIDGET_COLUMNS, { s: 3, m: 6, l: 12 })
  assert.equal(GRID_COLUMNS, 12)
})

test('a fresh layout is unique, sane and uses only known sizes', () => {
  assert.deepEqual(sanitizeLayout(DEFAULT_LAYOUT), DEFAULT_LAYOUT)
  assert.equal(new Set(ids(DEFAULT_LAYOUT)).size, DEFAULT_LAYOUT.length, 'no widget is placed twice')
  for (const w of DEFAULT_LAYOUT) assert.ok(['s', 'm', 'l'].includes(w.size))
})

test('every preset is a valid layout too, and each has something in it', () => {
  for (const [name, layout] of Object.entries(LAYOUT_PRESETS)) {
    assert.ok(layout.length > 0, `${name} is not empty`)
    assert.deepEqual(sanitizeLayout(layout), layout, `${name} survives cleaning unchanged`)
    assert.equal(new Set(ids(layout)).size, layout.length, `${name} has no duplicates`)
  }
})

test('a damaged stored layout is cleaned instead of breaking the page', () => {
  assert.deepEqual(sanitizeLayout(null), [])
  assert.deepEqual(sanitizeLayout('nope'), [])
  assert.deepEqual(sanitizeLayout([null, 4, 'x', { size: 'l' }, { id: 'Bad Id' }]), [])
  assert.deepEqual(sanitizeLayout([{ id: 'saved', size: 'huge' }]), [{ id: 'saved', size: 'm' }], 'an unknown size falls back to medium')
  assert.deepEqual(sanitizeLayout([{ id: 'saved' }, { id: 'saved', size: 'l' }]), [{ id: 'saved', size: 'm' }], 'a duplicate is kept once, at its first place')
})

test('a hand-edited layout cannot grow without limit', () => {
  const huge = Array.from({ length: 200 }, (_, i) => ({ id: `w${i}`, size: 's' }))
  assert.equal(sanitizeLayout(huge).length, 40)
})

test('the layout is stored as JSON text, and unreadable text means "use the default"', () => {
  const text = serializeLayout(DEFAULT_LAYOUT)
  assert.deepEqual(parseLayout(text), DEFAULT_LAYOUT)
  assert.equal(parseLayout('{not json'), null)
  assert.equal(parseLayout(''), null)
  assert.equal(parseLayout(undefined), null)
  assert.equal(parseLayout(7), null)
})

test('widgets whose module is off, or that no longer exist, are skipped and not deleted', () => {
  const known = new Set(['saved', 'habits', 'tasks'])
  const out = resolveLayout([{ id: 'saved', size: 's' }, { id: 'ghost', size: 'm' }, { id: 'habits', size: 'm' }], (id) => known.has(id))
  assert.deepEqual(ids(out), ['saved', 'habits'])
  // The stored list is untouched: turning the module back on brings it back in place.
  const stored = [{ id: 'saved', size: 's' as const }, { id: 'left-to-spend', size: 'm' as const }]
  assert.deepEqual(resolveLayout(stored, (id) => id === 'saved'), [{ id: 'saved', size: 's' }])
  assert.equal(stored.length, 2)
})

test('adding a widget appends it once; adding it again changes nothing', () => {
  const one = addWidget([], 'saved', 'm')
  assert.deepEqual(one, [{ id: 'saved', size: 'm' }])
  assert.equal(addWidget(one, 'saved', 'l'), one, 'the same object back: no change, no re-render')
  assert.deepEqual(ids(addWidget(one, 'habits', 'l')), ['saved', 'habits'])
})

test('removing a widget leaves the others in order', () => {
  const l: PlacedWidget[] = [{ id: 'a', size: 's' }, { id: 'b', size: 'm' }, { id: 'c', size: 'l' }]
  assert.deepEqual(ids(removeWidget(l, 'b')), ['a', 'c'])
  assert.deepEqual(ids(removeWidget(l, 'ghost')), ['a', 'b', 'c'])
})

test('moving a widget up and down keeps the others in order', () => {
  const l: PlacedWidget[] = [{ id: 'a', size: 's' }, { id: 'b', size: 'm' }, { id: 'c', size: 'l' }]
  assert.deepEqual(ids(moveWidgetBy(l, 'c', -1)), ['a', 'c', 'b'])
  assert.deepEqual(ids(moveWidgetBy(l, 'a', 1)), ['b', 'a', 'c'])
  assert.deepEqual(ids(moveWidget(l, 'b', 0)), ['b', 'a', 'c'], 'to the top')
  assert.deepEqual(ids(moveWidget(l, 'a', 99)), ['b', 'c', 'a'], 'to the end')
  assert.deepEqual(ids(moveWidgetBy(l, 'a', -1)), ids(l), 'moving the first one up changes nothing')
  assert.deepEqual(ids(moveWidgetBy(l, 'c', 1)), ids(l), 'moving the last one down changes nothing')
  assert.deepEqual(ids(moveWidgetBy(l, 'ghost', 1)), ids(l), 'an unknown id changes nothing')
})

test('resizing swaps the preset and never invents a size', () => {
  const l: PlacedWidget[] = [{ id: 'a', size: 's' }, { id: 'b', size: 'm' }]
  assert.deepEqual(setWidgetSize(l, 'a', 'l'), [{ id: 'a', size: 'l' }, { id: 'b', size: 'm' }])
  // When a widget stops offering the size it was saved with.
  assert.equal(normaliseSize('s', ['m', 'l']), 'm')
  assert.equal(normaliseSize('s', ['s']), 's')
  assert.equal(normaliseSize('l', ['s']), 's')
})

test('widgets are placed left to right and wrap to a new row when a row is full', () => {
  const l: PlacedWidget[] = [
    { id: 'a', size: 's' }, { id: 'b', size: 's' }, { id: 'c', size: 's' }, { id: 'd', size: 's' }, // 3+3+3+3 = 12
    { id: 'e', size: 'm' }
  ]
  const slots = placeWidgets(l, 12)
  assert.deepEqual(slots.map((s) => [s.offset, s.row]), [[0, 0], [3, 0], [6, 0], [9, 0], [0, 1]])
  for (const s of slots) assert.ok(fits(s.offset, s.columns, 12), `${s.id} fits`)
})

test('a widget wider than the free space starts on the next row instead of overflowing', () => {
  // S (3) takes 3 cols. L (12) needs 12 and 9 remain, so it starts on row 1.
  // M (6) follows on row 2 because row 1 is occupied by L.
  const slots = placeWidgets([{ id: 'a', size: 's' }, { id: 'b', size: 'l' }, { id: 'c', size: 'm' }], 12)
  assert.deepEqual(slots.map((s) => [s.id, s.offset, s.row]), [['a', 0, 0], ['b', 0, 1], ['c', 0, 2]])
})

test('on a narrow grid a large widget takes the whole width rather than sticking out', () => {
  for (const columns of [12, 6, 3, 1]) {
    const slots = placeWidgets(DEFAULT_LAYOUT, columns)
    for (const s of slots) {
      assert.ok(s.columns <= columns, `${s.id} is not wider than the grid (${columns})`)
      assert.ok(fits(s.offset, s.columns, columns), `${s.id} fits (${columns})`)
      assert.ok(s.offset >= 0 && s.columns > 0)
    }
  }
})

test('every widget of a layout lands on exactly one cell of the grid', () => {
  const slots = placeWidgets(DEFAULT_LAYOUT, 12)
  assert.equal(slots.length, DEFAULT_LAYOUT.length)
  const cells = new Set<string>()
  for (const s of slots) for (let c = s.offset; c < s.offset + s.columns; c++) {
    const key = `${s.row}:${c}`
    assert.ok(!cells.has(key), `${s.id} overlaps at ${key}`)
    cells.add(key)
  }
})

test('the add menu offers only what is not already on the dashboard', () => {
  const registry = [{ id: 'a' }, { id: 'b' }, { id: 'c' }]
  assert.deepEqual(availableWidgets(registry, [{ id: 'b', size: 'm' }]), [{ id: 'a' }, { id: 'c' }])
})

test('responsive column spans map cleanly across 12, 6 and 1 column widths', () => {
  // S = 3, M = 6, L = 12 on 12-col desktop
  assert.deepEqual(placeWidgets([{ id: 'a', size: 's' }], 12).map((s) => s.columns), [3])
  assert.deepEqual(placeWidgets([{ id: 'a', size: 'm' }], 12).map((s) => s.columns), [6])
  assert.deepEqual(placeWidgets([{ id: 'a', size: 'l' }], 12).map((s) => s.columns), [12])

  // 6 columns (compact / half-window): S = 3 (half), M = 6 (full), L = 6 (full)
  assert.deepEqual(placeWidgets([{ id: 'a', size: 's' }], 6).map((s) => s.columns), [3])
  assert.deepEqual(placeWidgets([{ id: 'a', size: 'm' }], 6).map((s) => s.columns), [6])
  assert.deepEqual(placeWidgets([{ id: 'a', size: 'l' }], 6).map((s) => s.columns), [6])

  // 1 column (mobile stack): everything is 1
  assert.deepEqual(placeWidgets([{ id: 'a', size: 's' }], 1).map((s) => s.columns), [1])
  assert.deepEqual(placeWidgets([{ id: 'a', size: 'l' }], 1).map((s) => s.columns), [1])
})

console.log(`\n${n} dashboard layout checks passed`)
