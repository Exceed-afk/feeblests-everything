// The Trash page (Phase 0): everything deleted sits here until it comes back
// or is purged (Settings decides how many days). One row per DELETE BATCH -
// rows trashed as one action (a multi-select, or a goal with its
// transactions) restore together or die together. Keyboard accessible like
// every page; no hardcoded colours.
import { useCallback, useEffect, useState } from 'react'
import { useRefreshOnCapture } from '../lib/dataChanged'
import { Trash2, Undo2 } from 'lucide-react'
import type { ModuleProps } from '../lib/navigation'
import type { TrashBatch } from '../../../shared/trash'
import { PageHeader } from '../components/PageHeader'
import { EmptyState } from '../components/EmptyState'
import { errMsg } from '../lib/errors'
import { useSettings } from '../lib/settingsStore'
import { formatDate } from '../lib/dates'

const KIND_LABELS: Record<TrashBatch['items'][number]['type'], string> = {
  logbook: 'Journal entry',
  trade: 'Trade',
  savings_tx: 'Savings transaction',
  goal: 'Savings goal',
  habit: 'Habit',
  task: 'Task',
  note: 'Note',
  content: 'Content item',
  time_session: 'Focus session',
  project: 'Project',
  snippet: 'Snippet',
  scratchpad: 'Scratchpad',
  expense_tx: 'Expense transaction',
  recurring_bill: 'Recurring bill'
}

// One batch's first item names the row; the rest are counted. "as at" = the
// local trashed day, like every other day bucket in the app.
const when = (batch: TrashBatch): string => `${formatDate(batch.trashedAt.slice(0, 10))} · ${batch.count} ${batch.count === 1 ? 'item' : 'items'}`

export function Trash({ onNavigate }: ModuleProps) {
  const [batches, setBatches] = useState<TrashBatch[]>([])
  const [loaded, setLoaded] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState('')
  const settings = useSettings()
  const purgeDays = Math.max(0, settings.trash?.purgeDays ?? 30)

  const refresh = useCallback(async () => {
    try {
      setBatches(await window.api.trash.list())
    } catch (e) {
      setError(errMsg(e))
    }
    setLoaded(true)
  }, [])

  useRefreshOnCapture(refresh)

  useEffect(() => {
    void refresh()
  }, [refresh])

  // Restores the whole batch: the same click the Undo toast's button makes,
  // going through the same tracked call.
  const restore = async (batch: TrashBatch): Promise<void> => {
    setBusy(batch.batchId)
    setError('')
    try {
      await window.api.trash.restore(batch.batchId ?? '')
      await refresh()
    } catch (e) {
      setError(errMsg(e))
    }
    setBusy(null)
  }

  const forever = async (batch: TrashBatch): Promise<void> => {
    setBusy(batch.batchId)
    setError('')
    try {
      await window.api.trash.deleteForever(batch.batchId ?? '')
      await refresh()
    } catch (e) {
      setError(errMsg(e))
    }
    setBusy(null)
  }

  return (
    <div className="page page-sm">
      <PageHeader title="Trash" subtitle={`${batches.length === 0 ? 'Nothing here.' : `${batches.length} ${batches.length === 1 ? 'delete' : 'deletes'} waiting.`} Batches trashed more than ${purgeDays} days ago are purged automatically.`} />

      {error && <p role="alert" className="text-sm text-neg">{error}</p>}

      {loaded && batches.length === 0 && (
        <EmptyState icon={Trash2} title="The Trash is empty."
          text="Deleted items land here first, so a slip is never final. They go for good after the purge window (Settings) — along with the automatic daily backups, that is your safety net." />
      )}

      <div className="mt-5 flex flex-col gap-2">
        {batches.map((batch) => (
          <article key={batch.batchId} className="card card-pad">
            <div className="meta">{when(batch)}</div>
            <div className="mt-1 flex flex-wrap items-baseline gap-x-3">
              <span className="font-semibold">{KIND_LABELS[batch.items[0].type]}</span>
              <span>{batch.items.map((item) => item.label).slice(0, 4).join(' · ')}</span>
              {batch.items.length > 4 && <span className="text-muted">and {batch.items.length - 4} more</span>}
            </div>
            <div className="mt-3 flex gap-2">
              <button className="btn" onClick={() => void restore(batch)} disabled={busy != null}>
                <Undo2 size={14} /> Restore{batch.count > 1 ? ' all' : ''}
              </button>
              {/* No aria-busy here: the shared .btn style hides the LABEL while
                  busy (colour: transparent), and a stuck busy state made this
                  button a blank red pill. Disabled alone is enough feedback. */}
              <button className="btn btn-danger" onClick={() => void forever(batch)} disabled={busy != null}>
                Delete forever
              </button>
            </div>
          </article>
        ))}
      </div>
    </div>
  )
}

