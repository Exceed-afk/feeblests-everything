// Types shared by main, preload and renderer. Add new data shapes here.

export type ThemeMode = 'dark' | 'light' | 'system'

export interface Settings {
  theme: ThemeMode
  accent: string // hex color, e.g. "#8b5cf6"
  tagColors: Record<string, string> // tag name -> hex color; tags not listed use the accent color
}

export const DEFAULT_SETTINGS: Settings = { theme: 'dark', accent: '#8b5cf6', tagColors: {} }

// The API the renderer can call. The preload script implements it and
// the main process answers it (see src/main/index.ts).
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
    remove(id: number): Promise<void>
  }
  trades: {
    list(filter?: TradeFilter): Promise<Trade[]>
    meta(): Promise<TradeMeta>
    create(input: TradeInput): Promise<Trade>
    update(id: number, input: TradeInput): Promise<Trade>
    remove(id: number): Promise<void>
  }
  savings: {
    listGoals(): Promise<SavingsGoal[]>
    createGoal(input: SavingsGoalInput): Promise<SavingsGoal>
    updateGoal(id: number, input: SavingsGoalInput): Promise<SavingsGoal>
    removeGoal(id: number): Promise<void>
    listTransactions(goalId: number): Promise<SavingsTx[]>
    addTransaction(input: SavingsTxInput): Promise<SavingsTx>
    updateTransaction(id: number, input: SavingsTxInput): Promise<SavingsTx>
    removeTransaction(id: number): Promise<void>
  }
  dashboard: {
    // `today` is the user's local date ("YYYY-MM-DD"), so the streak follows their clock
    summary(today: string): Promise<DashboardData>
  }
  search: {
    // limit = most results per group (default 8)
    run(query: string, limit?: number): Promise<SearchResults>
  }
  app: {
    dataPath(): Promise<string>
    openDataFolder(): Promise<void>
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
}

// ---------- Backup (export / import) ----------
export interface ExportResult { path: string; counts: BackupCounts }

export interface BackupCounts { entries: number; trades: number; goals: number; transactions: number }

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
  createdAt: string
  updatedAt: string
}
export type TradeInput = Omit<Trade, 'id' | 'pnl' | 'createdAt' | 'updatedAt'>

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
}

// ---------- Dashboard ----------
export interface LogSummary {
  total: number // all entries ever
  thisMonth: number
  streak: number // days in a row with an entry (see logStreak)
}

// One closed trade on the P&L curve. `cumulative` is the running total up to and including it.
export interface PnlPoint { tradeId: number; date: string; asset: string; pnl: number; cumulative: number }

export interface DashboardData {
  recentEntries: LogEntry[] // newest first
  recentTrades: Trade[] // newest first
  goals: SavingsGoal[]
  tradeStats: TradeStats // over ALL trades
  pnlSeries: PnlPoint[] // closed trades, oldest first, with the running total
  totalSaved: number // sum of every goal's balance
  log: LogSummary
}
