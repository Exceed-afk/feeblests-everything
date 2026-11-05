// One dashboard summary request, shared by every widget that reads it.
//
// The four stat tiles and the savings, P&L and log widgets all read
// window.api.dashboard.summary(). A promise is kept for a moment, so widgets
// that mount together (as they do when the dashboard first draws) make ONE
// request instead of seven. A failed request is not kept: the next widget asks
// again.
//
// This lives apart from the widget components so the Dashboard page can drop
// the cache without importing (and therefore bundling) any widget: the tiles
// stay a lazy chunk.
import type { DashboardData } from '../../../shared/types'
import { today } from '../lib/dates'

let cache: { at: number; promise: Promise<DashboardData> } | null = null
const SUMMARY_TTL = 1500 // ms

export function loadSummary(): Promise<DashboardData> {
  const now = Date.now()
  if (!cache || now - cache.at > SUMMARY_TTL) {
    cache = {
      at: now,
      promise: window.api.dashboard.summary(today()).catch((e) => { cache = null; throw e })
    }
  }
  return cache.promise
}

// Drops the shared request, so the next widget reads fresh numbers (called when
// the dashboard is edited, or something changed elsewhere, e.g. an undo).
export const invalidateSummary = (): void => { cache = null }
