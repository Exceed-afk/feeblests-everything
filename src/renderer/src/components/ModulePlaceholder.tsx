export function ModulePlaceholder({ title, text }: { title: string; text: string }) {
  return (
    <div className="mx-auto max-w-2xl px-10 py-16">
      <h1 className="text-2xl font-semibold">{title}</h1>
      <div className="mt-6 rounded-2xl border border-dashed border-line bg-card/50 p-8">
        <p className="text-muted">{text}</p>
        <p className="mt-2 text-sm text-muted">This module is next in the build order.</p>
      </div>
    </div>
  )
}
