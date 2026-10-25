// Floating point can give 0.1 + 0.2 = 0.30000000000000004.
// Rounding to 8 decimals removes that noise (crypto uses up to 8).
export const round8 = (n: number): number => Math.round(n * 1e8) / 1e8
