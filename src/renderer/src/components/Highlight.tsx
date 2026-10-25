// Shows text with every search word marked, e.g. "Gold breakout" for "gold".
const escapeRegExp = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

export function Highlight({ text, terms }: { text: string; terms: string[] }) {
  if (!text || terms.length === 0) return <>{text}</>
  // Longest words first, so "gold" does not hide a match for "golden".
  const pattern = [...terms].sort((a, b) => b.length - a.length).map(escapeRegExp).join('|')
  // Splitting on a capturing group puts the matches at the odd positions.
  const parts = text.split(new RegExp(`(${pattern})`, 'i'))
  return (
    <>
      {parts.map((part, i) =>
        i % 2 === 1
          ? <mark key={i} className="rounded bg-accent/25 px-0.5 text-fg">{part}</mark>
          : part)}
    </>
  )
}
