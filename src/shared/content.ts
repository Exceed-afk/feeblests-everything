// Content planner (Phase 3): shapes and pure rules.
//
// An item moves through a fixed pipeline: idea -> script -> record -> edit ->
// publish -> published. Everything about the item (checklists, stage dates,
// assets) is JSON on one row, so a card is always consistent and a stage change
// is one UPDATE.

export const CONTENT_STAGES = ['idea', 'script', 'record', 'edit', 'publish', 'published'] as const
export type ContentStage = (typeof CONTENT_STAGES)[number]

export const isContentStage = (v: unknown): v is ContentStage =>
  typeof v === 'string' && (CONTENT_STAGES as readonly string[]).includes(v)

export const CONTENT_STAGE_LABELS: Record<ContentStage, string> = {
  idea: 'Idea',
  script: 'Script',
  record: 'Record',
  edit: 'Edit',
  publish: 'Publish',
  published: 'Published'
}

export const CONTENT_TYPES = ['video', 'short', 'stream', 'post'] as const
export type ContentType = (typeof CONTENT_TYPES)[number]

export const isContentType = (v: unknown): v is ContentType =>
  typeof v === 'string' && (CONTENT_TYPES as readonly string[]).includes(v)

export const CONTENT_TYPE_LABELS: Record<ContentType, string> = {
  video: 'Video',
  short: 'Short',
  stream: 'Stream',
  post: 'Post'
}

// The next stage on the pipeline, or null at the end.
export function nextStage(stage: ContentStage): ContentStage | null {
  const i = CONTENT_STAGES.indexOf(stage)
  return i === -1 || i === CONTENT_STAGES.length - 1 ? null : CONTENT_STAGES[i + 1]
}

export function previousStage(stage: ContentStage): ContentStage | null {
  const i = CONTENT_STAGES.indexOf(stage)
  return i <= 0 ? null : CONTENT_STAGES[i - 1]
}

// One checklist line attached to a stage.
export interface StageChecklistItem { id: string; stage: ContentStage; text: string; done: boolean }

// Stage dates the user typed ("record day", "edit day", ...). Missing stages
// simply have no date.
export type StageDates = Partial<Record<ContentStage, string>>

// A reference to a local file. The path is stored, never the file, so large
// videos are not copied into the app.
export interface ContentAsset { path: string; label: string; kind: 'video' | 'audio' | 'image' | 'file' }

export interface ContentItem {
  id: number
  title: string
  type: ContentType
  platform: string
  hook: string
  stage: ContentStage
  position: number
  series: string
  tags: string[]
  targetPublishDate: string | null
  publishedDate: string | null
  publishedUrl: string | null
  scriptNoteId: number | null
  checklist: StageChecklistItem[]
  stageDates: StageDates
  assets: ContentAsset[]
  streamStart: string | null // "YYYY-MM-DDTHH:MM" local, streams only
  streamMinutes: number | null
  views24h: number | null
  views7d: number | null
  postNotes: string
  createdAt: string
  updatedAt: string
  // Filled in by the service for board and lists; not stored on this row.
  checklistDone?: number
  checklistTotal?: number
  scriptNoteTitle?: string | null
}

export interface ContentInput {
  title: string
  type: ContentType
  platform?: string
  hook?: string
  stage?: ContentStage
  series?: string
  tags?: string[]
  targetPublishDate?: string | null
  publishedDate?: string | null
  publishedUrl?: string | null
  scriptNoteId?: number | null
  checklist?: StageChecklistItem[]
  stageDates?: StageDates
  assets?: ContentAsset[]
  streamStart?: string | null
  streamMinutes?: number | null
  views24h?: number | null
  views7d?: number | null
  postNotes?: string
}

// ---------- the built-in stage checklists ----------
// Seeded from these when an item first reaches a stage, and available as a
// template ("Record: audio check, lighting, backups"). The user can add or
// remove items afterwards; nothing is re-seeded over their edits.
export const STAGE_CHECKLIST_TEMPLATES: Record<ContentStage, string[]> = {
  idea: ['Capture the idea in one sentence', 'Note who it is for and why it matters'],
  script: ['Write the hook first', 'Outline the middle', 'Plan the call to action'],
  record: ['Audio check', 'Lighting check', 'Backups running', 'Do a test take'],
  edit: ['Cut dead air', 'Captions', 'Thumbnail', 'Watch it end to end'],
  publish: ['Title', 'Description', 'Tags', 'Schedule it'],
  published: ['Record views at 24 hours', 'Record views at 7 days', 'Note what to do differently']
}

// A stable id for a checklist line, unique within one item.
export function checklistId(stage: ContentStage, text: string, taken: Set<string>): string {
  const base = `${stage}:${text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40)}`
  let id = base
  let n = 2
  while (taken.has(id)) id = `${base}-${n++}`
  taken.add(id)
  return id
}

// Adds the built-in checklist for a stage, skipping lines that already exist
// (so moving a card back and forth never duplicates anything).
export function seedStageChecklist(
  existing: StageChecklistItem[], stage: ContentStage, template = STAGE_CHECKLIST_TEMPLATES[stage]
): StageChecklistItem[] {
  const taken = new Set(existing.map((i) => i.id))
  const present = new Set(existing.filter((i) => i.stage === stage).map((i) => i.text))
  const added = template.filter((text) => !present.has(text))
    .map((text) => ({ id: checklistId(stage, text, taken), stage, text, done: false }))
  return [...existing, ...added]
}

// Moves an item to a stage and seeds that stage's checklist if it has none.
export function moveToStage(item: Pick<ContentItem, 'stage' | 'checklist'>, stage: ContentStage): { checklist: StageChecklistItem[]; seeded: boolean } {
  const has = item.checklist.some((i) => i.stage === stage)
  if (has) return { checklist: item.checklist, seeded: false }
  return { checklist: seedStageChecklist(item.checklist, stage), seeded: true }
}

// Stage progress for a card: how many of the CURRENT stage's lines are done.
export function stageProgress(checklist: StageChecklistItem[], stage: ContentStage): { done: number; total: number } {
  const items = checklist.filter((i) => i.stage === stage)
  return { done: items.filter((i) => i.done).length, total: items.length }
}

// True when the item's script note is linked but the note no longer exists.
// Used only by the UI, which asks the service whether the note is live.
export const hasScript = (item: Pick<ContentItem, 'scriptNoteId'>): boolean => item.scriptNoteId !== null

// A published item is one with a publish date and a URL, whatever the stage
// column says; the calendar and reports use this rather than trusting the stage.
export function isPublished(item: Pick<ContentItem, 'stage' | 'publishedDate'>): boolean {
  return item.stage === 'published' || item.publishedDate !== null
}
