// Trade database queries (same pattern as logbook.ts).
import type Database from 'better-sqlite3'
import { calcPnl } from '../shared/trades'
import { cleanTags, escapeLike, isDate, searchWhere } from './util'
import type { ParsedQuery } from '../shared/search'
import type { Direction, SearchGroup, Trade, TradeFilter, TradeInput, TradeMeta } from '../shared/types'
import { emitAutomation } from './automations'

interface Row {
  id: number; date: string; asset: string; direction: Direction; entry_price: number
  exit_price: number | null; quantity: number; fees: number; notes: string
  tags: string; created_at: string; updated_at: string
}

const toTrade = (r: Row): Trade => {
  const base = {
    id: r.id, date: r.date, asset: r.asset, direction: r.direction, entryPrice: r.entry_price,
    exitPrice: r.exit_price, quantity: r.quantity, fees: r.fees, notes: r.notes,
    tags: JSON.parse(r.tags) as string[], createdAt: r.created_at, updatedAt: r.updated_at
  }
  return { ...base, pnl: calcPnl(base) }
}

export function listTrades(db: Database.Database, f: TradeFilter = {}): Trade[] {
  const where: string[] = []
  const params: string[] = []
  if (f.from) { where.push('date >= ?'); params.push(f.from) }
  if (f.to) { where.push('date <= ?'); params.push(f.to) }
  if (f.direction) { where.push('direction = ?'); params.push(f.direction) }
  if (f.tag) {
    where.push('EXISTS (SELECT 1 FROM json_each(tags) WHERE value = ?)')
    params.push(f.tag)
  }
  if (f.text?.trim()) {
    const like = `%${escapeLike(f.text.trim())}%`
    where.push("(asset LIKE ? ESCAPE '\\' OR notes LIKE ? ESCAPE '\\')")
    params.push(like, like)
  }
  const sql = `SELECT * FROM trades ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
               ORDER BY date DESC, id DESC`
  return (db.prepare(sql).all(...params) as Row[]).map(toTrade)
}

// Existing assets and tags, used for autocomplete and the tag filter.
export function tradeMeta(db: Database.Database): TradeMeta {
  const assets = (db.prepare('SELECT DISTINCT asset FROM trades ORDER BY asset').all() as { asset: string }[])
    .map((r) => r.asset)
  const tags = db.prepare(
    `SELECT value AS tag, COUNT(*) AS count FROM trades, json_each(trades.tags)
     GROUP BY value ORDER BY count DESC, tag`
  ).all() as TradeMeta['tags']
  return { assets, tags }
}

// Checks the input is sane before it touches the database.
function prepare(i: TradeInput) {
  const asset = i.asset.trim().toUpperCase()
  if (!isDate(i.date)) throw new Error('Date must look like 2026-10-25')
  if (!asset) throw new Error('Asset is required')
  if (i.direction !== 'long' && i.direction !== 'short') throw new Error('Direction must be long or short')
  if (!(i.entryPrice > 0)) throw new Error('Entry price must be above 0')
  if (i.exitPrice !== null && !(i.exitPrice > 0)) throw new Error('Exit price must be above 0')
  if (!(i.quantity > 0)) throw new Error('Size must be above 0')
  if (!(i.fees >= 0)) throw new Error('Fees cannot be negative')
  return {
    date: i.date, asset, direction: i.direction, entry: i.entryPrice, exit: i.exitPrice,
    quantity: i.quantity, fees: i.fees, notes: i.notes, tags: JSON.stringify(cleanTags(i.tags))
  }
}

function getTrade(db: Database.Database, id: number): Trade {
  const row = db.prepare('SELECT * FROM trades WHERE id = ?').get(id) as Row | undefined
  if (!row) throw new Error('Trade not found')
  return toTrade(row)
}

export function createTrade(db: Database.Database, input: TradeInput): Trade {
  const t = prepare(input)
  const now = new Date().toISOString()
  const info = db.prepare(
    `INSERT INTO trades (date, asset, direction, entry_price, exit_price, quantity, fees, notes, tags, created_at, updated_at)
     VALUES (@date, @asset, @direction, @entry, @exit, @quantity, @fees, @notes, @tags, @now, @now)`
  ).run({ ...t, now })
  const trade = getTrade(db, Number(info.lastInsertRowid))
  if (trade.exitPrice !== null && trade.pnl !== null) {
    emitAutomation(db, 'trade-closed', `trade:${trade.id}`, {
      tradeId: trade.id, tradePnl: trade.pnl, tradeAsset: trade.asset, tradeDate: trade.date
    }, { recentTrades: allTradesLight(db) })
  }
  return trade
}

export function updateTrade(db: Database.Database, id: number, input: TradeInput): Trade {
  const t = prepare(input)
  const before = db.prepare('SELECT exit_price FROM trades WHERE id = ?').get(id) as { exit_price: number | null } | undefined
  db.prepare(
    `UPDATE trades SET date=@date, asset=@asset, direction=@direction, entry_price=@entry, exit_price=@exit,
     quantity=@quantity, fees=@fees, notes=@notes, tags=@tags, updated_at=@now WHERE id=@id`
  ).run({ ...t, id, now: new Date().toISOString() })
  const trade = getTrade(db, id)
  // A trade CLOSING (was open, now has an exit) is an automation event.
  if (before && before.exit_price === null && trade.exitPrice !== null && trade.pnl !== null) {
    emitAutomation(db, 'trade-closed', `trade:${trade.id}`, {
      tradeId: trade.id, tradePnl: trade.pnl, tradeAsset: trade.asset, tradeDate: trade.date
    }, { recentTrades: allTradesLight(db) })
  }
  return trade
}

// The light rows the trade rules need (date + pnl + id), for consecutiveLosses
// and tradesOnDate. PnL computed via calcPnl; nothing else leaves the row shape.
function allTradesLight(db: Database.Database): { id: number; date: string; pnl: number | null }[] {
  const rows = db.prepare('SELECT id, date, direction, entry_price, exit_price, quantity, fees FROM trades').all() as Row[]
  return rows.map((row) => ({
    id: row.id,
    date: row.date,
    pnl: row.exit_price === null ? null : calcPnl({ direction: row.direction as TradeInput['direction'], entryPrice: row.entry_price, exitPrice: row.exit_price, quantity: row.quantity, fees: row.fees })
  }))
}

export function deleteTrade(db: Database.Database, id: number): void {
  db.prepare('DELETE FROM trades WHERE id = ?').run(id)
}

// Universal search: asset, notes, tags, date and direction ("long" / "short"). Newest first.
export function searchTrades(db: Database.Database, q: ParsedQuery, limit: number): SearchGroup<Trade> {
  const w = searchWhere(q, ['asset', 'notes', 'tags', 'date', 'direction'], 'tags')
  const items = (db.prepare(`SELECT * FROM trades WHERE ${w.sql} ORDER BY date DESC, id DESC LIMIT ?`)
    .all(...w.params, limit) as Row[]).map(toTrade)
  const { n } = db.prepare(`SELECT COUNT(*) AS n FROM trades WHERE ${w.sql}`).get(...w.params) as { n: number }
  return { items, total: n }
}

// Dashboard: the newest few trades.
export function recentTrades(db: Database.Database, limit: number): Trade[] {
  return (db.prepare('SELECT * FROM trades ORDER BY date DESC, id DESC LIMIT ?').all(limit) as Row[]).map(toTrade)
}
