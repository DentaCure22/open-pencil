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
  type KeyboardEvent
} from 'react'

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
  computeStableT3MessagesTimelineRows,
  deriveT3MessagesTimelineRows,
  deriveT3TimelineEntries,
  type StableT3MessagesTimelineRowsState,
  type T3MessagesTimelineRow,
  type T3TimelineWorkEntry
} from './t3-messages-timeline.logic'
import { T3NarrativeRow as NarrativeRow } from './T3NarrativeRow'
import { ChevronDown, ChevronRight, ToolIcon, XMark } from './T3TimelineIcons'
import type { AiConversationStatus, AiMessage } from './types'

export interface T3MessagesTimelineProps {
  endedAt?: string
  hasVisibleContent?: boolean
  messages: AiMessage[]
  startedAt?: string
  status: AiConversationStatus
  workingLabel?: string
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
  let iconTone = 'text-muted'
  if (state === 'error') iconTone = 'text-red-400'
  else if (state === 'approval') iconTone = 'text-amber-400'

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
        <span className={`flex size-6 shrink-0 items-center justify-center ${iconTone}`}>
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
