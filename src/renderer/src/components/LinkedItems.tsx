// The "Linked items" panel (Phase 0). Shows the links of one item in BOTH
// directions (a link made from either side shows here), lets the user add one
// through the ItemPicker and remove one. A link whose other side is trashed
// or gone is hidden by the service already.
//
// Theme tokens only; fully keyboard reachable (the panel opens in the editors
// next to the tag input, so the normal tab order covers it).
import { useCallback, useEffect, useState } from 'react'
import { Link2, Plus, X } from 'lucide-react'
import type { LinkType } from '../../../shared/links'
import { LINK_TYPE_LABELS } from '../../../shared/links'
import type { LinkedItemRef } from '../../../shared/links'
import { ItemPicker, type PickedItem } from './ItemPicker'
import { errMsg } from '../lib/errors'

interface Props {
  type: LinkType
  id: number
  onChanged?: () => void
}

export function LinkedItems({ type, id, onChanged }: Props) {
  const [links, setLinks] = useState<LinkedItemRef[]>([])
  const [picking, setPicking] = useState(false)
  const [error, setError] = useState('')

  const refresh = useCallback(async () => {
    try {
      setLinks(await window.api.links.list(type, id))
      setError('')
    } catch (e) {
      setError(errMsg(e))
    }
  }, [type, id])

  useEffect(() => { void refresh() }, [refresh])

  const add = async (item: PickedItem): Promise<void> => {
    setPicking(false)
    try {
      await window.api.links.add({ type, id }, { type: item.type, id: item.id })
      await refresh()
      onChanged?.()
    } catch (e) {
      setError(errMsg(e))
    }
  }

  const remove = async (linkId: number): Promise<void> => {
    try {
      await window.api.links.remove(linkId)
      await refresh()
      onChanged?.()
    } catch (e) {
      setError(errMsg(e))
    }
  }

  return (
    <section className="rounded-xl border border-line bg-bg p-3">
      <div className="flex items-center justify-between">
        <h3 className="inline-flex items-center gap-2 text-xs text-muted">
          <Link2 size={13} /> Linked items
        </h3>
        <button className="btn btn-sm" onClick={() => setPicking(true)}><Plus size={12} /> Link an item…</button>
      </div>
      {error && <p role="alert" className="mt-2 text-xs text-neg">{error}</p>}
      {links.length === 0 ? (
        <p className="mt-2 text-xs text-muted">Nothing linked yet. Links point both ways, so this list matches the other item's list.</p>
      ) : (
        <ul className="mt-2 flex flex-col gap-1.5">
          {links.map((link) => (
            <li key={link.linkId} className="flex items-center gap-2 rounded-lg border border-line/60 px-2.5 py-1.5">
              <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-accent" aria-hidden />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm">{link.label}</span>
                <span className="block text-xs text-muted">{LINK_TYPE_LABELS[link.type]}{link.sublabel ? ` · ${link.sublabel}` : ''}</span>
              </span>
              <button className="btn-icon" onClick={() => void remove(link.linkId)} aria-label={`Unlink ${link.label}`}>
                <X size={13} />
              </button>
            </li>
          ))}
        </ul>
      )}
      {picking && (
        <ItemPicker title="Link an item" onPick={(item) => void add(item)} onClose={() => setPicking(false)} />
      )}
    </section>
  )
}
