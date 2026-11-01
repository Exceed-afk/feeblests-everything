// Opens an in-memory SQLite database for the tests.
//
// Why this file exists:
// The app runs inside Electron and loads the better-sqlite3 addon from
// node_modules/better-sqlite3/build/Release. That build is compiled for
// Electron's Node version, so the system Node used by `npm test` cannot load it.
//
// `npm run build:native` keeps a second copy of the addon, compiled for the
// system Node, in build-node/Release. This helper points better-sqlite3 at that
// copy. If it is missing, we fall back to the normal build, which is fine when
// both runtimes happen to use the same ABI.
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import Database from 'better-sqlite3'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')

// The system-Node copy of the native addon, if it was built.
const nodeBinding = join(root, 'node_modules', 'better-sqlite3', 'build-node', 'Release', 'better_sqlite3.node')

// The options that point better-sqlite3 at a specific build.
const options = existsSync(nodeBinding) ? { nativeBinding: nodeBinding } : {}

/**
 * Opens a database. Pass ':memory:' for a temporary one, or a file path.
 */
export function openDatabase(file = ':memory:'): Database.Database {
  return new Database(file, options)
}

export default openDatabase
