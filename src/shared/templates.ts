// Template shapes and the variable engine, pure (Phase 0).
//
// A template is a saved starter: a kind ('logbook', 'task', ... from
// TEMPLATE_KINDS), a name and a payload — the JSON of the fields it prefills.
// `{{variables}}` inside any payload text are filled at create time from the
// user's local day, the same bucketing the backup filenames use. Unknown
// variables are left alone, so `{{project}}` from Phase 3 does not become an
// empty string today.

export const TEMPLATE_KINDS = ['logbook', 'task', 'note', 'content', 'trade'] as const
export type TemplateKind = (typeof TEMPLATE_KINDS)[number]

export const isTemplateKind = (v: unknown): v is TemplateKind =>
  typeof v === 'string' && (TEMPLATE_KINDS as readonly string[]).includes(v)

// The variables every render gets. `date` is the local YYYY-MM-DD; `weekday`
// the local weekday name; `time` the local HH:MM.
export interface TemplateVars { date: string; weekday: string; time: string }

export const TEMPLATE_VARIABLES = ['{{date}}', '{{weekday}}', '{{time}}'] as const

// One template row as the saved/stored JSON (payload is an object here).
export interface Template {
  id: number
  kind: TemplateKind
  name: string
  payload: unknown // JSON value; its shape is decided by the kind
  isBuiltin: boolean
  createdAt: string
  updatedAt: string
}

export interface TemplateInput { kind: TemplateKind; name: string; payload: unknown }

// Fills the known `{{variables}}` in any string. Every string, at any depth of
// the payload, gets the same treatment; IDs and numbers are left alone.
export function renderTemplate(value: unknown, vars: TemplateVars): unknown {
  if (typeof value === 'string') {
    return value
      .replace(/\{\{\s*date\s*\}\}/g, vars.date)
      .replace(/\{\{\s*weekday\s*\}\}/g, vars.weekday)
      .replace(/\{\{\s*time\s*\}\}/g, vars.time)
  }
  if (Array.isArray(value)) return value.map((item) => renderTemplate(item, vars))
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[k] = renderTemplate(v, vars)
    return out
  }
  return value
}

// The local-day variables used by every render call (main and renderer share
// this so a template never depends on who filled it). Kept next to the rules
// rather than in a DOM lib: no window needed.
export function templateVars(d: Date = new Date()): TemplateVars {
  const date = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  const weekday = WEEKDAYS[d.getDay()]
  const time = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
  return { date, weekday, time }
}

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
