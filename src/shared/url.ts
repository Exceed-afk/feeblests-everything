// Only web links may leave the app (opened in the user's browser). file:, javascript:, data: and
// custom protocols are refused, as is anything that is not a valid absolute URL.
export const isWebUrl = (url: string): boolean => {
  try { const p = new URL(url).protocol; return p === 'http:' || p === 'https:' } catch { return false }
}
