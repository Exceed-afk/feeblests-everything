// Markdown rendering for Notes (Phase 2) — the RENDERER-ONLY layer.
//
// IMPORTANT: this file imports `marked` and DOMPurify, which are ESM/browser
// only. Only the renderer may import it. The main process uses the DOM-free
// helpers in src/shared/markdownText.ts (note titles, search text, tag and
// checklist scanning). Everything pure is re-exported below, so a renderer
// file can import from either module.
//
// Security posture (the plan's note): raw HTML is DISABLED in the parser, and
// the output is sanitised again before it reaches the DOM. Both layers are on
// purpose:
//   1. `marked` runs with `html: false`, so embedded HTML in a note is shown as
//      text, never parsed;
//   2. DOMPurify strips anything not on the small allow-list below (scripts,
//      event handlers, styles, iframes, forms, `javascript:` URLs and so on).
// Links are rendered with `target="_blank"` plus `rel="noopener noreferrer"`;
// the app's navigation guard sends http(s) clicks to the user's browser through
// the hardened `shell.openExternal` path (src/shared/url.ts), and blocks the
// rest. This module never opens anything itself.
import { Marked, type Tokens } from 'marked'
import DOMPurify from 'dompurify'
import { linkifyWikiLinks, WIKI_PROTOCOL } from './markdownText'

// The pure helpers, re-exported so callers have one obvious import for rendering.
export {
  WIKI_PROTOCOL, wikiSlug, findWikiLinks, splitCodeAndText, findChecklistItems,
  setChecklistItemDone, wordCount, findHashtags, plainSummary, linkifyWikiLinks
} from './markdownText'
export type { WikiLinkRef, ChecklistItem } from './markdownText'

// marked with raw HTML off. `breaks` keeps single newlines as line breaks,
// which is what people expect when typing notes.
const marked = new Marked({ gfm: true, breaks: true, async: false })

const escapeAttr = (v: string): string =>
  v.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

marked.use({
  renderer: {
    html(): string { return '' }, // raw HTML never reaches the output, even if the parser lets it through
    link(this: { parser: { parseInline: (tokens: Tokens.Generic[]) => string } }, token: Tokens.Link): string {
      const href = token.href ?? ''
      const text = this.parser.parseInline(token.tokens)
      const title = token.title ? ` title="${escapeAttr(token.title)}"` : ''
      // Only http(s) and in-app note links become anchors; anything else
      // (javascript:, data:, file:) is shown as plain text.
      const external = /^https?:\/\//i.test(href)
      if (!external && !href.startsWith(WIKI_PROTOCOL)) return text
      return `<a href="${escapeAttr(href)}"${title}${external ? ' target="_blank" rel="noopener noreferrer"' : ''}>${text}</a>`
    }
  }
})

// The tags and attributes a rendered note may keep. Everything else is removed.
const ALLOWED_TAGS = ['p', 'br', 'strong', 'b', 'em', 'i', 'del', 's', 'code', 'pre', 'blockquote', 'ul', 'ol', 'li', 'a', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'hr', 'input', 'table', 'thead', 'tbody', 'tr', 'th', 'td']
const ALLOWED_ATTR = ['href', 'title', 'target', 'rel', 'type', 'checked', 'disabled', 'class', 'align']

// Markdown to a SAFE HTML string. Two layers: raw HTML off in marked, then
// DOMPurify against the allow-list above. The renderer inserts this with
// dangerouslySetInnerHTML, so it must stay sanitised.
export function renderMarkdown(markdown: string): string {
  const html = marked.parse(linkifyWikiLinks(markdown)) as string
  return DOMPurify.sanitize(html, { ALLOWED_TAGS, ALLOWED_ATTR, ALLOW_DATA_ATTR: false })
}
