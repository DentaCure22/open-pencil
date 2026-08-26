/*
 * React island adapted from T3 Code's MessagesTimeline at
 * 5d7665396083d285132d67038813862a93337ca5 (MIT, T3 Tools Inc.).
 * See THIRD_PARTY_NOTICES.md.
 */
import {
  memo,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
  type SVGProps
} from 'react'

import { assistantMarkdownNodes, isSafeMarkdownUrl, type AssistantMarkdownNode } from './markdown'
import {
  isMediaGenerationTool,
  isVideoGenerationTool,
  shortToolInput,
  toolCallKind,
  toolCallLabel,
  toolCallProgressLabel,
  type AiToolKind
} from './model'
import {
  nextStreamedLength,
  prefersStreamedTextMotion,
  sliceStreamedText,
  splitStreamedTextTail
} from './streamed-text'
import {
  computeStableT3MessagesTimelineRows,
  deriveT3MessagesTimelineRows,
  deriveT3TimelineEntries,
  type StableT3MessagesTimelineRowsState,
  type T3MessagesTimelineRow,
  type T3TimelineNarrativeEntry,
  type T3TimelineWorkEntry
} from './t3-messages-timeline.logic'
import type { AiConversationStatus, AiMessage } from './types'

export interface T3MessagesTimelineProps {
  endedAt?: string
  hasVisibleContent?: boolean
  messages: AiMessage[]
  startedAt?: string
  status: AiConversationStatus
  workingLabel?: string
}

const INITIAL_ANIMATED_TAIL_LENGTH = 18
const IDEAL_FRAME_MS = 1_000 / 60

function initialStreamedText(value: string): string {
  return sliceStreamedText(value, Math.max(0, value.length - INITIAL_ANIMATED_TAIL_LENGTH))
}

function useSmoothedText(text: string, streaming: boolean): string {
  const [displayed, setDisplayed] = useState(() =>
    streaming && prefersStreamedTextMotion() ? initialStreamedText(text) : text
  )
  const displayedRef = useRef(displayed)
  const incomingRef = useRef(text)
  const frameRef = useRef(0)
  const previousFrameAtRef = useRef(0)
  const streamingRef = useRef(streaming)

  useEffect(() => {
    displayedRef.current = displayed
  }, [displayed])

  useEffect(() => {
    streamingRef.current = streaming
    if (!prefersStreamedTextMotion()) {
      displayedRef.current = text
      incomingRef.current = text
      setDisplayed(text)
      return
    }
    if (!text.startsWith(displayedRef.current)) {
      // Provider rewrites are authoritative. Snapping the rewritten tail is
      // less disruptive than deleting already painted words frame by frame.
      displayedRef.current = text
      incomingRef.current = text
      previousFrameAtRef.current = 0
      setDisplayed(text)
      return
    }
    incomingRef.current = text

    const paint = (now: number) => {
      frameRef.current = 0
      const current = displayedRef.current
      const incoming = incomingRef.current
      if (current.length >= incoming.length) {
        if (current !== incoming) {
          displayedRef.current = incoming
          setDisplayed(incoming)
        }
        previousFrameAtRef.current = 0
        return
      }
      const elapsedMs = previousFrameAtRef.current
        ? now - previousFrameAtRef.current
        : IDEAL_FRAME_MS
      previousFrameAtRef.current = now
      const length = nextStreamedLength({
        displayed: current.length,
        elapsedMs,
        finishing: !streamingRef.current,
        incoming: incoming.length
      })
      const next = sliceStreamedText(incoming, length)
      displayedRef.current = next
      setDisplayed(next)
      if (next.length < incomingRef.current.length) frameRef.current = requestAnimationFrame(paint)
      else previousFrameAtRef.current = 0
    }

    if (displayedRef.current.length < incomingRef.current.length && !frameRef.current) {
      frameRef.current = requestAnimationFrame(paint)
    }
  }, [streaming, text])

  useEffect(
    () => () => {
      if (frameRef.current) cancelAnimationFrame(frameRef.current)
    },
    []
  )

  return displayed
}

function StreamingText({ active, text }: { active: boolean; text: string }) {
  if (!active) return text
  const split = splitStreamedTextTail(text)
  return (
    <>
      {split.stable}
      {split.tail.map((segment) =>
        segment.value !== undefined ? (
          segment.value
        ) : (
          <span className="t3-stream-word" key={segment.key}>
            {segment.glyphs?.map((glyph) => (
              <span className="t3-stream-glyph" key={glyph.key}>
                {glyph.value}
              </span>
            ))}
          </span>
        )
      )}
    </>
  )
}

function InlineMarkdownNode({
  active,
  children,
  node,
  nodeKey
}: {
  active: boolean
  children: ReactNode
  node: AssistantMarkdownNode
  nodeKey: string
}): ReactNode {
  switch (node.type) {
    case 'strong':
      return <strong key={nodeKey}>{children}</strong>
    case 'emphasis':
      return <em key={nodeKey}>{children}</em>
    case 'delete':
      return <del key={nodeKey}>{children}</del>
    case 'link':
      if (!isSafeMarkdownUrl(node.url)) return <span key={nodeKey}>{children}</span>
      return (
        <a href={node.url} key={nodeKey} rel="noreferrer" target="_blank">
          {children}
        </a>
      )
    case 'inlineCode':
      return <code key={nodeKey}>{node.value}</code>
    case 'code':
      return (
        <pre key={nodeKey}>
          <code>{node.value}</code>
        </pre>
      )
    case 'break':
      return <br key={nodeKey} />
    case 'thematicBreak':
      return <hr key={nodeKey} />
    case 'text':
      return <StreamingText active={active} key={nodeKey} text={node.value ?? ''} />
    default:
      if (children) return <span key={nodeKey}>{children}</span>
      return node.value ? <span key={nodeKey}>{node.value}</span> : null
  }
}

function MarkdownNodes({
  nodes,
  streamingTail = false
}: {
  nodes: AssistantMarkdownNode[]
  streamingTail?: boolean
}): ReactNode {
  return nodes.map((node, index) => {
    const active = streamingTail && index === nodes.length - 1
    const children = node.children?.length ? (
      <MarkdownNodes nodes={node.children} streamingTail={active} />
    ) : null
    const nodeKey = `${node.type}-${String(index)}`
    if (node.type === 'paragraph') return <p key={nodeKey}>{children}</p>
    if (node.type === 'heading') {
      const depth = Math.min(4, Math.max(1, node.depth ?? 2))
      if (depth === 1) return <h1 key={nodeKey}>{children}</h1>
      if (depth === 2) return <h2 key={nodeKey}>{children}</h2>
      if (depth === 3) return <h3 key={nodeKey}>{children}</h3>
      return <h4 key={nodeKey}>{children}</h4>
    }
    if (node.type === 'list') {
      if (node.ordered) return <ol key={nodeKey}>{children}</ol>
      return <ul key={nodeKey}>{children}</ul>
    }
    if (node.type === 'listItem') return <li key={nodeKey}>{children}</li>
    if (node.type === 'blockquote') return <blockquote key={nodeKey}>{children}</blockquote>
    return (
      <InlineMarkdownNode
        active={active}
        children={children}
        key={nodeKey}
        node={node}
        nodeKey={nodeKey}
      />
    )
  })
}

const NarrativeRow = memo(function NarrativeRow({
  message
}: {
  message: T3TimelineNarrativeEntry
}) {
  const streaming = message.state === 'streaming'
  const displayed = useSmoothedText(message.text.trim(), streaming)
  const nodes = useMemo(() => assistantMarkdownNodes(displayed), [displayed])
  return (
    <div
      aria-live={streaming ? 'polite' : undefined}
      className="t3-activity-markdown min-w-0 px-1 py-0.5 font-sans text-[13px] leading-5 font-normal text-surface"
      data-state={message.state}
      data-test-id={message.narrativeKind === 'commentary' ? 'ai-commentary' : 'ai-reasoning'}
    >
      {nodes.length ? (
        <MarkdownNodes nodes={nodes} streamingTail={streaming} />
      ) : (
        <p>{displayed}</p>
      )}
    </div>
  )
})

function Svg({ children, ...props }: SVGProps<SVGSVGElement>) {
  return (
    <svg
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.8"
      viewBox="0 0 24 24"
      {...props}
    >
      {children}
    </svg>
  )
}

function ChevronDown(props: SVGProps<SVGSVGElement>) {
  return (
    <Svg {...props}>
      <path d="m6 9 6 6 6-6" />
    </Svg>
  )
}

function ChevronRight(props: SVGProps<SVGSVGElement>) {
  return (
    <Svg {...props}>
      <path d="m9 18 6-6-6-6" />
    </Svg>
  )
}

function XMark(props: SVGProps<SVGSVGElement>) {
  return (
    <Svg {...props}>
      <path d="M18 6 6 18M6 6l12 12" />
    </Svg>
  )
}

function ToolIcon({ kind, ...props }: { kind: AiToolKind } & SVGProps<SVGSVGElement>) {
  if (kind === 'command') {
    return (
      <Svg {...props}>
        <path d="m4 17 6-6-6-6M12 19h8" />
      </Svg>
    )
  }
  if (kind === 'search') {
    return (
      <Svg {...props}>
        <circle cx="11" cy="11" r="7" />
        <path d="m20 20-3.5-3.5" />
      </Svg>
    )
  }
  if (kind === 'web') {
    return (
      <Svg {...props}>
        <circle cx="12" cy="12" r="9" />
        <path d="M3 12h18M12 3a15 15 0 0 1 0 18M12 3a15 15 0 0 0 0 18" />
      </Svg>
    )
  }
  if (kind === 'read') {
    return (
      <Svg {...props}>
        <path d="M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6Z" />
        <circle cx="12" cy="12" r="2.5" />
      </Svg>
    )
  }
  if (kind === 'edit') {
    return (
      <Svg {...props}>
        <path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L8 18l-4 1 1-4Z" />
      </Svg>
    )
  }
  if (kind === 'list') {
    return (
      <Svg {...props}>
        <path d="M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01" />
      </Svg>
    )
  }
  if (kind === 'mail') {
    return (
      <Svg {...props}>
        <rect height="14" rx="2" width="20" x="2" y="5" />
        <path d="m3 7 9 6 9-6" />
      </Svg>
    )
  }
  if (kind === 'message') {
    return (
      <Svg {...props}>
        <path d="M21 15a4 4 0 0 1-4 4H8l-5 3V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4Z" />
      </Svg>
    )
  }
  if (kind === 'image' || kind === 'video') {
    return (
      <Svg {...props}>
        <rect height="18" rx="2" width="18" x="3" y="3" />
        <circle cx="8.5" cy="8.5" r="1.5" />
        <path d="m21 15-5-5L5 21" />
      </Svg>
    )
  }
  if (kind === 'handoff') {
    return (
      <Svg {...props}>
        <path d="M6 3v12M18 9v12M6 15c0-3 3-6 6-6h6M14 5l4 4-4 4" />
      </Svg>
    )
  }
  if (kind === 'connected-app') {
    return (
      <Svg {...props}>
        <path d="m12 22 1-5-4-2 6-13-1 8 5 2Z" />
      </Svg>
    )
  }
  return (
    <Svg {...props}>
      <path d="M14.7 6.3a4 4 0 0 0-5 5L3 18l3 3 6.7-6.7a4 4 0 0 0 5-5l-2.4 2.4-3-3Z" />
    </Svg>
  )
}

function compactOutput(value?: string): string {
  const line = value?.replace(/\s+/g, ' ').trim() ?? ''
  if (!line) return ''
  return line.length > 84 ? `${line.slice(0, 83).trimEnd()}…` : line
}

function toolAccessibleLabel(heading: string, preview: string): string {
  return preview ? `${heading}, ${preview}` : heading
}

function deriveToolRowView(entry: T3TimelineWorkEntry) {
  const { part, state } = entry
  const running = state === 'pending' || state === 'running'
  const heading = running
    ? toolCallProgressLabel(part.name, part.input)
    : toolCallLabel(part.name, part.input)
  const preview = shortToolInput(part.input) || compactOutput(part.output)
  return {
    hasDetail: Boolean(part.input || part.output || part.error || part.images?.length),
    heading,
    kind: toolCallKind(part.name, part.input),
    part,
    preview,
    state
  }
}

function toolRowClass(hasDetail: boolean): string {
  const interaction = hasDetail
    ? ' cursor-pointer hover:bg-hover/25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-component/30'
    : ''
  return `flex flex-col rounded-md px-0.5 py-0 transition-colors${interaction}`
}

function toolKeyboardActivates(event: KeyboardEvent<HTMLDivElement>, hasDetail: boolean): boolean {
  return hasDetail && (event.key === 'Enter' || event.key === ' ')
}

function ToolDetails({ part }: { part: T3TimelineWorkEntry['part'] }) {
  const input = part.input?.trim() ?? ''
  const detail = (part.error ?? part.output)?.trim() ?? ''
  return (
    <div
      className="mt-1 ms-7 cursor-default border-s border-border/45 ps-3 pt-0.5"
      data-test-id="ai-tool-detail-panel"
      onClick={(event) => event.stopPropagation()}
      onPointerDown={(event) => event.stopPropagation()}
    >
      {input || detail ? (
        <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words font-mono text-[11px] leading-relaxed text-muted select-text">
          {input ? <span data-test-id="ai-tool-detail-input">{input}</span> : null}
          {input && detail ? '\n\n' : null}
          {detail ? (
            <span className={part.error ? 'text-red-400' : undefined} data-test-id="ai-tool-output">
              {detail}
            </span>
          ) : null}
        </pre>
      ) : null}
      {part.images?.length ? (
        <div className="mt-2 grid gap-2">
          {part.images.map((image, index) => (
            <img
              alt={image.alt ?? 'Tool result'}
              className="max-h-48 w-full rounded-lg object-contain"
              key={`${image.url}:${String(index)}`}
              src={image.url}
            />
          ))}
        </div>
      ) : null}
    </div>
  )
}

const ToolRow = memo(function ToolRow({ entry }: { entry: T3TimelineWorkEntry }) {
  const [expanded, setExpanded] = useState(false)
  const { hasDetail, heading, kind, part, preview, state } = deriveToolRowView(entry)
  const toggle = () => {
    if (hasDetail) setExpanded((value) => !value)
  }
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!toolKeyboardActivates(event, hasDetail)) return
    event.preventDefault()
    toggle()
  }

  return (
    <div
      aria-expanded={hasDetail ? expanded : undefined}
      aria-label={hasDetail ? toolAccessibleLabel(heading, preview) : undefined}
      className={toolRowClass(hasDetail)}
      data-kind={kind}
      data-state={state}
      data-test-id="ai-tool-call"
      onClick={toggle}
      onKeyDown={onKeyDown}
      role={hasDetail ? 'button' : undefined}
      tabIndex={hasDetail ? 0 : undefined}
    >
      <div className="flex min-w-0 select-none items-center gap-1.5 transition-[opacity,translate] duration-200">
        <span
          className={`flex size-6 shrink-0 items-center justify-center ${state === 'error' ? 'text-red-400' : state === 'approval' ? 'text-amber-400' : 'text-muted'}`}
        >
          {state === 'error' ? (
            <XMark className="block size-4 shrink-0 opacity-80" />
          ) : (
            <ToolIcon className="block size-4 shrink-0 opacity-70" kind={kind} />
          )}
        </span>
        <div className="flex min-w-0 flex-1 items-center gap-1.5">
          <p className="flex min-w-0 flex-1 items-baseline gap-1.5 overflow-hidden text-[13px] leading-6">
            <span
              className="min-w-0 flex-1 truncate font-normal text-muted"
              data-test-id="ai-tool-label"
            >
              {preview ? `${heading} · ${preview}` : heading}
            </span>
          </p>
          <span
            className={`flex size-4 shrink-0 items-center justify-center text-muted ${hasDetail ? '' : 'invisible'}`}
            aria-hidden="true"
          >
            {hasDetail ? (
              <ChevronDown
                className={`size-3 opacity-70 transition-transform duration-200 ${expanded ? 'rotate-180' : ''}`}
              />
            ) : null}
          </span>
        </div>
      </div>
      {expanded && hasDetail ? <ToolDetails part={part} /> : null}
    </div>
  )
})

function WorkRow({ row }: { row: Extract<T3MessagesTimelineRow, { kind: 'work' }> }) {
  return (
    <div
      aria-label={
        row.groupedEntries.length === 1
          ? '1 tool call'
          : `${String(row.groupedEntries.length)} tool calls`
      }
      className={`-mx-1 px-1 ${row.isExpandedToolGroupEntry ? 'py-0' : 'space-y-0.5 py-0.5'}`}
      data-test-id="ai-tool-group"
    >
      <div className="space-y-px">
        {row.groupedEntries.map((entry) => (
          <ToolRow entry={entry} key={entry.id} />
        ))}
      </div>
    </div>
  )
}

function LiveActivityContent({
  highlighted = false,
  kind,
  label
}: {
  highlighted?: boolean
  kind: AiToolKind
  label: string
}) {
  return (
    <div
      className={`flex min-h-6 min-w-0 items-center gap-1.5 py-0.5 ${highlighted ? 'text-surface' : 'text-muted'}`}
    >
      <span className="flex size-6 shrink-0 items-center justify-center">
        <ToolIcon
          className={`block size-4 shrink-0 ${highlighted ? '' : 'opacity-70'}`}
          kind={kind}
        />
      </span>
      <span className="min-w-0 flex-1 truncate">{label}</span>
    </div>
  )
}

function LiveWorkRow({
  onToggle,
  row
}: {
  onToggle: (groupId: string, anchor: HTMLButtonElement) => void
  row: Extract<T3MessagesTimelineRow, { kind: 'work-live' }>
}) {
  const { heading, kind } = deriveToolRowView(row.entry)
  return (
    <button
      aria-expanded={row.expanded}
      className="group/live-work flex min-h-6 w-full max-w-full cursor-pointer items-center rounded-md text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-component/30"
      data-test-id="ai-tool-group-toggle"
      onClick={(event) => onToggle(row.groupId, event.currentTarget)}
      type="button"
    >
      <div className="relative min-h-6 w-fit max-w-full min-w-0 flex-1 overflow-hidden rounded-md text-[13px] leading-6">
        <LiveActivityContent kind={kind} label={heading} />
        <div
          aria-hidden="true"
          className="t3-live-activity-focus pointer-events-none absolute inset-y-0 select-none"
        >
          <div className="t3-live-activity-focus-counter">
            <div className="t3-live-activity-focus-aligned">
              <LiveActivityContent highlighted kind={kind} label={heading} />
            </div>
          </div>
        </div>
      </div>
      <ChevronDown
        aria-hidden="true"
        className={`mr-0.5 size-3 shrink-0 text-muted opacity-70 transition-transform duration-200 ${row.expanded ? 'rotate-180' : ''}`}
      />
    </button>
  )
}

function findNearestVerticalScroller(element: HTMLElement): HTMLElement | null {
  let current = element.parentElement
  while (current) {
    const overflowY = getComputedStyle(current).overflowY
    if (
      (overflowY === 'auto' || overflowY === 'scroll') &&
      current.scrollHeight > current.clientHeight
    ) {
      return current
    }
    current = current.parentElement
  }
  return null
}

function WorkToggleRow({
  onToggle,
  row
}: {
  onToggle: (groupId: string, anchor: HTMLButtonElement) => void
  row: Extract<T3MessagesTimelineRow, { kind: 'work-toggle' }>
}) {
  return (
    <button
      aria-expanded={row.expanded}
      aria-label={row.hasFailure ? `${row.summary}, tool call failed` : undefined}
      className="group/tool-group flex min-h-6 w-full cursor-pointer items-center gap-1.5 rounded-md px-0.5 py-0.5 text-left text-[13px] leading-6 transition-colors duration-150 hover:bg-hover/25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-component/30"
      data-test-id="ai-tool-group-toggle"
      onClick={(event) => onToggle(row.groupId, event.currentTarget)}
      type="button"
    >
      <span
        className={`flex size-6 shrink-0 items-center justify-center ${row.hasFailure ? 'text-red-400' : 'text-muted'}`}
      >
        {row.hasFailure ? (
          <XMark className="size-4 shrink-0 opacity-70" />
        ) : (
          <ToolIcon
            className="size-4 shrink-0 opacity-70"
            kind={row.summaryKind === 'mixed' ? 'tool' : row.summaryKind}
          />
        )}
      </span>
      <span className="min-w-0 flex-1 truncate font-normal text-muted">{row.summary}</span>
      <ChevronDown
        aria-hidden="true"
        className={`mr-0.5 size-3 shrink-0 text-muted opacity-70 transition-transform duration-200 ${row.expanded ? 'rotate-180' : ''}`}
      />
    </button>
  )
}

function formatWorkingDuration(seconds: number): string {
  const hours = Math.floor(seconds / 3_600)
  const minutes = Math.floor((seconds % 3_600) / 60)
  const remainder = seconds % 60
  if (hours > 0) return minutes > 0 ? `${String(hours)}h ${String(minutes)}m` : `${String(hours)}h`
  if (minutes > 0) {
    return remainder > 0 ? `${String(minutes)}m ${String(remainder)}s` : `${String(minutes)}m`
  }
  return `${String(remainder)}s`
}

function WorkingTimer({ createdAt }: { createdAt: string }) {
  const ref = useRef<HTMLSpanElement>(null)
  useEffect(() => {
    const tick = () => {
      const start = Date.parse(createdAt)
      const seconds = Number.isFinite(start)
        ? Math.max(0, Math.floor((Date.now() - start) / 1_000))
        : 0
      if (ref.current) ref.current.textContent = formatWorkingDuration(seconds)
    }
    tick()
    const timer = window.setInterval(tick, 1_000)
    return () => window.clearInterval(timer)
  }, [createdAt])
  return <span className="tabular-nums" ref={ref} />
}

function WorkingRow({ row }: { row: Extract<T3MessagesTimelineRow, { kind: 'working' }> }) {
  return (
    <div className="py-0.5 pl-1.5" data-test-id="ai-turn-duration">
      <div className="flex min-w-0 items-center gap-2 pt-1 text-[11px] text-muted tabular-nums">
        <span className="inline-flex items-center gap-[3px]" aria-hidden="true">
          <span
            className={`t3-status-dot h-1 w-1 rounded-full bg-muted/40 ${row.live ? '' : 't3-status-dot-paused'}`}
          />
          <span
            className={`t3-status-dot h-1 w-1 rounded-full bg-muted/40 [animation-delay:200ms] ${row.live ? '' : 't3-status-dot-paused'}`}
          />
          <span
            className={`t3-status-dot h-1 w-1 rounded-full bg-muted/40 [animation-delay:400ms] ${row.live ? '' : 't3-status-dot-paused'}`}
          />
        </span>
        <span className="shrink-0">
          {row.prefix}
          {row.createdAt ? (
            <>
              {' for '}
              <WorkingTimer createdAt={row.createdAt} />
            </>
          ) : (
            '…'
          )}
        </span>
        {row.stepLabel ? (
          <span className="min-w-0 truncate text-muted/70">· {row.stepLabel}</span>
        ) : null}
      </div>
    </div>
  )
}

function TurnFoldRow({
  onToggle,
  row
}: {
  onToggle: () => void
  row: Extract<T3MessagesTimelineRow, { kind: 'turn-fold' }>
}) {
  return (
    <div className="border-b border-border/70 pb-2 pt-1">
      <button
        aria-expanded={row.expanded}
        aria-label={row.expanded ? 'Hide work' : 'Show work'}
        className="flex cursor-pointer select-none items-center gap-1 rounded-md px-1 text-xs text-muted tabular-nums transition-colors hover:text-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-component/30"
        data-scroll-anchor-ignore="true"
        data-test-id="ai-turn-duration"
        onClick={onToggle}
        type="button"
      >
        <span>{row.label}</span>
        {row.expanded ? (
          <ChevronDown className="size-3.5" />
        ) : (
          <ChevronRight className="size-3.5" />
        )}
      </button>
    </div>
  )
}

function normalizeWorkingStepLabel(value?: string): string | undefined {
  const label = value
    ?.trim()
    .replace(/\s+·\s+\d+s$/u, '')
    .replace(/((?:…|\.\.\.))\s+\d+s$/u, '$1')
    .trim()
  if (!label || /^(?:running|working)(?:\.{3}|…)?$/iu.test(label)) return undefined
  return label
}

function focusedMediaKind(messages: readonly AiMessage[]): 'image' | 'video' | null {
  let media: 'image' | 'video' | null = null
  let otherTool = false
  for (const message of messages) {
    for (const part of message.parts ?? []) {
      if (part.type !== 'tool') continue
      if (!isMediaGenerationTool(part.name, part.input)) {
        otherTool = true
        continue
      }
      if (part.state !== 'pending' && part.state !== 'running') continue
      const next = isVideoGenerationTool(part.name, part.input) ? 'video' : 'image'
      if (media && media !== next) return null
      media = next
    }
  }
  return media && !otherTool ? media : null
}

function workingPrefix(mediaKind: 'image' | 'video' | null, needsInteraction: boolean): string {
  if (mediaKind) return `Creating ${mediaKind}`
  if (needsInteraction) return 'Needs attention'
  return 'Working'
}

function timelineRowClass(row: T3MessagesTimelineRow): string {
  if (row.kind === 'work' && row.isExpandedToolGroupEntry) return 'pb-0'
  if (
    row.kind === 'message' ||
    row.kind === 'work' ||
    row.kind === 'work-live' ||
    row.kind === 'work-toggle'
  ) {
    return 'pb-2'
  }
  return row.kind === 'working' ? '' : 'pb-4'
}

export default function T3MessagesTimeline(props: T3MessagesTimelineProps) {
  const [expandedTurn, setExpandedTurn] = useState(false)
  const [expandedWorkGroupIds, setExpandedWorkGroupIds] = useState<ReadonlySet<string>>(
    () => new Set()
  )
  const pendingAnchor = useRef<{
    anchor: HTMLButtonElement
    scroller: HTMLElement | null
    top: number
  } | null>(null)
  const stableRows = useRef<StableT3MessagesTimelineRowsState>({
    byId: new Map(),
    result: []
  })
  const busy = props.status === 'streaming' || props.status === 'submitted'
  const needsInteraction =
    props.status === 'needs_attention' &&
    props.messages.some((message) =>
      message.parts?.some((part) => part.type === 'tool' && part.state === 'approval')
    )
  const isWorking = busy || needsInteraction
  const mediaKind = focusedMediaKind(props.messages)
  const entries = useMemo(
    () => deriveT3TimelineEntries(props.messages, props.status),
    [props.messages, props.status]
  )
  const rawRows = useMemo(
    () =>
      deriveT3MessagesTimelineRows({
        endedAt: props.endedAt,
        expandedTurn,
        expandedWorkGroupIds,
        isWorking,
        startedAt: props.startedAt,
        status: props.status,
        timelineEntries: entries,
        workingLabel: mediaKind ? undefined : normalizeWorkingStepLabel(props.workingLabel),
        workingPrefix: workingPrefix(mediaKind, needsInteraction)
      }),
    [
      entries,
      expandedTurn,
      expandedWorkGroupIds,
      isWorking,
      mediaKind,
      needsInteraction,
      props.endedAt,
      props.startedAt,
      props.status,
      props.workingLabel
    ]
  )
  stableRows.current = computeStableT3MessagesTimelineRows(rawRows, stableRows.current)
  const rows = stableRows.current.result

  useLayoutEffect(() => {
    const pending = pendingAnchor.current
    pendingAnchor.current = null
    if (!pending || !pending.anchor.isConnected || !pending.scroller) return
    const movement = pending.anchor.getBoundingClientRect().top - pending.top
    if (movement) pending.scroller.scrollTop += movement
  }, [rows])

  const toggleWorkGroup = (groupId: string, anchor: HTMLButtonElement) => {
    pendingAnchor.current = {
      anchor,
      scroller: findNearestVerticalScroller(anchor),
      top: anchor.getBoundingClientRect().top
    }
    setExpandedWorkGroupIds((current) => {
      const next = new Set(current)
      if (next.has(groupId)) next.delete(groupId)
      else next.add(groupId)
      return next
    })
  }

  return (
    <div
      aria-live="off"
      className="my-1 flex min-w-0 flex-col font-sans"
      data-t3-source-revision="5d7665396083d285132d67038813862a93337ca5"
      data-test-id="ai-activity-disclosure"
    >
      {rows.length ? (
        <div className="flex min-h-0 flex-col" data-test-id="ai-activity-timeline">
          {rows.map((row) => {
            return (
              <div
                className={timelineRowClass(row)}
                data-timeline-row-id={row.id}
                data-timeline-row-kind={row.kind}
                key={row.id}
              >
                {row.kind === 'message' ? <NarrativeRow message={row.message} /> : null}
                {row.kind === 'work' ? <WorkRow row={row} /> : null}
                {row.kind === 'work-live' ? (
                  <LiveWorkRow onToggle={toggleWorkGroup} row={row} />
                ) : null}
                {row.kind === 'work-toggle' ? (
                  <WorkToggleRow onToggle={toggleWorkGroup} row={row} />
                ) : null}
                {row.kind === 'turn-fold' ? (
                  <TurnFoldRow onToggle={() => setExpandedTurn((value) => !value)} row={row} />
                ) : null}
                {row.kind === 'working' ? <WorkingRow row={row} /> : null}
              </div>
            )
          })}
        </div>
      ) : null}
    </div>
  )
}
