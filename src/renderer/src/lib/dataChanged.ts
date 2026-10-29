// Pages call this with the function that reloads what they show. When something is saved from the small Quick capture
// window (a different window, so these pages cannot see it happen), the main process sends a message and `refresh` runs.
// It only RELOADS the lists: it never remounts a page, so a half-written entry in an open editor is not touched.
import { useEffect } from 'react'

export function useRefreshOnCapture(refresh: () => void): void {
  useEffect(() => window.api.capture.onDataChanged(refresh), [refresh])
}
