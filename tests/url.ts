// Checks for the rule that decides which links the app may open outside itself.
//   npm test
import assert from 'node:assert/strict'
import { isWebUrl } from '../src/shared/url'

let n = 0
const test = (name: string, fn: () => void) => { fn(); n++; console.log('ok  ', name) }

test('http and https links are allowed', () => {
  assert.equal(isWebUrl('https://example.com/page?x=1#top'), true)
  assert.equal(isWebUrl('http://localhost:5173'), true)
  assert.equal(isWebUrl('HTTPS://EXAMPLE.COM'), true)
})
test('file, javascript, data and custom protocols are refused', () => {
  for (const u of ['file:///C:/Windows/System32/calc.exe', 'javascript:alert(1)', 'data:text/html,<b>x</b>', 'ms-msdt:/id', 'vscode://x', 'ftp://example.com', 'mailto:a@b.c'])
    assert.equal(isWebUrl(u), false, u)
})
test('things that are not absolute URLs are refused', () => {
  for (const u of ['', 'example.com', '/relative/path', '//example.com', 'not a url', 'https:'.slice(0, 0)])
    assert.equal(isWebUrl(u), false, u)
})

console.log(`\n${n} url checks passed`)
