// Number formatting for money and prices.
export const fmtNum = (n: number): string =>
  n.toLocaleString(undefined, { maximumFractionDigits: 8 })

// Floating point can give 0.1 + 0.2 = 0.30000000000000004.
// Rounding to 8 decimals removes that noise (crypto uses up to 8).
export const round8 = (n: number): number => Math.round(n * 1e8) / 1e8

// Profit/loss with a sign: +1,234.50 or -80.00. Tiny amounts keep more decimals.
export const fmtPnl = (n: number): string => {
  const rounded = round8(n)
  const digits = Math.abs(rounded) >= 1 || rounded === 0 ? 2 : 6
  const text = Math.abs(rounded).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: digits })
  return `${rounded > 0 ? '+' : rounded < 0 ? '-' : ''}${text}`
}

export const pnlColor = (n: number | null): string =>
  n === null || n === 0 ? 'text-muted' : n > 0 ? 'text-pos' : 'text-neg'

// Plain amount with two decimals: 1,234.50 (without sign; callers add '+' or '-').
export const fmtAmount = (n: number): string =>
  Math.abs(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
