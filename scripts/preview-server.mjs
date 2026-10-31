// Serves the design preview (see vite.preview.config.ts and src/renderer/preview.html) on http://localhost:5199/.
// Only for looking at the Review page in an ordinary browser: it is not part of the app and serves nothing else.
import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { extname, join, normalize, resolve } from 'node:path'

const ROOT = resolve('.preview')
const PORT = Number(process.env.PREVIEW_PORT ?? 5199)
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png' }

createServer(async (req, res) => {
  const path = decodeURIComponent((req.url ?? '/').split('?')[0])
  const file = join(ROOT, normalize(path)) // normalize + the join keeps ".." from escaping .preview
  const send = (body, type) => { res.writeHead(200, { 'content-type': type, 'cache-control': 'no-store' }); res.end(body) }
  try {
    if (!file.startsWith(ROOT)) throw new Error('outside')
    send(await readFile(file), TYPES[extname(file)] ?? 'application/octet-stream')
  } catch {
    try { send(await readFile(join(ROOT, 'preview.html')), TYPES['.html']) } // anything else gets the preview page
    catch { res.writeHead(404); res.end('Build the preview first: npm run preview') }
  }
}).listen(PORT, '127.0.0.1', () => console.log(`Design preview: http://localhost:${PORT}/`))
