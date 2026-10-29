// Quick capture as plain functions (no Electron, no React), so the rules can be tested:
//   - which keyboard shortcuts are allowed, and how a key press becomes one,
//   - how the text typed into the small capture window becomes a valid note, trade or deposit,
//   - which habits the capture window lists.
// The window and the shortcut themselves live in src/main/capture.ts; the form is modules/Capture.tsx.
import { isScheduled } from './habits'
import type { CaptureSettings, Direction, Habit, LogEntryInput, Mood, SavingsTxInput, TradeInput, TxKind } from './types'

// ---------- Settings ----------

export const DEFAULT_HOTKEY = 'CommandOrControl+Shift+Space'
export const DEFAULT_CAPTURE: CaptureSettings = { enabled: true, hotkey: DEFAULT_HOTKEY, keepRunning: false }

// The three rows in the settings table.
export const CAPTURE_SETTING_KEYS = { enabled: 'captureEnabled', hotkey: 'captureHotkey', keepRunning: 'captureKeepRunning' } as const

// Whatever is stored (even something hand-edited or imported from another machine) becomes a usable setting.
export function readCaptureSettings(raw: Record<string, unknown>): CaptureSettings {
  const checked = checkAccelerator(raw[CAPTURE_SETTING_KEYS.hotkey])
  return {
    enabled: raw[CAPTURE_SETTING_KEYS.enabled] !== false,
    hotkey: checked.ok ? checked.value : DEFAULT_HOTKEY,
    keepRunning: raw[CAPTURE_SETTING_KEYS.keepRunning] === true
  }
}

// ---------- Keyboard shortcuts ----------
// An "accelerator" is Electron's text form of a shortcut: modifiers and one key joined by "+", e.g. "Control+Alt+J".

const MODIFIERS: Record<string, string> = {
  commandorcontrol: 'CommandOrControl', cmdorctrl: 'CommandOrControl',
  command: 'Command', cmd: 'Command',
  control: 'Control', ctrl: 'Control',
  alt: 'Alt', option: 'Alt',
  shift: 'Shift',
  super: 'Super', meta: 'Super'
}
const MODIFIER_ORDER = ['CommandOrControl', 'Command', 'Control', 'Alt', 'Shift', 'Super']

const NAMED_KEYS: Record<string, string> = {
  space: 'Space', tab: 'Tab', backspace: 'Backspace', delete: 'Delete', del: 'Delete', insert: 'Insert',
  return: 'Return', enter: 'Return', up: 'Up', down: 'Down', left: 'Left', right: 'Right',
  home: 'Home', end: 'End', pageup: 'PageUp', pagedown: 'PageDown', plus: 'Plus'
}
const PUNCTUATION = '`-=[]\\;\',./'

// Shortcuts that would break the computer (or every other program), whatever else is added.
const BLOCKED = ['Alt+F4', 'CommandOrControl+Alt+Delete', 'Control+Alt+Delete', 'Command+Alt+Delete']

type KeyKind = 'printable' | 'other'
function normalizeKey(raw: string): { key: string; kind: KeyKind } | null {
  if (raw.length === 1) {
    if (/^[a-z]$/i.test(raw)) return { key: raw.toUpperCase(), kind: 'printable' }
    if (/^\d$/.test(raw) || PUNCTUATION.includes(raw)) return { key: raw, kind: 'printable' }
    return null
  }
  const f = /^f(\d{1,2})$/i.exec(raw)
  if (f && Number(f[1]) >= 1 && Number(f[1]) <= 24) return { key: `F${Number(f[1])}`, kind: 'other' }
  const named = NAMED_KEYS[raw.toLowerCase()]
  if (named) return { key: named, kind: named === 'Plus' ? 'printable' : 'other' }
  return null
}

export type AcceleratorCheck = { ok: true; value: string } | { ok: false; reason: string }

// Checks a shortcut and returns it in one canonical spelling, or says why it cannot be used.
// Two rules protect the user: a shortcut needs Ctrl / Alt / the Windows or Command key (Shift alone would stop you typing
// capitals), and a letter, digit or punctuation key needs TWO modifiers, because Ctrl+C, Alt+S and friends belong to every other program.
export function checkAccelerator(input: unknown): AcceleratorCheck {
  if (typeof input !== 'string' || input.trim() === '') return { ok: false, reason: 'Press the keys you want to use.' }
  const parts = input.split('+').map((p) => p.trim())
  if (parts.some((p) => p === '')) return { ok: false, reason: 'That shortcut is not written correctly.' }
  const keyText = parts[parts.length - 1]
  if (/^esc(ape)?$/i.test(keyText)) return { ok: false, reason: 'Escape closes the capture window, so it cannot be the shortcut.' }
  const key = normalizeKey(keyText)
  if (!key) return { ok: false, reason: `"${keyText}" cannot be used as the shortcut key.` }

  const mods: string[] = []
  for (const m of parts.slice(0, -1)) {
    const canon = MODIFIERS[m.toLowerCase()]
    if (!canon) return { ok: false, reason: `"${m}" is not a modifier key.` }
    if (mods.includes(canon)) return { ok: false, reason: `${canon} is repeated.` }
    mods.push(canon)
  }
  if (mods.includes('CommandOrControl') && (mods.includes('Command') || mods.includes('Control'))) {
    return { ok: false, reason: 'Use either Ctrl or Command (not both spellings).' }
  }
  if (!mods.some((m) => m !== 'Shift')) return { ok: false, reason: 'Include Ctrl (Cmd on a Mac), Alt or the Windows key. Shift alone would stop you typing capital letters.' }
  if (key.kind === 'printable' && mods.length < 2) return { ok: false, reason: 'A single modifier with a letter is used by almost every program. Combine two, such as Ctrl+Shift+K.' }

  const value = [...MODIFIER_ORDER.filter((m) => mods.includes(m)), key.key].join('+')
  if (BLOCKED.includes(value)) return { ok: false, reason: 'The system keeps that shortcut for itself.' }
  return { ok: true, value }
}

// What a key press means as a shortcut, for the "press the new shortcut" box. Uses the physical key (`code`), so Shift+1 is "1" and not "!",
// and the shortcut is the same on every keyboard layout. Returns null while only modifier keys are held.
// The result still goes through checkAccelerator.
export interface KeyEventLike { code: string; ctrlKey: boolean; metaKey: boolean; altKey: boolean; shiftKey: boolean }

const CODE_KEYS: Record<string, string> = {
  Space: 'Space', Tab: 'Tab', Enter: 'Return', Backspace: 'Backspace', Delete: 'Delete', Insert: 'Insert',
  Home: 'Home', End: 'End', PageUp: 'PageUp', PageDown: 'PageDown',
  ArrowUp: 'Up', ArrowDown: 'Down', ArrowLeft: 'Left', ArrowRight: 'Right',
  Minus: '-', Equal: '=', BracketLeft: '[', BracketRight: ']', Backslash: '\\', Semicolon: ';', Quote: "'",
  Comma: ',', Period: '.', Slash: '/', Backquote: '`', Escape: 'Escape'
}

export function acceleratorFromKeyEvent(e: KeyEventLike, isMac: boolean): string | null {
  let key: string | undefined = CODE_KEYS[e.code]
  const letter = /^Key([A-Z])$/.exec(e.code), digit = /^Digit(\d)$/.exec(e.code), fn = /^F\d{1,2}$/.exec(e.code)
  if (letter) key = letter[1]
  else if (digit) key = digit[1]
  else if (fn) key = e.code
  if (!key) return null // a modifier on its own, or a key we do not offer
  const mods: string[] = []
  if (e.ctrlKey) mods.push(isMac ? 'Control' : 'CommandOrControl') // on a Mac, Cmd is the "Ctrl" of everyone else
  if (e.metaKey) mods.push(isMac ? 'CommandOrControl' : 'Super')
  if (e.altKey) mods.push('Alt')
  if (e.shiftKey) mods.push('Shift')
  return [...mods, key].join('+')
}

// A shortcut as people read it: "Ctrl+Shift+Space", or "⌃⇧Space" on a Mac.
export function formatAccelerator(acc: string, isMac: boolean): string {
  const shown = acc.split('+').map((p) => {
    if (isMac) return ({ CommandOrControl: '⌘', Command: '⌘', Control: '⌃', Alt: '⌥', Shift: '⇧', Super: '⌘' } as Record<string, string>)[p] ?? p
    return ({ CommandOrControl: 'Ctrl', Command: 'Cmd', Control: 'Ctrl', Super: 'Win' } as Record<string, string>)[p] ?? p
  })
  return isMac ? shown.join('') : shown.join('+')
}

// ---------- The capture forms ----------

export type Built<T> = { ok: true; value: T } | { ok: false; error: string }
const fail = (error: string): { ok: false; error: string } => ({ ok: false, error })

export const NOTE_TITLE_MAX = 80

// "work, #idea  sleep" -> ["work", "idea", "sleep"]
export function parseTags(text: string): string[] {
  return [...new Set(text.split(/[,\s]+/).map((t) => t.replace(/^#+/, '').toLowerCase()).filter(Boolean))]
}

// One box of text becomes a logbook entry: the first line is the title, the rest is the body. A first line that is too
// long for a title is cut (with "...") and the whole text is kept as the body, so nothing typed is ever lost.
export function buildNote(i: { text: string; mood: Mood | null; tags: string; today: string }): Built<LogEntryInput> {
  const text = i.text.replace(/\r\n/g, '\n').trim()
  if (!text) return fail('Write something first.')
  const lines = text.split('\n')
  const first = lines[0].trim()
  let title = first
  let body = lines.slice(1).join('\n').trim()
  if (Array.from(first).length > NOTE_TITLE_MAX) {
    title = Array.from(first).slice(0, NOTE_TITLE_MAX).join('').trimEnd() + '…'
    body = text
  }
  return { ok: true, value: { date: i.today, title, body, mood: i.mood, tags: parseTags(i.tags) } }
}

const num = (s: string): number => (s.trim() === '' ? NaN : Number(s))
const positive = (n: number): boolean => Number.isFinite(n) && n > 0

// The same rules as the Trades page. A blank exit means the trade is still open, and blank fees mean 0.
export function buildTrade(i: { asset: string; direction: Direction; entry: string; exit: string; qty: string; fees: string; today: string }): Built<TradeInput> {
  const asset = i.asset.trim()
  if (!asset) return fail('Enter the asset.')
  const entryPrice = num(i.entry)
  if (!positive(entryPrice)) return fail('Entry price must be above 0.')
  const exitPrice = i.exit.trim() === '' ? null : num(i.exit)
  if (exitPrice !== null && !positive(exitPrice)) return fail('Exit price must be above 0, or leave it blank for a trade that is still open.')
  const quantity = num(i.qty)
  if (!positive(quantity)) return fail('Size must be above 0.')
  const fees = i.fees.trim() === '' ? 0 : num(i.fees)
  if (!Number.isFinite(fees) || fees < 0) return fail('Fees must be 0 or more.')
  return { ok: true, value: { date: i.today, asset, direction: i.direction, entryPrice, exitPrice, quantity, fees, notes: '', tags: [] } }
}

export function buildDeposit(i: { goalId: number | null; kind: TxKind; amount: string; note: string; today: string }): Built<SavingsTxInput> {
  if (i.goalId === null) return fail('Choose a savings goal.')
  const amount = num(i.amount)
  if (!positive(amount)) return fail('Enter an amount above 0.')
  return { ok: true, value: { goalId: i.goalId, date: i.today, kind: i.kind, amount, note: i.note.trim() } }
}

// ---------- Habits in the capture window ----------

export interface CaptureHabit { id: number; name: string; done: boolean; streak: number }

// Active habits scheduled today (or already checked today), unfinished first. `rest` counts the active habits that are
// off today and so not listed, so the window can say "2 habits are resting today" instead of looking like they vanished.
export function habitsForToday(habits: Habit[], today: string): { items: CaptureHabit[]; rest: number } {
  const items: CaptureHabit[] = []
  let rest = 0
  for (const h of habits) {
    if (h.archived) continue
    const done = h.checkins.includes(today)
    if (isScheduled(h.days, today) || done) items.push({ id: h.id, name: h.name, done, streak: h.stats.current })
    else rest++
  }
  items.sort((a, b) => Number(a.done) - Number(b.done) || a.name.localeCompare(b.name))
  return { items, rest }
}
