// Floating point can give 0.1 + 0.2 = 0.30000000000000004.
// Rounding to 8 decimals removes that noise (crypto uses up to 8).
export const round8 = (n: number): number => Math.round(n * 1e8) / 1e8

// Number formatting for money and prices.
export const fmtNum = (n: number): string =>
  round8(n).toLocaleString(undefined, { maximumFractionDigits: 8 })

// Profit/loss with a sign: +1,234.50 or -80.00. Tiny amounts keep more decimals.
// Uses round8 to avoid floating-point noise.
export const fmtPnl = (n: number): string => {
  const absN = Math.abs(n)
  const digits = absN >= 1 || n === 0 ? 2 : 6
  const text = round8(Math.abs(n)).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: digits,
  })
  return `${n > 0 ? '+' : n < 0 ? '-' : ''}${text}`
}

// Plain amount with two decimals: 1,234.50
export const fmtAmount = (n: number): string =>
  round8(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })

// Profit/loss colour class based on sign.
export const pnlColor = (n: number | null): string =>
  n === null || n === 0 ? 'text-muted' : n > 0 ? 'text-pos' : 'text-neg'