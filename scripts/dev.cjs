// Runs electron-vite dev with ELECTRON_RUN_AS_NODE removed (same reason as launch.cjs).
const { spawn } = require('child_process')
const path = require('path')

const root = path.join(__dirname, '..')
const env = { ...process.env }
delete env.ELECTRON_RUN_AS_NODE

const child = spawn('npx electron-vite dev', { cwd: root, env, stdio: 'inherit', shell: true })
child.on('exit', (code) => { process.exitCode = code })