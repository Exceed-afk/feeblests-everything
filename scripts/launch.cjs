// Launches the built Electron app with ELECTRON_RUN_AS_NODE removed, because
// a machine-level copy of that variable forces the exe to act as plain Node.
// Pass "--remote-debugging-port=9222" as argv[2] to also open a DevTools port
// (used by scripts/qa-insights-height.mjs to measure the real layout).
const { spawn } = require('child_process')
const path = require('path')

const root = path.join(__dirname, '..')
const exe = path.join(root, 'node_modules', 'electron', 'dist', 'electron.exe')

const env = { ...process.env }
delete env.ELECTRON_RUN_AS_NODE

const args = process.argv[2] ? [process.argv[2], '.'] : ['.']
const child = spawn(exe, args, { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'], detached: false })
child.stdout.on('data', (d) => process.stdout.write(d))
child.stderr.on('data', (d) => process.stderr.write(d))
child.on('exit', (code) => { console.log(`[launch] electron exited with code ${code}`); process.exitCode = code })
