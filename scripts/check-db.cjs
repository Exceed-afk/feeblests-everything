// Quick schema check against the real app database (read-only).
// Uses the system-Node addon copy that tests/sqlite.ts points at, so it runs
// under plain Node while the app's own build targets Electron's ABI.
const { existsSync } = require('fs')
const path = require('path')
const Database = require('better-sqlite3')

const root = path.join(__dirname, '..')
const nodeBinding = path.join(root, 'node_modules', 'better-sqlite3', 'build-node', 'Release', 'better_sqlite3.node')
const options = existsSync(nodeBinding) ? { nativeBinding: nodeBinding } : {}

const dbPath = path.join(process.env.APPDATA, "Feeblest's Everything", 'data', 'everything.db')
const db = new Database(dbPath, { readonly: true, ...options })
console.log('user_version =', db.pragma('user_version', { simple: true }))
console.log('trades columns:', db.prepare("PRAGMA table_info('trades')").all().map((c) => c.name).join(', '))
const withClosed = db.prepare('SELECT COUNT(*) AS c FROM trades WHERE closed_at IS NOT NULL').get().c
const total = db.prepare('SELECT COUNT(*) AS c FROM trades').get().c
console.log(`closed_at set on ${withClosed} of ${total} trades`)
console.log('dismissals:', db.prepare("SELECT value FROM settings WHERE key = 'insightDismissals'").get()?.value ?? '(none)')
db.close()
