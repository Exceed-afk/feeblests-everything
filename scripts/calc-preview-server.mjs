// Serves the Calculator layout harness (see vite.calch.config.ts and src/renderer/calcPreview.html).
// Only for screenshots: it is not part of the app and serves nothing else.
import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { extname, join, normalize, resolve } from 'node:path'

const ROOT = resolve('.calch')
const PORT = Number(process.env.CALCH_PORT ?? 5207)
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png' }

createServer(async (req, res) => {
  const path = decodeURIComponent((req.url ?? '/').split('?')[0])
  const file = join(ROOT, normalize(path))
  const send = (body, type) => { res.writeHead(200, { 'content-type': type, 'cache-control': 'no-store' }); res.end(body) }
  try {
    if (!file.startsWith(ROOT)) throw new Error('outside')
    send(await readFile(file), TYPES[extname(file)] ?? 'application/octet-stream')
  } catch {
    try { send(await readFile(join(ROOT, 'calcPreview.html')), TYPES['.html']) }
    catch { res.writeHead(404); res.end('Build the harness first: npx vite build --config vite.calch.config.ts') }
  }
}).listen(PORT, '127.0.0.1', () => console.log(`Calc harness: http://localhost:${PORT}/`))
