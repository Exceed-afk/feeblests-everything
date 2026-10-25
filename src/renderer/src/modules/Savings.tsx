import { useCallback, useEffect, useMemo, useState } from 'react'
import { Plus } from 'lucide-react'
import type { SavingsGoal } from '../../../shared/types'
import { progressPercent } from '../../../shared/savings'
import { round8 } from '../../../shared/math'
import { fmtAmount } from '../lib/format'
import { ProgressBar } from '../components/ProgressBar'
import { GoalDetail } from './GoalDetail'
import type { ModuleProps } from '../lib/navigation'
import { GoalEditor } from './GoalEditor'

export function Savings({ target, onTargetHandled }: ModuleProps) {
  const [goals, setGoals] = useState<SavingsGoal[]>([])
  const [loaded, setLoaded] = useState(false)
  const [detailId, setDetailId] = useState<number | null>(null)
  const [editor, setEditor] = useState<SavingsGoal | 'new' | null>(null)

  const refresh = useCallback(async () => {
    setGoals(await window.api.savings.listGoals())
    setLoaded(true)
  }, [])
  useEffect(() => { refresh() }, [refresh])

  // Opened from Search: show that goal's detail panel straight away.
  useEffect(() => {
    if (target?.module === 'savings') { setDetailId(target.goalId); onTargetHandled() }
  }, [target, onTargetHandled])

  // Ctrl+N starts a new goal.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.key.toLowerCase() === 'n') { e.preventDefault(); setEditor('new') }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const total = useMemo(() => round8(goals.reduce((sum, g) => sum + g.balance, 0)), [goals])
  const detail = goals.find((g) => g.id === detailId) ?? null

  return (
    <div className="mx-auto max-w-4xl px-10 py-10">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Savings</h1>
        <button className="btn-primary" onClick={() => setEditor('new')} title="Ctrl+N">
          <Plus size={16} /> New goal
        </button>
      </div>

      {goals.length > 0 && (
        <div className="mt-6 rounded-2xl border border-line bg-card p-5 shadow-card">
          <div className="text-xs text-muted">Total saved across {goals.length} {goals.length === 1 ? 'goal' : 'goals'}</div>
          <div className="mt-1 text-3xl font-semibold tabular-nums">{fmtAmount(total)}</div>
        </div>
      )}

      {loaded && goals.length === 0 && (
        <div className="mt-6 rounded-2xl border border-dashed border-line bg-card/50 p-10 text-center">
          <p className="font-medium">Every big balance starts with one goal.</p>
          <p className="mt-1 text-sm text-muted">Name what you are saving for, set a target if you have one, then add your first deposit.</p>
          <button className="btn-primary mt-5" onClick={() => setEditor('new')}>
            <Plus size={16} /> Create your first goal
          </button>
        </div>
      )}

      <div className="mt-6 grid gap-4 sm:grid-cols-2">
        {goals.map((g) => {
          const pct = progressPercent(g.balance, g.target)
          return (
            <article key={g.id} onClick={() => setDetailId(g.id)} tabIndex={0}
              onKeyDown={(e) => e.key === 'Enter' && setDetailId(g.id)}
              className="cursor-pointer rounded-2xl border border-line bg-card p-5 shadow-card hover:border-accent/50">
              <h2 className="font-medium">{g.name}</h2>
              <div className="mt-2 text-2xl font-semibold tabular-nums">{fmtAmount(g.balance)}</div>
              {g.target !== null && pct !== null ? (
                <>
                  <div className="mt-3"><ProgressBar percent={pct} /></div>
                  <div className="mt-2 flex justify-between text-xs text-muted">
                    <span>{pct >= 100 ? 'Goal reached' : `${Math.floor(pct)}%`}</span>
                    <span>Target {fmtAmount(g.target)}</span>
                  </div>
                </>
              ) : (
                <div className="mt-3 text-xs text-muted">No target set</div>
              )}
            </article>
          )
        })}
      </div>

      {detail && (
        <GoalDetail key={`detail-${detail.id}`} goal={detail} blocked={editor !== null}
          onChanged={refresh} onEditGoal={() => setEditor(detail)} onClose={() => setDetailId(null)} />
      )}
      {editor && (
        <GoalEditor key={editor === 'new' ? 'editor-new' : `editor-${editor.id}`} goal={editor === 'new' ? null : editor}
          onClose={() => setEditor(null)}
          onSaved={() => { setEditor(null); refresh() }} />
      )}
    </div>
  )
}
