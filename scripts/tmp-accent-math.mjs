const WHITE = [255, 255, 255]
const ch = (v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4 }
const lum = (c) => 0.2126 * ch(c[0]) + 0.7152 * ch(c[1]) + 0.0722 * ch(c[2])
const contrast = (a, b) => { const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x); return (hi + 0.05) / (lo + 0.05) }
const accent = [139, 92, 246]
const pageLight = [244, 245, 244]
const pageDark = [17, 23, 21]
console.log('accent vs white:', contrast(accent, WHITE).toFixed(2))
const mix = (a, b, t) => a.map((x, i) => Math.round(x + (b[i] - x) * t))
for (const page of [pageLight, pageDark]) {
  let best = null
  for (let t = 0; t <= 0.5; t += 0.02) {
    const c = mix(accent, page, t)
    if (contrast(WHITE, c) >= 4.5) { best = { t: t.toFixed(2), c, ratio: contrast(WHITE, c).toFixed(2) }; break }
  }
  console.log('page', page, '->', JSON.stringify(best))
}
