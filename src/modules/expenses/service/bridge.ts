// Names the renderer and the IPC bridge use for the Phase 1 Expenses service.
//
// These are aliases of the service's own types: the UI and the preload script
// speak exactly the shapes the service layer defines, so nothing is translated
// or re-shaped in between (integers stay integers, cents stay cents).
export type {
  ExpenseCategory as ExpenseCategoryDTO,
  ExpenseTransaction as ExpenseTransactionDTO,
  ExpenseTransactionInput as ExpenseTransactionInputDTO,
  ExpenseBudget as ExpenseBudgetDTO,
  RecurringBill as RecurringBillDTO,
  RecurringBillInput as RecurringBillInputDTO,
  RecurringOccurrence as RecurringOccurrenceDTO,
  LeftToSpendResult as ExpenseSummary,
  SavingsTransferResult as SavingsTransferResultDTO
} from './types'

export type { ListExpenseTransactionsFilter as ExpenseTxFilter } from './transactions'
export type { DueBill } from './recurring'
