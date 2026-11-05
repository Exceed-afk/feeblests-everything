// Types shared by main, preload and renderer. Add new data shapes here.

export type ThemeMode = 'dark' | 'light' | 'system'
export type UiStyle = 'modern' | 'minimal'              // overall look: rounded + shadows, or flat + hairlines
export type Radius = 'sharp' | 'soft' | 'round'         // corner roundness
export type Density = 'compact' | 'comfortable' | 'spacious' // padding, margins and gaps
export type TextSize = 'small' | 'default' | 'large'
export type TaskLayout = 'list' | 'board' // how the Tasks tool shows its tasks
export type TaskSort = 'manual' | 'due-date' | 'priority'
export type FontChoice = 'system' | 'clean' | 'serif' | 'mono'

// Hand-picked colours that replace part of the chosen palette (#rrggbb). Kept per mode.
export interface ColorOverrides { bg?: string; sidebar?: string; surface?: string; text?: string }

export interface Settings {
  intelligence: IntelligenceSettings // per-feature intelligence toggles (step 1)
  theme: ThemeMode
  accent: string // hex color, e.g. "#8b5cf6"
  tagColors: Record<string, string> // tag name -> hex color; tags not listed use the accent color
  palette: string // unified colour-theme id, see PALETTES in shared/appearance.ts
  uiStyle: UiStyle
  radius: Radius
  density: Density
  textSize: TextSize
  font: FontChoice
  colors: { light: ColorOverrides; dark: ColorOverrides }
  sidebarCollapsed: boolean // icons only
  pinnedTools: string[] // tool ids pinned to the top of the sidebar, in pin order
  sidebarClosedGroups: string[] // ids of sidebar groups the user has collapsed (all others are open)
  recentTools: string[] // tool ids, most recently opened first (at most 8); shown when the command palette is empty
  taskLayout: TaskLayout // Tasks: the list or the board, remembered between sessions
  taskSort: TaskSort
  taskSavedViews: TaskSavedView[]
  disabledModules: string[] // tool ids turned off in Settings > Modules (Phase 0)
  trash: TrashSettings // how long the Trash keeps things before purging (Phase 0)
  focus: FocusSettings // Pomodoro focus settings (Phase 4)
  dashboardLayout: string // Phase 6: the Dashboard's widget order and sizes, as JSON (see shared/dashboardLayout.ts)
}

// Phase 0: the Trash (auto-purge window; 30 days unless changed).
export interface TrashSettings { purgeDays: number }

// Default intelligence feature toggles. Daily briefing is on; everything else is off.
export const DEFAULT_INTELLIGENCE: IntelligenceSettings = {
  features: { dailyBriefing: true, automations: false, smartQuickAdd: false, insights: false, aiAssistant: false }
}

// The shared defaults used before saved settings are loaded.
export const DEFAULT_SETTINGS: Settings = {
  intelligence: DEFAULT_INTELLIGENCE,
  theme: 'dark', accent: '#8b5cf6', tagColors: {},
  palette: 'default', uiStyle: 'modern', radius: 'soft', density: 'comfortable', textSize: 'default', font: 'system',
  colors: { light: {}, dark: {} }, sidebarCollapsed: false, pinnedTools: [], sidebarClosedGroups: [],   recentTools: [], taskLayout: 'list', taskSort: 'manual', taskSavedViews: [],
  disabledModules: [], trash: { purgeDays: 30 },
  focus: DEFAULT_FOCUS_SETTINGS,
  dashboardLayout: '' // empty text = the shipped arrangement (LAYOUT_PRESETS.default)
}

// The API the renderer can call. The preload script implements it and
// the main process answers it (see src/main/index.ts).
interface IntelligenceApiInner {
  get(): Promise<IntelligenceSettings>
  set(features: Partial<IntelligenceFeatureToggles>): Promise<IntelligenceSettings>
  automations: {
    get(): Promise<AutomationSettings>
    set(patch: Partial<AutomationSettings>): Promise<AutomationSettings>
    activity(): Promise<AutomationActivity[]>
    deleteActivity(id: number): Promise<void>
    clearActivity(): Promise<void>
    staleTasks(): Promise<{ id: number; title: string; daysOverdue: number }[]>
  }
  insights: {
    build(today: string): Promise<InsightsPayload>
    dismiss(id: string, dismissed: boolean, mode?: 'snooze' | 'hide' | 'restore', today?: string): Promise<InsightDismissal[]>
  }
  assistant: {
    get(): Promise<AssistantSettings>
    set(patch: Partial<AssistantSettings>): Promise<AssistantSettings>
    keyStatus(): Promise<AssistantKeyStatus>
    setKey(key: string): Promise<{ ok: true } | { ok: false; error: string }>
    clearKey(): Promise<void>
    functions(): Promise<AssistantFunctionInfo[]>
    ask(question: string, today: string, previousRequest?: import('./assistant').AssistantFollowUp | null): Promise<AskOutcome>
  }
}

export interface EverythingApi {
  settings: {
    getAll(): Promise<Settings>
    set<K extends keyof Settings>(key: K, value: Settings[K]): Promise<void>
  }
  logbook: {
    list(filter?: LogFilter): Promise<LogEntry[]>
    tags(): Promise<TagCount[]>
    create(input: LogEntryInput): Promise<LogEntry>
    update(id: number, input: LogEntryInput): Promise<LogEntry>
    remove(id: number): Promise<DeleteBatch> // trashes the entry; returns the batch id for Undo
  }
  trades: {
    list(filter?: TradeFilter): Promise<Trade[]>
    meta(): Promise<TradeMeta>
    create(input: TradeInput): Promise<Trade>
    update(id: number, input: TradeInput): Promise<Trade>
    remove(id: number): Promise<DeleteBatch> // trashes the trade; returns the batch id for Undo
  }
  savings: {
    listGoals(): Promise<SavingsGoal[]>
    createGoal(input: SavingsGoalInput): Promise<SavingsGoal>
    updateGoal(id: number, input: SavingsGoalInput): Promise<SavingsGoal>
    removeGoal(id: number): Promise<DeleteBatch> // trashes the goal AND its transactions under one batch id
    listTransactions(goalId: number): Promise<SavingsTx[]>
    addTransaction(input: SavingsTxInput): Promise<SavingsTx>
    updateTransaction(id: number, input: SavingsTxInput): Promise<SavingsTx>
    removeTransaction(id: number): Promise<DeleteBatch> // trashes the transaction; returns the batch id for Undo
  }
  dashboard: {
    // `today` is the user's local date ("YYYY-MM-DD"), so the streak follows their clock
    summary(today: string): Promise<DashboardData>
  }
  // Phase 5: Tools hub (snippets and scratchpads).
  snippets: {
    list(): Promise<import('./toolsData').SnippetDTO[]>
    create(input: import('./toolsData').SnippetInputDTO): Promise<import('./toolsData').SnippetDTO>
    update(id: number, input: import('./toolsData').SnippetInputDTO): Promise<import('./toolsData').SnippetDTO>
    remove(id: number): Promise<string>
  }
  // Copy text to the OS clipboard inside the app (no network).
  tools: {
    copyText(text: string): Promise<void>
  }
  scratchpads: {
    list(): Promise<import('./toolsData').ScratchpadDTO[]>
    ensure(): Promise<import('./toolsData').ScratchpadDTO>
    create(input: { name?: string; content?: string }): Promise<import('./toolsData').ScratchpadDTO>
    update(id: number, patch: { name?: string; content?: string }): Promise<import('./toolsData').ScratchpadDTO>
    remove(id: number): Promise<string>
    saveAsNote(id: number): Promise<{ id: number; title: string }>
  }
  search: {
    // limit = most results per group (default 8)
    run(query: string, limit?: number): Promise<SearchResults>
  }
  trash: {
    // The Trash page list: one undoable group per delete batch. Restoring a
    // batch restores EVERY row of it; the same for delete-forever.
    list(): Promise<TrashBatch[]>
    restore(batchId: string): Promise<number>
    deleteForever(batchId: string): Promise<number>
  }
  links: {
    add(a: LinkEndpoint, b: LinkEndpoint, relation?: string): Promise<number>
    // Every link one item takes part in, from both sides; links to trashed or
    // missing items are hidden (they reappear when the item is restored).
    list(type: LinkType, id: number): Promise<LinkedItemRef[]>
    remove(linkId: number): Promise<void>
  }
  tags: {
    list(): Promise<TagRow[]>
    counts(): Promise<TagCountEntry[]>
    setEntityTags(type: TagEntityType, entityId: number, names: string[]): Promise<void>
    tagsOf(type: TagEntityType, entityId: number): Promise<TagRow[]>
    setColour(name: string, colour: string | null): Promise<void>
    // Phase 2: the Tags page. Rename applies everywhere (and merges if taken);
    // merge folds `from` into `into`; delete removes the taggings only.
    rename(from: string, to: string): Promise<TagRow>
    merge(from: string, into: string): Promise<TagRow>
    delete(name: string): Promise<number>
    // Live items carrying the tag, of every kind (untyped by tool for now).
    items(name: string): Promise<{ type: TagEntityType; id: number; label: string; sublabel?: string }[]>
  }
  templates: {
    list(kind?: TemplateKind): Promise<Template[]>
    save(kind: TemplateKind, name: string, payload: unknown): Promise<Template>
    remove(id: number): Promise<void>
    // Phase 6: Settings > Templates. Puts the built-in starters back and
    // returns the fresh list (user templates are never touched).
    restoreBuiltins(): Promise<Template[]>
  }
  notes: {
    list(filter?: NoteFilterDTO): Promise<NoteDTO[]>
    get(id: number): Promise<NoteDTO>
    create(input: NoteInputDTO): Promise<NoteDTO>
    update(id: number, input: NoteInputDTO): Promise<NoteDTO>
    remove(id: number): Promise<string>
    setPinned(id: number, pinned: boolean): Promise<NoteDTO>
    setArchived(id: number, archived: boolean): Promise<NoteDTO>
    backlinks(id: number): Promise<NoteDTO[]>
    findByTitle(title: string): Promise<NoteDTO | null>
    // Turns a journal entry into a note (the entry stays put).
    promoteEntry(entryId: number): Promise<NoteDTO>
  }
  content: {
    list(): Promise<ContentItemDTO[]>
    get(id: number): Promise<ContentItemDTO>
    create(input: ContentInputDTO): Promise<ContentItemDTO>
    update(id: number, input: ContentInputDTO): Promise<ContentItemDTO>
    move(id: number, stage: ContentStage): Promise<ContentItemDTO>
    reorder(stage: ContentStage, ids: number[]): Promise<void>
    setChecklistDone(id: number, lineId: string, done: boolean): Promise<ContentItemDTO>
    addChecklistLine(id: number, stage: ContentStage, text: string): Promise<ContentItemDTO>
    removeChecklistLine(id: number, lineId: string): Promise<ContentItemDTO>
    setScript(id: number, noteId: number | null): Promise<ContentItemDTO>
    // Creates the script note AND links it in one go (one click from a card).
    createScript(id: number, title: string): Promise<ContentItemDTO>
    addAsset(id: number, asset: ContentAsset): Promise<ContentItemDTO>
    removeAsset(id: number, path: string): Promise<ContentItemDTO>
    remove(id: number): Promise<string>
    // Local files that are referenced but missing (paths only, never read).
    missingAssets(paths: string[]): Promise<string[]>
  }
  // Phase 1: the Expenses logic layer (src/modules/expenses/service, contract in its API.md).
  // Every money value here is an integer number of cents.
  expenses: {
    overview(month: string, today: string, currency?: string): Promise<ExpenseSummary>
    dueBills(month: string, asOfDate: string): Promise<DueBill[]>
    listCategories(includeArchived?: boolean): Promise<ExpenseCategoryDTO[]>
    listTransactions(filter?: ExpenseTxFilter): Promise<ExpenseTransactionDTO[]>
    createTransaction(input: ExpenseTransactionInputDTO): Promise<ExpenseTransactionDTO>
    updateTransaction(id: number, input: ExpenseTransactionInputDTO): Promise<ExpenseTransactionDTO>
    deleteTransaction(id: number): Promise<string>
    listBudgets(month: string): Promise<ExpenseBudgetDTO[]>
    setBudget(input: { categoryId: number; month: string; amount: number; currency?: string }): Promise<ExpenseBudgetDTO>
    deleteBudget(id: number): Promise<string>
    copyBudgets(targetMonth: string): Promise<ExpenseBudgetDTO[]>
    listRecurringBills(includeArchived?: boolean): Promise<RecurringBillDTO[]>
    createRecurringBill(input: RecurringBillInputDTO): Promise<RecurringBillDTO>
    updateRecurringBill(id: number, input: RecurringBillInputDTO): Promise<RecurringBillDTO>
    deleteRecurringBill(id: number): Promise<string>
    markBillPaid(options: { recurringId: number; dueDate: string; paidDate?: string; amount?: number; currency?: string }): Promise<{ occurrence: RecurringOccurrenceDTO; transaction: ExpenseTransactionDTO }>
    transferLeftover(input: { amountCents: number; currency?: string; goalId: number; date: string; note?: string }): Promise<SavingsTransferResultDTO>
  }
  // Phase 4: Focus timer and time tracking (src/main/focus.ts, src/shared/focus.ts).
  focus: {
    active(): Promise<import('./focus').ActiveFocusSession | null>
    start(params: {
      type: import('./focus').FocusType
      mode: import('./focus').FocusTimerMode
      targetSeconds: number
      taskId?: number | null
      projectId?: number | null
      projectName?: string
      round?: number
      note?: string
    }): Promise<import('./focus').ActiveFocusSession>
    pause(): Promise<import('./focus').ActiveFocusSession | null>
    resume(): Promise<import('./focus').ActiveFocusSession | null>
    stop(completed?: boolean, note?: string): Promise<import('./focus').TimeSession | null>
    discard(): Promise<void>
    summary(today: string): Promise<import('./focus').FocusDashboardSummary>
    report(from: string, to: string): Promise<import('./focus').FocusReport>
    listSessions(filter?: { from?: string; to?: string; projectId?: number; taskId?: number; type?: import('./focus').FocusType }): Promise<import('./focus').TimeSession[]>
    logManual(input: import('./focus').ManualSessionInput): Promise<import('./focus').TimeSession>
    updateSession(id: number, input: Partial<import('./focus').ManualSessionInput>): Promise<import('./focus').TimeSession>
    deleteSession(id: number): Promise<string>
    taskSeconds(taskId: number): Promise<number>
  }
  projects: {
    list(includeArchived?: boolean): Promise<import('./focus').Project[]>
    create(input: import('./focus').ProjectInput): Promise<import('./focus').Project>
    update(id: number, input: Partial<import('./focus').ProjectInput>): Promise<import('./focus').Project>
    delete(id: number): Promise<string>
  }
  app: {
    dataPath(): Promise<string>
    openDataFolder(): Promise<void>
  }
  habits: {
    list(): Promise<HabitsOverview>
    create(input: HabitInput): Promise<Habit>
    update(id: number, input: HabitInput): Promise<Habit>
    remove(id: number): Promise<DeleteBatch> // trashes the habit; history comes back with it
    // Idempotent: checking an already-checked day (or unchecking an unchecked one) changes nothing.
    setCheckin(habitId: number, date: string, done: boolean): Promise<void>
    // Set what a day says: 'done', 'skipped', or null to clear it (the day
    // then falls back to "missed" if it was due, or to "rest" if it was not).
    // The day must not be in the future.
    // `value` is the number logged on that day, for 'count' and 'duration' habits.
    setDayStatus(habitId: number, date: string, status: 'done' | 'skipped' | null, value?: number | null): Promise<void>
    // Logs how much of a count/duration habit was done on a day.
    // A value that reaches the target marks the day done.
    logValue(habitId: number, date: string, value: number): Promise<void>
    // Saves a new manual order after drag-and-drop: every ACTIVE habit id,
    // in the order they should be listed (first id = top of the list).
    reorder(ids: number[]): Promise<void>
  }
  tasks: {
    list(filter?: TaskFilter): Promise<Task[]>
    completed(date: string): Promise<Task[]>
    trash(): Promise<Task[]>
    create(input: TaskInput): Promise<Task>
    update(id: number, input: TaskInput): Promise<Task>
    remove(id: number): Promise<DeleteBatch> // trashes the task (checklist rows come back with it)
    restore(id: number): Promise<void>
    deleteForever(id: number): Promise<void>
    clearTrash(): Promise<void>
    rescheduleMany(ids: number[], dueDate: string, dueTime?: string | null): Promise<void>
    setStatus(id: number, status: TaskStatus): Promise<Task>
    undoStatus(id: number, status: TaskStatus, completedAt: string | null, recurrenceNext: string | null): Promise<void>
    // Bulk actions: every id is changed in one transaction, so a failure changes nothing.
    setStatusMany(ids: number[], status: TaskStatus): Promise<void>
    removeMany(ids: number[]): Promise<DeleteBatch> // ONE delete batch for the whole selection
    reorder(ids: number[]): Promise<void>
    setSubtaskDone(taskId: number, subtaskId: number, done: boolean): Promise<void>
    reorderSubtasks(taskId: number, ids: number[]): Promise<void>
    promoteSubtask(taskId: number, subtaskId: number): Promise<Task>
    skipOccurrence(id: number, today: string): Promise<Task>
  }
  calendar: {
    // The month grid (Monday to Sunday weeks, including the days of the neighbouring months that fill the first and last row)
    // with what happened on each day across the logbook, trades, savings and habits. `month` is "YYYY-MM"; `today` the user's local date.
    month(month: string, today: string): Promise<CalendarData>
  }
  briefing: {
    // Everything the daily briefing page shows, worked out from the other tools' data. `today` is the user's local date.
    build(today: string): Promise<DailyBriefing>
  }
  capture: {
    // Quick capture: the small always-available window (global shortcut and tray icon). See src/main/capture.ts.
    status(): Promise<CaptureStatus>
    // Changes the capture settings. A shortcut is tried BEFORE anything is saved, so one that is taken never replaces one that works.
    configure(patch: Partial<CaptureSettings>): Promise<CaptureConfigResult>
    open(): Promise<void> // show the capture window now
    hide(): Promise<void> // used by the capture window itself (Esc, or after saving)
    openMain(): Promise<void> // bring the main window up (re-creating it if it was closed)
    resize(height: number): Promise<void> // the capture window asks for the height its content needs
    saved(): Promise<void> // the capture window saved something: tells the main window to reload what it shows
    onShown(cb: () => void): () => void // the capture window was just shown; returns the unsubscribe function
    onDataChanged(cb: () => void): () => void // something was saved from the capture window; returns the unsubscribe function
  }
  review: {
    // One summary of a week or month across trades, savings, habits and the logbook.
    // `anchor` is any date inside the period; `today` is the user's local date ("YYYY-MM-DD").
    build(kind: ReviewKind, anchor: string, today: string): Promise<ReviewData>
  }
  backup: {
    // Each opens a Save/Open dialog. `null` means the user cancelled.
    exportJson(today: string): Promise<ExportResult | null>
    exportTradesCsv(today: string): Promise<ExportResult | null>
    // Step 1 of a restore: pick a file and check it. Nothing is changed yet.
    chooseImport(): Promise<ImportPreview | null>
    // Step 2: replace ALL current data with the checked file (a safety copy is made first).
    applyImport(): Promise<ImportResult>
  }
  intelligence: IntelligenceApiInner
  calculator: {
    saveHistory(item: Omit<import('./calculator').CalcHistoryItem, 'id' | 'createdAt'>): Promise<import('./calculator').CalcHistoryItem>
    listHistory(limit?: number): Promise<import('./calculator').CalcHistoryItem[]>
    clearHistory(): Promise<void>
    deleteHistoryItem(id: string): Promise<void>
    togglePinHistory(id: string): Promise<void>
    saveVariable(name: string, value: string): Promise<void>
    listVariables(): Promise<Record<string, string>>
    deleteVariable(name: string): Promise<void>
    saveProgram(program: Omit<import('./calculator').CalcProgram, 'id' | 'createdAt' | 'updatedAt'> & { id?: string }): Promise<import('./calculator').CalcProgram>
    listPrograms(): Promise<import('./calculator').CalcProgram[]>
    deleteProgram(id: string): Promise<void>
    saveRateSet(rateSet: Omit<import('./calculator').CalcRateSet, 'id' | 'updatedAt'> & { id?: string }): Promise<import('./calculator').CalcRateSet>
    renameRateSet(id: string, newName: string): Promise<import('./calculator').CalcRateSet>
    deleteRateSet(id: string): Promise<void>
    selectRateSet(id: string): Promise<void>
    listRateSets(): Promise<import('./calculator').CalcRateSet[]>
    saveRate(rate: Omit<import('./calculator').CalcRate, 'id' | 'updatedAt'> & { id?: string }): Promise<import('./calculator').CalcRate>
    updateRate(id: string, rateToBase: string, note?: string, name?: string): Promise<import('./calculator').CalcRate>
    listRates(rateSetId: string): Promise<import('./calculator').CalcRate[]>
    saveRateOverride(override: Omit<import('./calculator').CalcRateOverride, 'id' | 'updatedAt'> & { id?: string }): Promise<import('./calculator').CalcRateOverride>
    listRateOverrides(rateSetId: string): Promise<import('./calculator').CalcRateOverride[]>
    deleteRateOverride(id: string): Promise<void>
    importRateSet(rateSetId: string, rows: import('./calculator').RateSetImportRow[], mode: 'merge' | 'replace'): Promise<{ count: number }>
    getSetting<K extends keyof import('./calculator').CalcSettings>(key: K): Promise<import('./calculator').CalcSettings[K]>
    setSetting<K extends keyof import('./calculator').CalcSettings>(key: K, value: import('./calculator').CalcSettings[K]): Promise<void>
    getAllSettings(): Promise<import('./calculator').CalcSettings>
  }
}

// ---------- Insights ----------
export interface InsightDismissal { id: string; until: string | null } // null = hidden until restored

export interface InsightsPayload extends InsightsResult {
  dismissed: InsightDismissal[]
  snoozeWeeks: number
}

// ---------- Quick capture ----------
export interface ExportResult { path: string; counts: BackupCounts }

export interface BackupCounts { entries: number; trades: number; goals: number; transactions: number; habits: number; checkins: number; tasks: number; subtasks: number }

// EverythingApi additions for Phase 0 (trash, links, tags, templates):
import type {
  ExpenseSummary, DueBill, ExpenseCategoryDTO, ExpenseTransactionDTO, ExpenseTransactionInputDTO,
  ExpenseTxFilter, ExpenseBudgetDTO, RecurringBillDTO, RecurringBillInputDTO,
  RecurringOccurrenceDTO, SavingsTransferResultDTO
} from '../modules/expenses/service/bridge'
import type { LinkEndpoint, LinkedItemRef, LinkType } from './links'
import type {
  NoteDTO, NoteFilterDTO, NoteInputDTO, ContentAsset, ContentInputDTO, ContentItemDTO, ContentStage
} from './notesBridge'
import type { TrashBatch } from './trash'
import { DEFAULT_FOCUS_SETTINGS, type FocusSettings } from './focus'
import type { TagEntityType, TagCountEntry, TagRow } from './tags'
import type { Template, TemplateKind } from './templates'
export type { TrashBatch, TrashType } from './trash'
export type { LinkEndpoint, LinkedItemRef, LinkType } from './links'
export type { TagEntityType, TagCountEntry, TagRow } from './tags'
export type { Template, TemplateKind } from './templates'

export interface ImportPreview {
  fileName: string
  exportedAt: string
  counts: BackupCounts // what the file contains
  current: BackupCounts // what the app holds right now (would be replaced)
}
export interface ImportResult { counts: BackupCounts; safetyCopy: string }

// ---------- Logbook ----------
export type Mood = 'great' | 'good' | 'okay' | 'low' | 'rough'
export const MOODS: Mood[] = ['great', 'good', 'okay', 'low', 'rough']

export interface LogEntry {
  id: number
  date: string // "YYYY-MM-DD" (the day the entry is about)
  title: string
  body: string
  mood: Mood | null
  tags: string[] // lowercase, no "#"
  createdAt: string
  updatedAt: string
}
export type LogEntryInput = Omit<LogEntry, 'id' | 'createdAt' | 'updatedAt'>

// Every field is optional; only the ones you set are applied.
export interface LogFilter {
  text?: string // matches title or body
  tag?: string
  from?: string // "YYYY-MM-DD", inclusive
  to?: string
}
export interface TagCount { tag: string; count: number }

// ---------- Trades ----------
export type Direction = 'long' | 'short'

export interface Trade {
  id: number
  date: string // "YYYY-MM-DD"
  asset: string // uppercase, e.g. "XAUUSD"
  direction: Direction
  entryPrice: number
  exitPrice: number | null // null = trade is still open
  quantity: number // size
  fees: number // total fees for the trade, in the quote currency
  notes: string
  tags: string[]
  pnl: number | null // CALCULATED (never stored); null while open
  closedAt?: string | null // ISO timestamp of the close (migration 16); null while open, missing on old data
  createdAt: string
  updatedAt: string
}
export type TradeInput = Omit<Trade, 'id' | 'pnl' | 'closedAt' | 'createdAt' | 'updatedAt'>

export interface TradeFilter {
  text?: string // matches asset or notes
  tag?: string
  direction?: Direction
  from?: string
  to?: string
}
export interface TradeMeta { assets: string[]; tags: TagCount[] }

export interface TradeStats {
  total: number
  open: number
  closed: number
  wins: number
  losses: number
  winRate: number | null // 0-100, null when nothing is closed
  totalPnl: number
  totalFees: number
  avgWin: number | null
  avgLoss: number | null // negative number
  profitFactor: number | null // gross wins / gross losses
  best: number | null
  worst: number | null
}

// ---------- Savings ----------
export type TxKind = 'deposit' | 'withdrawal'

// A goal (or plain account). target = null means "no target, just track the balance".
export interface SavingsGoal {
  id: number
  name: string
  target: number | null
  notes: string
  balance: number // CALCULATED from transactions (never stored)
  txCount: number
  createdAt: string
  updatedAt: string
}
export type SavingsGoalInput = Pick<SavingsGoal, 'name' | 'target' | 'notes'>

export interface SavingsTx {
  id: number
  goalId: number
  date: string // "YYYY-MM-DD"
  kind: TxKind
  amount: number // always positive; `kind` says which direction
  note: string
  createdAt: string
  updatedAt: string
}
export type SavingsTxInput = Omit<SavingsTx, 'id' | 'createdAt' | 'updatedAt'>

// ---------- Search ----------
// `total` can be bigger than items.length: items is capped, total is not.
export interface SearchGroup<T> { items: T[]; total: number }
export type SavingsTxHit = SavingsTx & { goalName: string }

export interface SearchResults {
  logbook: SearchGroup<LogEntry>
  trades: SearchGroup<Trade>
  goals: SearchGroup<SavingsGoal>
  transactions: SearchGroup<SavingsTxHit>
  tasks: SearchGroup<Task>
  // Phase 2/3: notes and content items joined the shared index.
  notes: SearchGroup<SearchNoteHit>
  content: SearchGroup<SearchContentHit>
  // Phase 5: saved snippets (a Tools hub contribution to the shared index).
  snippets: SearchGroup<SearchSnippetHit>
  // Phase 1 / 6: expense transactions.
  expenses: SearchGroup<SearchExpenseHit>
  // Phase 4 / 6: focus sessions.
  focus: SearchGroup<SearchFocusHit>
  // Phase 5 / 6: scratchpads.
  scratchpads: SearchGroup<SearchScratchpadHit>
}

export interface SearchScratchpadHit {
  id: number
  name: string
  content: string
}

export interface SearchFocusHit {
  id: number
  projectName: string
  note: string
  startedAt: string
  actualSeconds: number
  type: string
}

export interface SearchExpenseHit {
  id: number
  payee: string
  amount: number
  currency: string
  date: string
  type: string
  note: string
}

// A note as a search result: the row plus a short plain-text preview.
export interface SearchNoteHit {
  id: number
  title: string
  updatedAt: string
  tags: string[]
  preview: string
}

// A content item as a search result.
export interface SearchContentHit {
  id: number
  title: string
  stage: string
  platform: string
  targetPublishDate: string | null
}

// A saved snippet as a search result.
export interface SearchSnippetHit {
  id: number
  title: string
  tags: string[]
  preview: string
}

// ---------- Dashboard ----------
export interface LogSummary {
  total: number // all entries ever
  thisMonth: number
  streak: number // days in a row with an entry (see logStreak)
}

// One closed trade on the P&L curve. `cumulative` is the running total up to and including it.
export interface PnlPoint { tradeId: number; date: string; asset: string; pnl: number; cumulative: number }

// One habit scheduled today, as the dashboard tile shows it.
export interface HabitToday { id: number; name: string; done: boolean; streak: number }

// A habit worth naming in the dashboard's "top streaks" list.
export interface HabitStreak { id: number; name: string; current: number }

// The "Habits today" tile: scheduled-today counts, the longest running streak among active habits, and today's list.
export interface HabitsToday {
  total: number // active habits (any schedule)
  due: number // scheduled today
  done: number // scheduled today AND checked off
  longestStreak: number // best current streak among active habits
  // The three best current streaks (biggest first), shown in the dashboard widget.
  topStreaks: HabitStreak[]
  items: HabitToday[] // scheduled today, unfinished first
}

export interface DashboardData {
  recentEntries: LogEntry[] // newest first
  recentTrades: Trade[] // newest first
  goals: SavingsGoal[]
  tradeStats: TradeStats // over ALL trades
  pnlSeries: PnlPoint[] // closed trades, oldest first, with the running total
  totalSaved: number // sum of every goal's balance
  log: LogSummary
  habits: HabitsToday
  tasks: TaskDashboard
  focus?: import('./focus').FocusDashboardSummary
}

// ---------- Habits ----------
export interface HabitStats {
  current: number // scheduled days in a row, up to today
  best: number // longest run ever
  rate30: number | null // % of scheduled days done in the last 30 days; null until one is due
  total: number // every check-in ever
}

// One recorded day of a habit.
//   status 'done'    = the habit was completed
//   status 'skipped' = deliberately skipped (sick day, travel, ...)
// "missed" and "rest" are NEVER stored: they are derived from the schedule.
export interface HabitCompletion {
  date: string // "YYYY-MM-DD"
  status: 'done' | 'skipped'
  // How much was logged on this day (for 'count' and 'duration' habits).
  value?: number
}

// The kinds of habit there are.
export type HabitType = 'check' | 'count' | 'duration'

// When in the day the habit belongs to. 'anytime' is the same as "no time of
// day", so a habit created before this field existed keeps meaning "anytime".
export type TimeOfDay = 'morning' | 'afternoon' | 'evening' | 'anytime'

export interface Habit {
  id: number
  name: string
  notes: string
  days: number[] // the days it is scheduled: 0 = Monday ... 6 = Sunday
  archived: boolean // hidden from the daily list, history kept
  startDate: string // "YYYY-MM-DD", the day tracking began
  checkins: string[] // every day checked off, "YYYY-MM-DD" (the "done" days)
  // Every recorded day, done or skipped. Optional so older data (and the test
  // fixtures) keep working: the code falls back to the checkins when it is missing.
  completions?: HabitCompletion[]
  // What kind of habit this is. Optional so older data keeps working:
  // a habit without a type is a plain 'check' habit.
  type?: HabitType
  // How much is enough, for 'count' and 'duration' habits (3 sessions, 10 min).
  target?: number | null
  // The label for that number ("sessions", "min", ...).
  unit?: string
  // When in the day the habit belongs to, used by the "group by time of day"
  // toggle on the Habits page. Optional so older data keeps working: a habit
  // without one is an 'anytime' habit.
  timeOfDay?: TimeOfDay
  // The position in the list, from drag-and-drop (0 = first; lower comes
  // first). Optional so older data keeps working.
  sortOrder?: number
  // When to remind about this habit, "HH:MM" (24-hour), or null for never.
  // Optional so older data keeps working.
  reminderTime?: string | null
  // What else may complete this habit automatically. Empty ('') means
  // nothing: only you can check it off. Optional so older data keeps working.
  autoCompleteOn?: AutoCompleteOn
  stats: HabitStats // CALCULATED from the check-ins (never stored)
  createdAt: string
  updatedAt: string
}
export type HabitInput = Pick<Habit, 'name' | 'notes' | 'days' | 'archived'>
  & Partial<Pick<Habit, 'type' | 'target' | 'unit' | 'timeOfDay' | 'reminderTime' | 'autoCompleteOn'>>

// The things (besides ticking the circle yourself) that can finish a habit.
// An empty string means "nothing else": the habit only counts when you tick it.
export type AutoCompleteOn = '' | 'logbook-entry'

// `today` comes from the main process, so the stats and the screen always agree on the date.
export interface HabitsOverview { today: string; habits: Habit[] }

// ---------- Tasks ----------
export type TaskStatus = 'todo' | 'in-progress' | 'done'
export type TaskPriority = 'low' | 'medium' | 'high'
export type TaskView = 'today' | 'upcoming' | 'overdue' | 'all' | 'completed' | 'trash'
export interface TaskRecurrence { frequency: 'daily' | 'weekly' | 'monthly' | 'custom'; intervalDays: number }
export interface TaskSubtask { id: number; taskId: number; title: string; done: boolean; sortOrder: number }
export interface Task {
  id: number; title: string; notes: string; status: TaskStatus; priority: TaskPriority; dueDate: string | null
  dueTime: string | null // "HH:MM" or null
  createdAt: string; completedAt: string | null; deletedAt: string | null // soft delete timestamp
  project: string | null; tags: string[]; position: number // manual sort position (replaces sort_order)
  recurrenceRule: TaskRecurrence | null // the repeat rule, one row owns it
  recurrenceNext: string | null // next due date resolved from the rule, or null
  subtasks: TaskSubtask[]
}
export interface TaskCompletion { taskId: number; completedAt: string }
export type TaskInput = Pick<Task, 'title' | 'notes' | 'status' | 'priority' | 'dueDate' | 'dueTime' | 'project' | 'tags' | 'recurrenceRule' | 'recurrenceNext'> & {
  subtasks: Pick<TaskSubtask, 'title' | 'done'>[]
}
export interface TaskFilter { view?: TaskView; text?: string; priority?: TaskPriority; project?: string; tag?: string }
export interface TaskSavedView { id: string; name: string; filter: TaskFilter }
export interface TaskDashboard { dueToday: number; overdue: number; completedThisWeek: number }
export interface TaskReview { created: number; completed: number }

// ---------- Review (weekly / monthly) ----------
// Everything here is CALCULATED from the other tools' data each time (nothing new is stored). A written
// reflection is an ordinary logbook entry tagged "review".
// 1 (rough) to 5 (great). The Logbook only stores the word, so this is the one place that turns it into a number.
export const MOOD_SCORE: Record<Mood, number> = { great: 5, good: 4, okay: 3, low: 2, rough: 1 }

export type ReviewKind = 'week' | 'month'

export interface ReviewTrades {
  stats: TradeStats // over the trades dated inside the period (a trade counts on its entry date, like the P&L curve)
  days: { date: string; pnl: number; closed: number }[] // one per day of the period; pnl = closed trades of that day
  best: Trade | null // the best closed trade, only when it made money
  worst: Trade | null // the worst closed trade, only when it lost money
  previous: { closed: number; totalPnl: number } // the period before, for comparison
}

export interface ReviewGoal {
  goalId: number
  name: string
  deposits: number
  withdrawals: number
  net: number
  startBalance: number // balance before the period
  endBalance: number // balance at the end of the period
  target: number | null
  reached: boolean // crossed its target during this period
}

export interface ReviewSavings {
  deposits: number
  withdrawals: number
  net: number // deposits - withdrawals
  txCount: number
  startBalance: number // all goals together, before the period
  endBalance: number // all goals together, at the end of the period
  goals: ReviewGoal[] // only goals that moved, biggest change first
  previousNet: number
  recent: ReviewTx[] // the newest transactions of the period, as entered (at most 5), newest first
}

// One transaction of the period, for the "recent activity" list. Nothing is recalculated: these are the stored rows.
export interface ReviewTx { id: number; goalId: number; goalName: string; date: string; kind: TxKind; amount: number; note: string }

export interface ReviewHabit {
  id: number
  name: string
  due: number // scheduled days that have passed (today counts only once it is done)
  done: number // of those, checked off
  rate: number | null // % done, null when nothing was due
  bonus: number // check-ins on rest days
  streak: number // current streak (as on the Habits page)
  missed: string[] // scheduled days that passed unchecked
  days: number[] // its schedule, 0 = Monday ... 6 = Sunday (so a rest day is never drawn as a win)
  startDate: string // the day tracking began; days before it are "not tracked", not misses
}

// One day of the period, with what the day's scheduled habits came to across every active habit.
export interface ReviewHabitDay { date: string; due: number; done: number }

export interface ReviewHabits {
  due: number
  done: number
  rate: number | null
  bonus: number
  previousRate: number | null
  // The first day any active habit existed (its start date, or an earlier check-in). Before it, a day was
  // not tracked at all; after it, a day with nothing due is a scheduled rest day. null = no active habits.
  trackedFrom: string | null
  habits: ReviewHabit[] // active habits with something scheduled or checked in this period, weakest first
  days: ReviewHabitDay[] // one per day of the period
}

export interface ReviewMood {
  logged: number // entries with a mood
  average: number | null // 1 (rough) to 5 (great)
  previousAverage: number | null
  counts: Record<Mood, number>
  days: { date: string; average: number | null }[] // one per day of the period
  lowest: { date: string; mood: Mood } | null // the worst day, only when it was low or rough
  trend: 'up' | 'down' | 'steady' | null // second half of the period against the first; null = too little data
}

export interface ReviewJournal {
  entries: LogEntry[] // entries dated inside the period, newest first, without review reflections
  daysWritten: number
  reflection: LogEntry | null // the saved reflection for this exact period, if any
}

export interface ReviewData {
  kind: ReviewKind
  start: string
  end: string
  today: string
  complete: boolean // the period is over (comparisons with the previous one are fair)
  prevStart: string
  prevEnd: string
  label: string // "19 Oct to 25 Oct 2026" or "October 2026"
  title: string // the title a saved reflection gets, e.g. "Weekly review 2026-10-19 to 2026-10-25"
  trades: ReviewTrades
  savings: ReviewSavings
  habits: ReviewHabits
  tasks: TaskReview
  mood: ReviewMood
  journal: ReviewJournal
  spending?: ReviewExpenses
  notesCreated?: number
  focusSeconds?: number
  contentPublished?: number
  insights: { id: string; text: string }[] // links between tools, only when there is enough data to say something
  prompts: { id: string; text: string }[] // suggested questions for the reflection
}

export interface ReviewExpenses {
  totalSpent: number // minor units (cents)
  previousSpent: number
  txCount: number
  topCategories: { id: number; name: string; amount: number }[]
}

// ---------- Quick capture ----------
export type CaptureKind = 'note' | 'trade' | 'deposit' | 'habit' | 'task' | 'expense' | 'focus' | 'content' | 'scratchpad'

// The delete batching (Phase 0): every delete IPC returns the batch id of the
// rows it just trashed, so the UI can Undo it and the Trash page can restore
// or delete-forever the WHOLE group in one call. Always a string; empty when
// there is nothing to undo (the row was already in Trash).
export type DeleteBatch = string

// Stored as three separate settings rows (captureEnabled, captureHotkey, captureKeepRunning), read by src/shared/capture.ts.
export interface CaptureSettings {
  enabled: boolean // the global shortcut and the tray icon exist
  hotkey: string // an Electron accelerator such as "CommandOrControl+Shift+Space"
  keepRunning: boolean // closing the main window leaves the app running in the tray (Windows / Linux; a Mac always does)
}

export interface CaptureStatus extends CaptureSettings {
  registered: boolean // the system accepted the shortcut right now
  platform: string // "win32", "darwin" or "linux"
  problem: string | null // why it is not working, in words (null = fine, or switched off)
}

export interface CaptureConfigResult { ok: boolean; error: string | null; status: CaptureStatus }

// ---------- Intelligence data layer ----------
export interface IntelligenceFeatureToggles {
  dailyBriefing: boolean // on by default
  automations: boolean
  smartQuickAdd: boolean
  insights: boolean
  aiAssistant: boolean
}

// ---------- Intelligence settings ----------
import type { AutomationSettings, AutomationActivity } from './automations'

export interface IntelligenceSettings {
  features: IntelligenceFeatureToggles
}

export type { AutomationSettings, AutomationActivity }

export type { DailyBriefing, BriefingTasks, BriefingHabits, BriefingSavings, BriefingTrades, BriefingJournal,
  BriefingTaskItem, BriefingHabitItem, BriefingGoal, BriefingWeekly } from './briefing'
export type { ChangeItem } from './changes'

// EverythingApi's briefing section (line 117) needs these types, so import them here too.
import { round8 } from './math'
import type { InsightsResult } from './insights'
import type { DailyBriefing } from './briefing'
import type { AssistantSettings, AssistantExchange, AssistantFunctionInfo, AssistantKeyStatus, AskOutcome } from './assistant'
export type { InsightsResult } from './insights'

// ---------- Insights ----------
export interface InsightDismissal { id: string; until: string | null } // null = hidden until restored

export interface InsightsPayload extends InsightsResult {
  dismissed: InsightDismissal[]
  snoozeWeeks: number
}

// ---------- Calendar ----------
// Calculated from the other tools' data each time (nothing new is stored).
export interface CalendarHabitItem {
  id: number
  name: string
  status: 'done' | 'missed' | 'pending' | 'bonus' // pending = scheduled today and not done yet; bonus = checked on a rest day
}

export interface CalendarDay {
  date: string
  inMonth: boolean // false for the greyed days of the neighbouring months
  isToday: boolean
  isFuture: boolean
  entries: LogEntry[] // newest first
  // Phase 3: content items published that day, and planned for that day.
  published: { id: number; title: string; platform: string }[]
  planned: { id: number; title: string; platform: string }[]
  // Phase 1 / 6: bills due that day.
  bills: { id: number; name: string; amount: number; currency: string }[]
  // Phase 4 / 6: focus sessions on that day.
  focusSessions?: { id: number; projectName: string; seconds: number; type: string }[]
  mood: Mood | null // the day's average mood, as the nearest mood word
  moodAverage: number | null // 1 (rough) to 5 (great)
  trades: Trade[] // entered this day (a trade counts on its entry date, like the P&L curve)
  closed: number
  open: number
  pnl: number // of the closed ones
  txs: SavingsTxHit[]
  savingsNet: number // deposits minus withdrawals
  habits: { done: number; missed: number; pending: number; bonus: number; items: CalendarHabitItem[] }
}

export interface CalendarSummary { // the days of the month itself (not the greyed ones)
  entries: number
  daysWritten: number
  closed: number
  open: number
  pnl: number
  savingsNet: number
  habitRate: number | null // % of scheduled habit days done; today is not counted until it is done
  moodAverage: number | null
}

export interface CalendarData {
  month: string // "YYYY-MM"
  label: string // "October 2026"
  prevMonth: string
  nextMonth: string
  first: string // first and last day of the month
  last: string
  weeks: CalendarDay[][] // 4 to 6 rows of 7
  summary: CalendarSummary
}
