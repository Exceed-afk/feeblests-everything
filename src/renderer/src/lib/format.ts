// Number formatting for money and prices.
export const fmtNum = (n: number): string =>
  n.toLocaleString(undefined, { maximumFractionDigits: 8 })

// Profit/loss with a sign: +1,234.50 or -80.00. Tiny amounts keep more decimals.
export const fmtPnl = (n: number): string => {
  const digits = Math.abs(n) >= 1 || n === 0 ? 2 : 6
  const text = Math.abs(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: digits })
  return `${n > 0 ? '+' : n < 0 ? '-' : ''}${text}`
}

export const pnlColor = (n: number | null): string =>
  n === null || n === 0 ? 'text-muted' : n > 0 ? 'text-pos' : 'text-neg'

// Plain amount with two decimals: 1,234.50
export const fmtAmount = (n: number): string =>
  n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
