// Link shapes and rules, pure so every side (main service, renderer picker,
// tests) agrees on them without importing database code (Phase 0).
//
// One `links` row says "A is related to B". The writer normalises the pair so
// the link is stored ONCE with the earlier type as the source; every query
// then reads both sides of that row, so a link made from either side shows on
// both. A link to a trashed item is hidden at read time and reappears when
// the item is restored.

// The linkable kinds of items. These are the entity types Links, Tags and the
// module contract share (a savings transaction links through its goal).
// Phase 2/3 add notes and content items.
export const LINK_TYPES = ['logbook', 'trade', 'goal', 'task', 'note', 'content'] as const
export type LinkType = (typeof LINK_TYPES)[number]

export const LINK_TYPE_LABELS: Record<LinkType, string> = {
  logbook: 'Journal entry',
  trade: 'Trade',
  goal: 'Savings goal',
  task: 'Task',
  note: 'Note',
  content: 'Content item'
}

export interface LinkEndpoint { type: LinkType; id: number }

// One linked item as a read shows it: the OTHER end of the link (relative to
// the item the UI is looking at), with a label for the list.
export interface LinkedItemRef {
  linkId: number
  type: LinkType
  id: number
  label: string
  sublabel?: string
  direction: 'out' | 'in'
  relation: string
  createdAt: string
}

export const isLinkType = (v: unknown): v is LinkType => typeof v === 'string' && (LINK_TYPES as readonly string[]).includes(v)

// The relation word. 'related' today; more kinds later without a migration.
export type LinkRelation = 'related'
export const DEFAULT_RELATION: LinkRelation = 'related'

// Swaps the pair, when needed, so the source is always the type that comes
// first in LINK_TYPES. This is what makes "the same link twice" impossible
// with the unique index in migration 18.
export function orderLinkPair(a: LinkEndpoint, b: LinkEndpoint): { source: LinkEndpoint; target: LinkEndpoint } {
  if (a.type === b.type) {
    // Same type both ends: the smaller id is the source, deterministic.
    return a.id <= b.id ? { source: a, target: b } : { source: b, target: a }
  }
  const ai = LINK_TYPES.indexOf(a.type)
  const bi = LINK_TYPES.indexOf(b.type)
  return ai <= bi ? { source: a, target: b } : { source: b, target: a }
}
