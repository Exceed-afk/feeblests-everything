// Builds the better-sqlite3 native addon for BOTH runtimes the project needs.
//
// Why two builds?
//   - The desktop app runs inside Electron, which needs the addon compiled for
//     Electron's Node (ABI 130).
//   - `npm test` runs under the system Node (ABI 127), which needs its own build.
//
// A single .node file cannot serve both, so we keep one build per runtime:
//   - node_modules/better-sqlite3/build/Release/  -> Electron (the app)
//   - node_modules/better-sqlite3/build-node/    -> system Node (the tests)
//
// Run it with: npm run build:native
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, copyFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const pkg = join(root, 'node_modules', 'better-sqlite3')
const releaseDir = join(pkg, 'build', 'Release')
const nodeBuildDir = join(pkg, 'build-node', 'Release')

function run(command, args, cwd) {
  console.log('>', command, args.join(' '))
  execFileSync(command, args, { cwd, stdio: 'inherit', shell: process.platform === 'win32' })
}

// 1. Build for the system Node (this is what the tests load).
run('npx', ['node-gyp', 'rebuild', '--release'], pkg)

// 2. Copy that Node build out of the way, so the Electron build can replace it.
mkdirSync(nodeBuildDir, { recursive: true })
const built = readdirSync(releaseDir).filter((name) => name.endsWith('.node'))
if (built.length === 0) throw new Error('No .node file was produced by node-gyp.')
for (const name of built) {
  copyFileSync(join(releaseDir, name), join(nodeBuildDir, name))
}
console.log('Saved the system-Node build in', nodeBuildDir)

// 3. Build for Electron and leave it in build/Release (where the app looks).
run('npx', ['electron-rebuild', '-f', '-w', 'better-sqlite3'], root)

if (!existsSync(join(releaseDir, 'better_sqlite3.node'))) {
  throw new Error('The Electron build is missing better_sqlite3.node.')
}
console.log('\nDone. The app uses build/Release and the tests use build-node/Release.')
