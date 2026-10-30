// The AI assistant chat: a question, an answer, and underneath each answer the
// FULL disclosure of what was sent to the provider and what came back. Chats live
// in this component's memory only — nothing is persisted anywhere, and "Clear
// history" empties the list. When the provider is Off the page says so and offers
// nothing else; no request exists to make.
import { useCallback, useEffect, useRef, useState } from 'react'
import { Eraser, MessageCircleQuestion, SendHorizonal } from 'lucide-react'
import type { AssistantExchange, AssistantSettings } from '../../../shared/assistant'
import { failureText } from '../../../shared/assistant'
void failureText
import { today } from '../lib/dates'
import { errMsg } from '../lib/errors'
import { fmtAmount } from '../lib/format'
import { PageHeader } from '../components/PageHeader'
import { EmptyState } from '../components/EmptyState'

export function Assistant() {
  const [settings, setSettings] = useState<AssistantSettings | null>(null)
  const [keyState, setKeyState] = useState<{ saved: boolean; encryptionOk: boolean } | null>(null)
  const [exchanges, setExchanges] = useState<AssistantExchange[]>([])
  const [question, setQuestion] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [showFunctions, setShowFunctions] = useState(false)
  const [functions, setFunctions] = useState<{ name: string; description: string }[]>([])
  const bottom = useRef<HTMLDivElement>(null)

  const reload = useCallback(async () => {
    try {
      const [s, k] = await Promise.all([window.api.intelligence.assistant.get(), window.api.intelligence.assistant.keyStatus()])
      setSettings(s); setKeyState(k)
    } catch (e) { setError(errMsg(e)) }
  }, [])
  useEffect(() => { reload() }, [reload])
  useEffect(() => { bottom.current?.scrollIntoView({ block: 'nearest' }) }, [exchanges])

  const masterOn = true // the Intelligence toggle gates reaching this page; keep the invariant visible
  void masterOn
  const usable = settings !== null && keyState !== null &&
    (settings.provider === 'local' || (settings.provider === 'cloud' && settings.cloudConfirmed && keyState.saved))

  const ask = async (): Promise<void> => {
    if (busy || !question.trim()) return
    setBusy(true); setError('')
    try {
      const r = await window.api.intelligence.assistant.ask(question, today())
      if (r.ok) {
        setExchanges((all) => [...all, (r as { exchange: AssistantExchange }).exchange])
        setQuestion('')
      } else {
        setError((r as { error: string }).error)
      }
    } catch (e) { setError(errMsg(e)) }
    setBusy(false)
  }

  const loadFunctions = async (): Promise<void> => {
    if (functions.length > 0) return setShowFunctions((v) => !v)
    try { setFunctions(await window.api.intelligence.assistant.functions()); setShowFunctions(true) } catch (e) { setError(errMsg(e)) }
  }

  return (
    <div className="page page-sm">
      <PageHeader title="Assistant" subtitle={
        settings === null ? 'Loading…'
          : settings.provider === 'off' ? 'Off. Choose a provider on the Intelligence page.'
            : settings.provider === 'local' ? `Local model at ${settings.localUrl}. Your data stays on this computer.`
              : `Cloud provider at ${settings.cloudUrl}. Each question is sent over the internet — see under every answer what was sent.`
      }>
        <MessageCircleQuestion size={20} className="text-accent" />
      </PageHeader>

      {settings && settings.provider === 'off' && (
        <div className="mt-5">
          <EmptyState icon={MessageCircleQuestion} title="The assistant is off"
            text="Nothing has ever been sent. To use it, pick Local model or Cloud under Intelligence → AI provider — Cloud asks for an explicit confirmation first."
            action={<span className="meta">Ctrl+K → “intelligence”</span>} />
        </div>
      )}

      {settings && settings.provider !== 'off' && (
        <>
          {settings.provider === 'cloud' && !settings.cloudConfirmed && (
            <section className="card card-pad mt-5" aria-live="polite">
              <h2 className="section-title">Confirmation needed</h2>
              <p className="mt-2 text-sm">Cloud mode sends each question to {settings.cloudUrl}. Confirm it on the Intelligence page before anything can be asked here.</p>
            </section>
          )}
          {settings.provider === 'cloud' && settings.cloudConfirmed && keyState && !keyState.saved && (
            <section className="card card-pad mt-5">
              <h2 className="section-title">No API key yet</h2>
              <p className="mt-2 text-sm">Paste your key on the Intelligence page. It is stored with the operating system's encryption (never in plain text), never shown again, and never included in backups.</p>
              {keyState && !keyState.encryptionOk && <p className="mt-2 text-sm text-neg">This system cannot encrypt keys right now, so none can be saved.</p>}
            </section>
          )}

          {usable && (
            <>
              <div className="mt-5 flex flex-col gap-3" aria-live="polite">
                {exchanges.length === 0 && (
                  <p className="meta">Try: “how much did I save last month?” · “how many tasks did I finish this week?” · “what's my mood average over the last 30 days?”</p>
                )}
                {exchanges.map((x, i) => (
                  <article key={i} className="card card-pad">
                    <p className="text-sm font-medium">{x.question}</p>
                    <p className="mt-2 text-sm leading-relaxed">{x.answer}</p>
                    <details className="mt-3">
                      <summary className="section-link cursor-pointer text-xs">What was sent, exactly</summary>
                      <dl className="mt-2 flex flex-col gap-1.5 text-xs text-muted">
                        <div>
                          <dt className="meta">User turn (sent)</dt>
                          <dd className="mt-0.5 break-all font-mono">{x.disclosure.question}</dd>
                        </div>
                        <div>
                          <dt className="meta">Fixed instructions block</dt>
                          <dd className="mt-0.5">{x.disclosure.systemPromptChars} characters — function names only, no data.</dd>
                        </div>
                        <div>
                          <dt className="meta">Function chosen by the model</dt>
                          <dd className="mt-0.5 num">{x.disclosure.functionName} · {x.disclosure.range.from} → {x.disclosure.range.to}</dd>
                        </div>
                        <div>
                          <dt className="meta">Result computed on this computer</dt>
                          <dd className="mt-0.5 num">{fmtAmount(x.disclosure.result)}</dd>
                        </div>
                        <div>
                          <dt className="meta">Rows sent to the provider</dt>
                          <dd className="mt-0.5">None. Only the text above left this computer; the number was worked out locally and never sent back.</dd>
                        </div>
                      </dl>
                    </details>
                  </article>
                ))}
                <div ref={bottom} />
              </div>

              {error && <p role="alert" className="mt-3 text-sm text-neg">{error}</p>}

              <form className="mt-4 flex gap-2" onSubmit={(e) => { e.preventDefault(); void ask() }}>
                <input className="field" value={question} onChange={(e) => setQuestion(e.target.value)}
                  placeholder="Ask about your own data…" aria-label="Your question" disabled={busy} />
                <button type="submit" className="btn-primary" disabled={busy || !question.trim()} aria-busy={busy}>
                  <SendHorizonal size={15} /> Ask
                </button>
              </form>

              <div className="mt-4 flex flex-wrap items-center gap-2">
                <button className="btn" onClick={() => { setExchanges([]); setError('') }} disabled={exchanges.length === 0}>
                  <Eraser size={14} /> Clear history
                </button>
                <button className="btn" aria-expanded={showFunctions} onClick={loadFunctions}>
                  {showFunctions ? 'Hide' : 'Show'} the data functions
                </button>
                <span className="meta">Chats are not saved anywhere — closing the page clears them.</span>
              </div>

              {showFunctions && (
                <section className="card card-pad mt-3" aria-label="Data functions the model may call">
                  <h2 className="section-title">The only functions it can call</h2>
                  <p className="mt-1 text-sm text-muted">Read-only, one number each, run on this computer. The model picks one; it never sees rows or queries.</p>
                  <ul className="mt-2 flex flex-col gap-1 text-sm">
                    {functions.map((f) => (
                      <li key={f.name}><span className="num font-medium">{f.name}</span> — {f.description}</li>
                    ))}
                  </ul>
                </section>
              )}
            </>
          )}
        </>
      )}
    </div>
  )
}
