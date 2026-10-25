// Fills up to 100% but is allowed to be exceeded in the numbers shown elsewhere.
export function ProgressBar({ percent }: { percent: number }) {
  const shown = Math.max(0, Math.min(100, percent))
  return (
    <div role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(shown)}
      className="h-2 w-full overflow-hidden rounded-full bg-fg/10">
      <div className={`h-full rounded-full transition-all duration-500 ${percent >= 100 ? 'bg-emerald-500' : 'bg-accent'}`}
        style={{ width: `${shown}%` }} />
    </div>
  )
}
