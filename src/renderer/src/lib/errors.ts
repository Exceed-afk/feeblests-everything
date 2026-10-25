// Electron wraps errors from the main process like:
//   "Error invoking remote method 'x': Error: Real message"
// This keeps only the real message so it can be shown to the user.
export const errMsg = (e: unknown): string =>
  String(e instanceof Error ? e.message : e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
