// Launches the built Electron app with ELECTRON_RUN_AS_NODE removed, because
// a machine-level copy of that variable forces the exe to act as plain Node.
const { spawn } = require('child_process')
const path = require('path')

const root = path.join(__dirname, '..')
const exe = path.join(root, 'node_modules', 'electron', 'dist', 'electron.exe')

const env = { ...process.env }
delete env.ELECTRON_RUN_AS_NODE

const child = spawn(exe, ['.'], { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'], detached: false })
child.stdout.on('data', (d) => process.stdout.write(d))
child.stderr.on('data', (d) => process.stderr.write(d))
child.on('exit', (code) => { console.log(`[launch] electron exited with code ${code}`); process.exitCode = code })
