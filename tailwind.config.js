const path = require('path')

// Colors come from CSS variables (see styles.css), so switching dark/light
// mode or changing the accent color never needs a rebuild.
const v = (name) => `rgb(var(--${name}) / <alpha-value>)`

module.exports = {
  darkMode: 'class',
  content: [path.join(__dirname, 'src/renderer/index.html'), path.join(__dirname, 'src/renderer/src/**/*.{ts,tsx}')],
  theme: {
    extend: {
      colors: {
        bg: v('bg'), panel: v('panel'), card: v('card'), line: v('line'),
        fg: v('fg'), muted: v('muted'), accent: v('accent')
      },
      fontFamily: { sans: ['"Segoe UI Variable"', '"Segoe UI"', 'system-ui', 'sans-serif'] },
      boxShadow: { card: '0 1px 2px rgb(0 0 0 / 0.18), 0 8px 24px -12px rgb(0 0 0 / 0.35)' }
    }
  },
  plugins: []
}
