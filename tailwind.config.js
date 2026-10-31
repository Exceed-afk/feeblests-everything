const path = require('path')

// Colors come from CSS variables (see styles.css), so switching dark/light
// mode or changing the accent color never needs a rebuild.
const v = (name) => `rgb(var(--${name}) / <alpha-value>)`

// Density: every padding, margin and gap is multiplied by --d (compact 0.8, comfortable 1,
// spacious 1.2), so one setting changes the spacing of the whole app. Widths, heights and
// icon sizes are left alone. Same numbers as Tailwind's default scale (0.25rem per step).
const steps = [0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4, 5, 6, 7, 8, 9, 10, 11, 12, 14, 16, 20, 24, 28, 32, 36, 40, 44, 48, 52, 56, 60, 64, 72, 80, 96]
const spaced = Object.fromEntries([['0', '0px'], ...steps.map((n) => [String(n), `calc(${n * 0.25}rem * var(--d))`])])

module.exports = {
  darkMode: 'class',
  content: [path.join(__dirname, 'src/renderer/index.html'), path.join(__dirname, 'src/renderer/src/**/*.{ts,tsx}')],
  theme: {
    extend: {
      colors: {
        bg: v('bg'), panel: v('panel'), card: v('card'), line: v('line'),
        fg: v('fg'), muted: v('muted'), accent: v('accent'),
        'on-accent': v('on-accent'), // readable text on an accent-filled button (white, or dark for light accents)
        'accent-fg': v('accent-fg'), // the accent used as text on the page background
        // Meaning colours (gains / losses / caution). Darker in light mode, lighter in dark mode, so text stays readable.
        pos: v('pos'), neg: v('neg'), warn: v('warn'),
        // mood: the one neutral chart colour (mood trend, savings goal bar). Not a good / bad meaning.
        mood: v('mood')
      },
      // Corner roundness: --rs is 0.2 (sharp), 1 (soft, the original look) or 1.7 (round).
      borderRadius: {
        sm: 'calc(0.125rem * var(--rs))', DEFAULT: 'calc(0.25rem * var(--rs))', md: 'calc(0.375rem * var(--rs))',
        lg: 'calc(0.5rem * var(--rs))', xl: 'calc(0.75rem * var(--rs))', '2xl': 'calc(1rem * var(--rs))', '3xl': 'calc(1.5rem * var(--rs))'
      },
      padding: spaced, margin: spaced, gap: spaced, space: spaced,
      fontFamily: { sans: ['var(--font-ui)'] },
      boxShadow: { card: 'var(--shadow-card)' }
    }
  },
  plugins: []
}
