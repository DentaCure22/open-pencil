import { ArrowLeft, ArrowRight, ExternalLink, Globe2, RefreshCw } from 'lucide-react'
import { type FormEvent, useMemo, useState } from 'react'

function normalizedBrowserUrl(value: string): string | null {
  const trimmed = value.trim()
  if (!trimmed) return null
  let withProtocol = trimmed
  if (!/^[a-z][a-z\d+.-]*:/i.test(trimmed)) {
    withProtocol = /^(localhost|127\.0\.0\.1|0\.0\.0\.0)(:\d+)?(?:\/|$)/i.test(trimmed)
      ? `http://${trimmed}`
      : `https://${trimmed}`
  }
  try {
    const url = new URL(withProtocol)
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : null
  } catch {
    return null
  }
}

export default function T3BrowserSurface() {
  const [draft, setDraft] = useState('')
  const [history, setHistory] = useState<string[]>([])
  const [historyIndex, setHistoryIndex] = useState(-1)
  const [reloadKey, setReloadKey] = useState(0)
  const activeUrl = history[historyIndex] ?? ''
  const invalid = useMemo(() => Boolean(draft.trim() && !normalizedBrowserUrl(draft)), [draft])

  function navigate(value: string) {
    const url = normalizedBrowserUrl(value)
    if (!url) return
    const next = [...history.slice(0, historyIndex + 1), url]
    setHistory(next)
    setHistoryIndex(next.length - 1)
    setDraft(url)
  }

  function submit(event: FormEvent) {
    event.preventDefault()
    navigate(draft)
  }

  function step(offset: number) {
    const next = historyIndex + offset
    if (next < 0 || next >= history.length) return
    setHistoryIndex(next)
    setDraft(history[next] ?? '')
  }

  return (
    <div
      className="flex min-h-0 flex-1 flex-col bg-agent-surface"
      data-test-id="t3-browser-surface"
    >
      <form
        className="border-border/50 flex h-10 shrink-0 items-center gap-1 border-b px-2"
        onSubmit={submit}
      >
        <button
          type="button"
          aria-label="Back"
          disabled={historyIndex <= 0}
          className="flex size-7 items-center justify-center rounded-[6px] text-muted hover:bg-hover hover:text-surface disabled:opacity-30"
          onClick={() => step(-1)}
        >
          <ArrowLeft className="size-3.5" />
        </button>
        <button
          type="button"
          aria-label="Forward"
          disabled={historyIndex < 0 || historyIndex >= history.length - 1}
          className="flex size-7 items-center justify-center rounded-[6px] text-muted hover:bg-hover hover:text-surface disabled:opacity-30"
          onClick={() => step(1)}
        >
          <ArrowRight className="size-3.5" />
        </button>
        <button
          type="button"
          aria-label="Reload"
          disabled={!activeUrl}
          className="flex size-7 items-center justify-center rounded-[6px] text-muted hover:bg-hover hover:text-surface disabled:opacity-30"
          onClick={() => setReloadKey((current) => current + 1)}
        >
          <RefreshCw className="size-3.5" />
        </button>
        <div
          className={`border-chrome-control-border bg-chrome-control flex h-7 min-w-0 flex-1 items-center gap-1.5 rounded-[7px] border px-2 ${invalid ? 'border-red-400/55' : ''}`}
        >
          <Globe2 className="size-3.5 shrink-0 text-muted" />
          <input
            value={draft}
            aria-label="Browser address"
            placeholder="Search or enter URL"
            className="min-w-0 flex-1 bg-transparent text-[12px] text-surface outline-none placeholder:text-muted/70"
            onChange={(event) => setDraft(event.target.value)}
          />
        </div>
        <button
          type="submit"
          aria-label="Open address"
          disabled={invalid || !draft.trim()}
          className="flex size-7 items-center justify-center rounded-[6px] text-muted hover:bg-hover hover:text-surface disabled:opacity-30"
        >
          <ArrowRight className="size-3.5" />
        </button>
        <button
          type="button"
          aria-label="Open in system browser"
          disabled={!activeUrl}
          className="flex size-7 items-center justify-center rounded-[6px] text-muted hover:bg-hover hover:text-surface disabled:opacity-30"
          onClick={() => window.open(activeUrl, '_blank', 'noopener,noreferrer')}
        >
          <ExternalLink className="size-3.5" />
        </button>
      </form>
      {activeUrl ? (
        <iframe
          key={`${activeUrl}:${String(reloadKey)}`}
          title="Browser preview"
          src={activeUrl}
          className="min-h-0 flex-1 border-0 bg-white"
          sandbox="allow-forms allow-modals allow-popups allow-same-origin allow-scripts"
        />
      ) : (
        <div className="flex min-h-0 flex-1 flex-col items-center justify-center px-8 text-center">
          <Globe2 className="mb-3 size-8 text-muted/40" strokeWidth={1.3} />
          <p className="text-[13px] font-medium text-surface">No preview yet</p>
          <p className="mt-1 max-w-72 text-[12px] leading-5 text-muted">
            Type a URL above. Localhost apps open directly in this workspace browser.
          </p>
        </div>
      )}
    </div>
  )
}
