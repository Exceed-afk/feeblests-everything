// Universal search, served by the SHARED FTS5 index (Phase 0).
//
// One table (search_index, migration 21) holds the searchable text of every
// live item; each write keeps its row in step (src/main/searchIndex.ts), so
// search no longer asks each module for its own LIKE query against live data.
// The results keep the SAME grouped shape the Search page has always shown:
// one group per item kind, uncapped `total`, capped `items`.
//
// Query semantics (kept deliberately close to the old LIKE search):
//   - every plain word must appear as words (FTS tokens are whole words now,
//     so "gold" no longer matches "golden" - a real upgrade for noise);
//   - a #tag matches tags that START with it (a tag's words become a phrase
//     whose last word is a prefix, exactly how tags behave in the text);
//   - empty or punctuation-only searches return nothing.
import type Database from 'better-sqlite3'
import { isEmptyQuery, parseQuery, type ParsedQuery } from '../shared/search'
import { getEntriesByIds } from './logbook'
import { getTradesByIds } from './trades'
import { getGoalsByIds, getTransactionsByIds } from './savings'
import { getTasksByIds } from './tasks'
import { getNotesByIds, notePreview } from './notes'
import { getContentByIds } from './content'
import { getSnippetsByIds, getScratchpadsByIds } from './tools'
import { getExpenseTransactionsByIds } from '../modules/expenses/service/transactions'
import { getSessionsByIds } from './focus'
import type { SearchGroup, SearchResults } from '../shared/types'

const DEFAULT_LIMIT = 8
const MAX_LIMIT = 100

// Builds the FTS5 MATCH expression from a parsed query.
//   "gold breakout" -> `"gold" AND "breakout"`  (each word can contain a
//                     hyphen, which becomes a phrase "eth usdt" for "eth-usdt")
//   "#risk"         -> `"risk"*`                 (tags start-with the word)
//   "#x/y"          -> `"x y"*`                  (the tag's words in order)
function ftsExpression(q: ParsedQuery): string {
  const parts: string[] = []
  for (const term of q.terms) {
    const words = term.replace(/[^\p{L}\p{N}]+/gu, ' ').trim().split(/\s+/).filter(Boolean)
    if (words.length > 0) parts.push(`"${words.join(' ')}"`)
  }
  for (const tag of q.tags) {
    const words = tag.replace(/[^\p{L}\p{N}]+/gu, ' ').trim().split(/\s+/).filter(Boolean)
    if (words.length > 0) parts.push(`"${words.join(' ')}"*`)
  }
  return parts.join(' AND ')
}

const matchIds = (db: Database.Database, expr: string, type: string, limit: number): number[] => {
  try {
    return (db.prepare(
      `SELECT entity_id AS id FROM search_index WHERE search_index MATCH ? AND entity_type = ? LIMIT ?`
    ).all(expr, type, limit) as { id: number }[]).map((r) => r.id)
  } catch {
    return [] // a malformed expression must never break the page; empty beats a crash
  }
}

const countMatches = (db: Database.Database, expr: string, type: string): number => {
  try {
    return (db.prepare(`SELECT COUNT(*) AS n FROM search_index WHERE search_index MATCH ? AND entity_type = ?`).get(expr, type) as { n: number }).n
  } catch {
    return 0
  }
}

export function runSearch(db: Database.Database, text: string, limit: number = DEFAULT_LIMIT): SearchResults {
  const q = parseQuery(text)
  const n = Math.min(MAX_LIMIT, Math.max(1, Math.floor(Number(limit)) || DEFAULT_LIMIT))
  const emptyResults: SearchResults = {
    logbook: { items: [], total: 0 },
    trades: { items: [], total: 0 },
    goals: { items: [], total: 0 },
    transactions: { items: [], total: 0 },
    tasks: { items: [], total: 0 },
    notes: { items: [], total: 0 },
    content: { items: [], total: 0 },
    snippets: { items: [], total: 0 },
    expenses: { items: [], total: 0 },
    focus: { items: [], total: 0 },
    scratchpads: { items: [], total: 0 }
  }
  if (isEmptyQuery(q)) {
    return emptyResults
  }
  const expr = ftsExpression(q)
  if (expr === '') {
    return emptyResults
  }
  // Groups fill by matching ids first (cheap, from the index), then each
  // module hydrates its own rows, so label shapes stay owned by their files.
  const logbook = getEntriesByIds(db, matchIds(db, expr, 'logbook', n))
  const trades = getTradesByIds(db, matchIds(db, expr, 'trade', n))
  const goals = getGoalsByIds(db, matchIds(db, expr, 'goal', n))
  const transactions = getTransactionsByIds(db, matchIds(db, expr, 'savings_tx', n))
  const tasks = getTasksByIds(db, matchIds(db, expr, 'task', n))
  const notes = getNotesByIds(db, matchIds(db, expr, 'note', n)).map((note) => ({
    id: note.id, title: note.title, updatedAt: note.updatedAt, tags: note.tags, preview: notePreview(note, 120)
  }))
  const content = getContentByIds(db, matchIds(db, expr, 'content', n)).map((item) => ({
    id: item.id, title: item.title, stage: item.stage, platform: item.platform, targetPublishDate: item.targetPublishDate
  }))
  const snippets = getSnippetsByIds(db, matchIds(db, expr, 'snippet', n)).map((s) => ({
    id: s.id, title: s.title, tags: s.tags, preview: s.body.slice(0, 120)
  }))
  const expenses = getExpenseTransactionsByIds(db, matchIds(db, expr, 'expense_tx', n)).map((e) => ({
    id: e.id, payee: e.payee, amount: e.amount, currency: e.currency, date: e.date, type: e.type, note: e.note
  }))
  const focus = getSessionsByIds(db, matchIds(db, expr, 'time_session', n)).map((s) => ({
    id: s.id, projectName: s.projectName, note: s.note, startedAt: s.startedAt, actualSeconds: s.actualSeconds, type: s.type
  }))
  const scratchpads = getScratchpadsByIds(db, matchIds(db, expr, 'scratchpad', n)).map((p) => ({
    id: p.id, name: p.name, content: p.content.slice(0, 120)
  }))
  return {
    logbook: { items: logbook, total: countMatches(db, expr, 'logbook') },
    trades: { items: trades, total: countMatches(db, expr, 'trade') },
    goals: { items: goals, total: countMatches(db, expr, 'goal') },
    transactions: { items: transactions, total: countMatches(db, expr, 'savings_tx') },
    tasks: { items: tasks, total: countMatches(db, expr, 'task') },
    notes: { items: notes, total: countMatches(db, expr, 'note') },
    content: { items: content, total: countMatches(db, expr, 'content') },
    snippets: { items: snippets, total: countMatches(db, expr, 'snippet') },
    expenses: { items: expenses, total: countMatches(db, expr, 'expense_tx') },
    focus: { items: focus, total: countMatches(db, expr, 'time_session') },
    scratchpads: { items: scratchpads, total: countMatches(db, expr, 'scratchpad') }
  }
}
