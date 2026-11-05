// Integration tests for Content (Phase 6):
// Insights (output vs focus), Assistant (content_pipeline), Review (videos published).
import assert from 'node:assert/strict'
import { openDatabase } from './sqlite'
import { applyMigrations } from '../src/main/migrations'
import { createContentItem } from '../src/main/content'
import { buildInsights, INSIGHT_IDS } from '../src/shared/insights'
import { ASSISTANT_FUNCTIONS } from '../src/shared/assistant'
import { buildReview } from '../src/shared/review'

let n = 0
const test = (name: string, fn: () => void) => { fn(); n++; console.log('ok  ', name) }

const openDb = () => {
  const db = openDatabase()
  db.pragma('foreign_keys = ON')
  applyMigrations(db)
  return db
}

test('Content in Insights: output-vs-focus correlation exists', () => {
  const insights = buildInsights({
    today: '2026-11-04',
    start: '2026-10-01',
    end: '2026-11-04',
    habits: [],
    tasks: [],
    completions: [],
    trades: [],
    txs: [],
    entries: [],
    focusSessions: [
      { startedAt: '2026-11-01T10:00:00.000Z', endedAt: '2026-11-01T14:00:00.000Z', type: 'focus' },
      { startedAt: '2026-11-02T10:00:00.000Z', endedAt: '2026-11-02T15:00:00.000Z', type: 'focus' },
      { startedAt: '2026-11-03T10:00:00.000Z', endedAt: '2026-11-03T13:00:00.000Z', type: 'focus' },
      { startedAt: '2026-11-04T10:00:00.000Z', endedAt: '2026-11-04T16:00:00.000Z', type: 'focus' }
    ],
    contentPublished: [
      { id: 1, publishedDate: '2026-11-01' },
      { id: 2, publishedDate: '2026-11-02' },
      { id: 3, publishedDate: '2026-11-04' }
    ]
  })

  const outputInsight = insights.correlations.find((c) => c.id === INSIGHT_IDS.outputVsFocus)
  assert.ok(outputInsight)
  assert.ok(outputInsight.text.includes('Content output') || outputInsight.needText?.includes('focus time'))
})

test('Content in Assistant: content_pipeline tool reports items across stages', () => {
  const fn = ASSISTANT_FUNCTIONS.find((f) => f.name === 'content_pipeline')
  assert.ok(fn, 'content_pipeline tool exists in assistant')

  const res = fn.run(
    {
      txs: [],
      goals: [],
      trades: [],
      habits: [],
      tasks: [],
      completions: [],
      entries: [],
      contentItems: [
        { id: 1, title: 'Phase 6 Deep Dive', stage: 'edit', platform: 'YouTube', targetPublishDate: '2026-11-10', publishedDate: null },
        { id: 2, title: 'Shorts on SQLite', stage: 'idea', platform: 'TikTok', targetPublishDate: null, publishedDate: null }
      ]
    },
    { from: '2026-11-01', to: '2026-11-15' },
    '2026-11-04',
    {}
  )

  assert.equal(res.type, 'list')
  if (res.type === 'list') {
    assert.equal(res.rows.length, 2)
    assert.ok(res.rows[0].label.includes('Phase 6 Deep Dive (edit)'))
    assert.ok(res.rows[1].label.includes('Shorts on SQLite (idea)'))
  }
})

test('Content in Review: videos published count is aggregated', () => {
  const review = buildReview({
    kind: 'week',
    anchor: '2026-11-03',
    today: '2026-11-04',
    trades: [],
    goals: [],
    txs: [],
    habits: [],
    tasks: [],
    entries: [],
    contentPublished: 3
  })

  assert.equal(review.contentPublished, 3)
})

console.log(`\n${n} content integration checks passed`)
