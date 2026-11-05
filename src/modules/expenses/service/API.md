# Expenses and Budget Service API Contract

This document is the contract between the Phase 1 Expenses logic layer (`src/modules/expenses/service/`) and the upcoming Phase 1 UI.

---

## 1. Core Principles & Rules

1. **Money representation**:
   - All monetary values are represented as **integer minor units (cents)**.
   - Example: `$12.50` is stored and passed as `1250`.
   - Floating point amounts are strictly prohibited and will throw an error.
   - Every transaction, budget, and bill has an ISO currency code (default: `'USD'`).
2. **Soft delete & Visibility**:
   - All tables include `deleted_at TEXT` and `delete_batch_id TEXT`.
   - All queries filter `deleted_at IS NULL` by default.
   - Trashed transactions, budgets, categories, and bills never affect totals.
3. **Idempotent Recurring Generation**:
   - Recurring generation runs on launch and catches up on any missed periods.
   - Occurrences are uniquely keyed on `(recurring_id, due_date)` in `recurring_bill_occurrences`.
   - Running generation repeatedly is safe and produces zero duplicates.
4. **Savings Integration**:
   - Month-end transfer of leftover budget creates both the expense transfer and savings deposit in **one atomic database transaction**.
   - Neither row is created if any validation or constraint fails.

---

## 2. Exported Functions

### 2.1 Left-to-Spend & Daily Safe-to-Spend Math

#### `calculateLeftToSpend(budgetCents: number, spentCents: number, billsDueCents: number): number`
- **Purpose**: Pure mathematical implementation of the roadmap formula:
  `left to spend = total monthly budget − spent so far − bills still due this month`.
- **Inputs**:
  - `budgetCents`: integer cents (e.g. `100000` for `$1000.00`).
  - `spentCents`: integer cents (e.g. `35000` for `$350.00`).
  - `billsDueCents`: integer cents (e.g. `15000` for `$150.00`).
- **Outputs**: `number` (integer cents). Can be negative when over budget.
- **Errors**:
  - Throws `Error` if any argument is not an integer.

#### `daysRemainingInMonth(today: string, month: string): number`
- **Purpose**: Calculates days remaining in the month, inclusive of `today`.
- **Inputs**:
  - `today`: local date `YYYY-MM-DD` (e.g. `'2026-11-02'`).
  - `month`: local month `YYYY-MM` (e.g. `'2026-11'`).
- **Outputs**: `number` (days remaining).
  - Example: on Nov 2 of a 30-day month, returns `29` (Nov 2 through Nov 30).
  - On the last day of the month, returns `1`.
  - If `today` is after the target month, returns `0`.
- **Errors**: None.

#### `calculateSafeToSpendPerDay(leftToSpendCents: number, daysRemaining: number): number`
- **Purpose**: Computes safe daily spending: `floor(leftToSpend / daysRemaining)`.
- **Inputs**:
  - `leftToSpendCents`: integer cents.
  - `daysRemaining`: non-negative integer.
- **Outputs**: `number` (integer cents).
  - Returns `0` if `leftToSpendCents <= 0` or `daysRemaining <= 0`.
- **Errors**:
  - Throws `Error` if `leftToSpendCents` is not an integer.

#### `computeLeftToSpend(db: Database, options: ComputeLeftToSpendOptions): LeftToSpendResult`
- **Purpose**: Aggregates budgets, expenses, and upcoming bills for a month and computes the left-to-spend summary and category breakdown.
- **Inputs**:
  - `db`: better-sqlite3 database handle.
  - `options`:
    - `month`: `YYYY-MM`.
    - `today`: `YYYY-MM-DD`.
    - `currency`: optional string (defaults to `'USD'`).
- **Outputs**: `LeftToSpendResult`:
  ```ts
  {
    month: string // YYYY-MM
    asOfDate: string // YYYY-MM-DD
    currency: string
    totalBudget: number // integer cents
    spentSoFar: number // integer cents (live expense transactions only)
    billsStillDue: number // integer cents (unpaid bills due from today onwards)
    leftToSpend: number // integer cents (totalBudget - spentSoFar - billsStillDue)
    daysRemaining: number
    safeToSpendPerDay: number // integer cents
    categories: Array<{
      categoryId: number
      categoryName: string
      budgetAmount: number
      spentAmount: number
      billsDueAmount: number
      leftToSpend: number
    }>
  }
  ```
- **Business rules**:
  - `spentSoFar` includes only `type = 'expense'` transactions dated in the target month.
  - Simple `income` and `transfer` transactions are strictly excluded from spending.
  - Trashed transactions and budgets are excluded.
  - `billsStillDue` includes recurring bills whose due date falls between `today` and end-of-month, and which do not have a `'paid'` occurrence for that due date.
- **Errors**: None on valid inputs.

---

### 2.2 Recurring Bills & Subscriptions

#### `advanceRecurringDueDate(currentDueDate: string, cadence: RecurringCadence, intervalDays?: number | null, anchorDate?: string): string`
- **Purpose**: Pure calendar arithmetic to compute the subsequent due date.
- **Inputs**:
  - `currentDueDate`: `YYYY-MM-DD`.
  - `cadence`: `'weekly' | 'monthly' | 'yearly' | 'custom'`.
  - `intervalDays`: integer (required when cadence is `'custom'`).
  - `anchorDate`: optional `YYYY-MM-DD` original bill start date to preserve month-end anchors.
- **Outputs**: `YYYY-MM-DD` next due date string.
- **Behavior**:
  - Weekly: advances 7 days.
  - Custom: advances `intervalDays` days.
  - Monthly: advances 1 calendar month, clamping to the last valid day of the month (e.g. Jan 31 -> Feb 28 in non-leap year, Feb 29 in leap year), while preserving the anchor day for subsequent months (Feb 28 -> Mar 31).
  - Yearly: advances 1 year, clamping Feb 29 to Feb 28 on non-leap years.
- **Errors**:
  - Throws `Error` on unsupported cadence.

#### `createRecurringBill(db: Database, input: RecurringBillInput): RecurringBill`
- **Purpose**: Creates a recurring bill or subscription.
- **Inputs**:
  - `db`: Database.
  - `input`:
    - `name`: string (non-empty).
    - `amount`: integer cents (`> 0`).
    - `currency`: optional string (default `'USD'`).
    - `cadence`: `'weekly' | 'monthly' | 'yearly' | 'custom'`.
    - `intervalDays`: optional integer (required if `cadence === 'custom'`).
    - `nextDueDate`: `YYYY-MM-DD`.
    - `categoryId`: optional number | null.
    - `reminderLeadDays`: optional integer (`>= 0`).
    - `autopay`: optional boolean.
    - `trialEndDate`: optional `YYYY-MM-DD` | null.
    - `payee`: optional string.
    - `note`: optional string.
- **Outputs**: Created `RecurringBill`.
- **Errors**:
  - Throws `Error` if `name` is empty.
  - Throws `Error` if `amount <= 0` or not an integer.
  - Throws `Error` if `nextDueDate` format is invalid.
  - Throws `Error` if `cadence === 'custom'` and `intervalDays <= 0`.

#### `updateRecurringBill(db: Database, id: number, input: RecurringBillInput): RecurringBill`
- **Purpose**: Updates an active recurring bill.
- **Inputs**: `id` and `input`.
- **Outputs**: Updated `RecurringBill`.
- **Errors**: Throws if bill not found or trashed, or validation fails.

#### `deleteRecurringBill(db: Database, id: number): string`
- **Purpose**: Soft-deletes a recurring bill.
- **Inputs**: `id`.
- **Outputs**: `string` (`delete_batch_id` for undo/Trash tracking).
- **Errors**: Throws if bill not found or already trashed.

#### `getRecurringBill(db: Database, id: number): RecurringBill`
- **Purpose**: Fetches a live recurring bill by ID.
- **Errors**: Throws if bill does not exist or is trashed.

#### `listRecurringBills(db: Database, includeArchived?: boolean): RecurringBill[]`
- **Purpose**: Lists live recurring bills, ordered by `next_due_date ASC, name ASC`.
- **Inputs**: `includeArchived` boolean (default `false`).

#### `generateRecurringBills(db: Database, today: string): GenerateRecurringResult`
- **Purpose**: Runs on app startup to catch up on all active recurring bills due up to `today`.
- **Inputs**:
  - `today`: current local date `YYYY-MM-DD`.
- **Outputs**:
  ```ts
  {
    generatedCount: number
    paidCount: number
    occurrences: RecurringOccurrence[]
  }
  ```
- **Behavior**:
  - Idempotent: checks for existing `(recurring_id, due_date)` in `recurring_bill_occurrences`.
  - For `autopay === true`: creates an `expense_transactions` row, marks occurrence as `'paid'`.
  - For `autopay === false`: creates occurrence with `status = 'pending'` (no transaction yet).
  - Advances bill's `next_due_date` past `today`.
- **Errors**: None.

#### `markRecurringBillPaid(db: Database, options: MarkBillPaidOptions): { occurrence: RecurringOccurrence; transaction: ExpenseTransaction }`
- **Purpose**: Manually records payment for a recurring bill occurrence, creating the matching expense transaction.
- **Inputs**:
  - `options`:
    - `recurringId`: number.
    - `dueDate`: `YYYY-MM-DD`.
    - `paidDate`: optional `YYYY-MM-DD` (defaults to `dueDate`).
    - `amount`: optional integer cents (defaults to bill amount).
    - `currency`: optional string (defaults to bill currency).
- **Outputs**: `{ occurrence, transaction }`.
- **Behavior**:
  - If occurrence was already paid, returns existing transaction.
  - If pending, creates transaction and updates occurrence to `'paid'`.
  - Advances bill's `next_due_date` if `bill.nextDueDate <= dueDate`.
- **Errors**: Throws if bill not found or trashed.

#### `listDueBillsThisMonth(db: Database, month: string, asOfDate: string): Array<{ bill: RecurringBill; dueDate: string; amount: number }>`
- **Purpose**: Lists upcoming unpaid bills for the remainder of the month.
- **Inputs**:
  - `month`: `YYYY-MM`.
  - `asOfDate`: `YYYY-MM-DD`.
- **Outputs**: Array of due bill records with amount in integer cents.

---

### 2.3 Savings Deposit + Transfer Integration

#### `transferLeftoverToSavings(db: Database, input: SavingsTransferInput): SavingsTransferResult`
- **Purpose**: Atomically transfers leftover budget from Expenses to a Savings goal in a single database transaction.
- **Inputs**:
  - `input`:
    - `amountCents`: integer cents (`> 0`).
    - `currency`: optional string (default `'USD'`).
    - `goalId`: number (must exist in `savings_goals` and not be trashed).
    - `date`: `YYYY-MM-DD`.
    - `note`: optional string.
- **Outputs**: `SavingsTransferResult`:
  ```ts
  {
    expenseTransaction: ExpenseTransaction
    savingsTransactionId: number
    goalId: number
    goalName: string
    amountCents: number
    currency: string
    date: string
    newGoalBalance: number
  }
  ```
- **Transactional guarantees**:
  - Inserts row into `expense_transactions` with `type = 'transfer'` and `transfer_target = 'savings:<goalId>'`.
  - Inserts row into `savings_transactions` with `kind = 'deposit'` and `amount = amountCents / 100` (major units).
  - If either insertion fails or `goalId` is not found, the transaction is rolled back and no rows are modified.
- **Errors**:
  - Throws `Error` if `amountCents <= 0` or not an integer.
  - Throws `Error` if `goalId` is not found or is trashed (`Goal not found (id: <goalId>)`).
  - Throws `Error` if `date` is malformed.

---

### 2.4 Categories Management

#### `createCategory(db: Database, input: ExpenseCategoryInput): ExpenseCategory`
- **Inputs**: `{ name: string, colour: string, icon: string }`.
- **Errors**: Throws if name is empty or already exists.

#### `updateCategory(db: Database, id: number, input: Partial<ExpenseCategoryInput>): ExpenseCategory`
- **Errors**: Throws if category not found or trashed.

#### `archiveCategory(db: Database, id: number, archived?: boolean): ExpenseCategory`
- **Purpose**: Toggles category archived flag (active categories should be archived rather than deleted once used).

#### `deleteCategory(db: Database, id: number): string`
- **Purpose**: Soft-deletes category; returns `delete_batch_id`.

#### `getCategory(db: Database, id: number): ExpenseCategory`
- **Errors**: Throws if category not found or trashed.

#### `listCategories(db: Database, includeArchived?: boolean): ExpenseCategory[]`
- **Purpose**: Lists live categories (excludes trashed categories). Defaults to unarchived categories only.

---

### 2.5 Transactions Management

#### `createExpenseTransaction(db: Database, input: ExpenseTransactionInput): ExpenseTransaction`
- **Inputs**:
  - `amount`: integer cents (`> 0`).
  - `currency`: optional string (default `'USD'`).
  - `date`: `YYYY-MM-DD`.
  - `categoryId`: optional number | null.
  - `payee`: optional string.
  - `note`: optional string.
  - `type`: `'expense' | 'income' | 'transfer'`.
  - `tags`: optional string[].
  - `transferTarget`: optional string | null.
  - `recurringId`: optional number | null.
- **Errors**:
  - Throws if `amount <= 0` or not an integer.
  - Throws if `date` format is invalid.
  - Throws if `type` is not one of `'expense'`, `'income'`, `'transfer'`.

#### `updateExpenseTransaction(db: Database, id: number, input: ExpenseTransactionInput): ExpenseTransaction`
- **Errors**: Throws if transaction not found or trashed, or validation fails.

#### `deleteExpenseTransaction(db: Database, id: number): string`
- **Purpose**: Soft-deletes transaction; returns `delete_batch_id`.

#### `getExpenseTransaction(db: Database, id: number): ExpenseTransaction`
- **Errors**: Throws if transaction not found or trashed.

#### `listExpenseTransactions(db: Database, filter?: ListExpenseTransactionsFilter): ExpenseTransaction[]`
- **Filter options**:
  - `month`: `YYYY-MM`.
  - `startDate`: `YYYY-MM-DD`.
  - `endDate`: `YYYY-MM-DD`.
  - `categoryId`: number | null.
  - `type`: `'expense' | 'income' | 'transfer'`.
- **Ordering**: `date DESC, id DESC`.
- **Soft delete**: Always excludes `deleted_at IS NOT NULL` rows.

---

### 2.6 Budgets Management

#### `setBudget(db: Database, input: ExpenseBudgetInput): ExpenseBudget`
- **Purpose**: Creates or updates a budget for a category and month.
- **Inputs**:
  - `categoryId`: number.
  - `month`: `YYYY-MM`.
  - `amount`: integer cents (`>= 0`).
  - `currency`: optional string (default `'USD'`).
- **Errors**:
  - Throws if `amount < 0` or not an integer.
  - Throws if `month` format is invalid.

#### `listBudgets(db: Database, month: string): ExpenseBudget[]`
- **Purpose**: Lists live budgets for a month.

#### `copyBudgetsFromPreviousMonth(db: Database, targetMonth: string): ExpenseBudget[]`
- **Purpose**: Copies all active budgets from the immediately preceding month into `targetMonth`.
- **Inputs**: `targetMonth` (`YYYY-MM`).
- **Outputs**: Array of newly created/updated budgets for `targetMonth`.

#### `deleteBudget(db: Database, id: number): string`
- **Purpose**: Soft-deletes a budget; returns `delete_batch_id`.

#### `getBudget(db: Database, id: number): ExpenseBudget`
- **Errors**: Throws if budget not found or trashed.

---

## 3. Validation Helpers

#### `assertIntegerCents(amount: unknown, fieldName?: string): asserts amount is number`
- Throws `Error` if `amount` is not a finite integer number.

#### `assertPositiveCents(amount: unknown, fieldName?: string): asserts amount is number`
- Throws `Error` if `amount` is not an integer or is `<= 0`.

#### `assertNonNegativeCents(amount: unknown, fieldName?: string): asserts amount is number`
- Throws `Error` if `amount` is not an integer or is `< 0`.
