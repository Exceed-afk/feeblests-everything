// A dashboard widget body: loads its own data when it first appears, and shows
// a quiet skeleton while it waits. Every widget module exports its widgets
// with this helper, so loading, the error line and the "module is off" case
// are written once instead of in each widget.
import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
// The widget's own renderer, given the loaded data and (unused for now) a reload.
export interface WidgetShell<P> {
  children: (data: P, reload: () => void) => ReactNode
  empty?: ReactNode
  load: () => Promise<P>
}

// `load` runs once per mount. The Dashboard wraps every widget in
// <Suspense>, so this is also when its code chunk arrives.
export function WidgetBody<P>({ load, children, empty }: WidgetShell<P>) {
  const [data, setData] = useState<P | null>(null)
  const [error, setError] = useState('')
  const [tick, setTick] = useState(0)
  useEffect(() => {
    let alive = true
    setError('')
    load().then((d) => { if (alive) setData(d) }).catch((e) => { if (alive) setError(e instanceof Error ? e.message : String(e)) })
    return () => { alive = false }
    // `load` is a stable module-level function in every widget.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tick])
  if (error) return <p role="alert" className="text-sm text-neg">{error}</p>
  if (data === null) return <WidgetSkeleton />
  if (empty) return <>{empty}</>
  return <>{children(data, () => setTick((t) => t + 1))}</>
}

// Three quiet bars, the height of a small tile. Uses the theme's line colour,
// so it reads as "loading" in every palette and both styles.
function WidgetSkeleton() {
  return (
    <div className="flex flex-col gap-2" aria-hidden="true">
      <div className="h-2.5 w-1/2 rounded bg-fg/10" />
      <div className="h-6 w-2/3 rounded bg-fg/10" />
      <div className="h-2 w-full rounded bg-fg/10" />
    </div>
  )
}
