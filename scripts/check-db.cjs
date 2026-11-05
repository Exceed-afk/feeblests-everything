// Quick schema check against the real app database (read-only). Uses the
// system-Node addon copy the tests use (tests/sqlite.ts points there too).
const path = require('path')
const root = path.join(__dirname, '..')
const binding = path.join(root, 'node_modules', 'better-sqlite3', 'build-node', 'Release', 'better_sqlite3.node')
const Database = require('better-sqlite3')(process.env.BETTER_SQLITE3_BINDING
    ? undefined
    : undefined, { nativeBinding: require('fs').existsSync(binding) ? binding : undefined })
void Database
const path = require('path')
const dbPath = path.join(process.env.APPDATA, "Feeblest's Everything", 'data', 'everything.db')
const db = new Database(dbPath, { readonly: true })
console.log('user_version =', db.pragma('user_version', { simple: true }))
const cols = db.prepare("PRAGMA table_info('trades')").all().map((c) => c.name)
console.log('trades columns:', cols.join(', '))
console.log('closed_at set on', db.prepare('SELECT COUNT(*) c FROM trades WHERE closed_at IS NOT NULL').get().c, 'of', db.prepare('SELECT COUNT(*) c FROM trades').get().c, 'trades')
db.close()
