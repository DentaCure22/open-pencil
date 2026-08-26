import {
  Activity,
  ChevronDown,
  ChevronRight,
  ChevronsDownUp,
  ChevronsUpDown,
  Columns2,
  FileDiff,
  Files,
  Globe2,
  Layers3,
  Maximize2,
  MessageCircle,
  Minimize2,
  PanelRightClose,
  PackageOpen,
  Plus,
  Rows3,
  TerminalSquare,
  TextWrap,
  Trash2,
  X
} from 'lucide-react'
import {
  type CSSProperties,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState
} from 'react'

import type { AgentRightPanelSurface } from '@/app/agent-chat/right-panel'
import {
  readAgentRightPanelWidth,
  writeAgentRightPanelWidth
} from '@/app/agent-chat/right-panel-storage'
import { lockHorizontalResizeCursor } from '@/app/shell/horizontal-resize-lock'
import { IS_BROWSER } from '@/constants'

import {
  getT3RightPanelDefaultWidth,
  getT3RightPanelMaxWidth,
  normalizeT3DiffSelection,
  parseT3UnifiedPatch,
  T3_RIGHT_PANEL_BREAKPOINT,
  T3_RIGHT_PANEL_MIN_WIDTH,
  t3DiffRangeLabel,
  t3DiffSelectionQuote,
  type T3DiffLine,
  type T3DiffLineSelection,
  type T3DiffReviewComment,
  type T3ParsedDiffFile
} from './t3-right-panel.logic'
import T3BrowserSurface from './T3BrowserSurface'
import T3FilesSurface from './T3FilesSurface'
import T3TerminalSurface from './T3TerminalSurface'
import type { AiTurnChanges } from './types'

// Source-aligned with T3 Code's RightPanelTabs, PreviewPanelShell, DiffPanel,
// AnnotatableCodeView, and DiffCommentAnnotation at revision
// e67074f80933a27bd3cdc4e24f486358407690fb (MIT).

type DiffRenderMode = 'split' | 'stacked'
type RightPanelSurface = AgentRightPanelSurface

export interface T3RightPanelWorkspaceProps {
  changes: AiTurnChanges | null
  comments: T3DiffReviewComment[]
  activationNonce: number
  open: boolean
  requestedSurface: RightPanelSurface
  selectedPath?: string
  threadId: string
  onAddComment: (comment: Omit<T3DiffReviewComment, 'id'>) => void
  onClose: () => void
  onDeleteComment: (commentId: string) => void
  onSelectFile: (path: string) => void
  onSurfaceHostChange: (
    surface: 'activity' | 'assets' | 'layers',
    host: HTMLDivElement | null
  ) => void
  onSurfaceChange: (surface: RightPanelSurface) => void
}

function clampPanelWidth(width: number): number {
  if (!IS_BROWSER) return T3_RIGHT_PANEL_MIN_WIDTH
  return Math.min(
    Math.max(width, T3_RIGHT_PANEL_MIN_WIDTH),
    getT3RightPanelMaxWidth(window.innerWidth)
  )
}

function initialPanelWidth(): number {
  const fallback = IS_BROWSER
    ? getT3RightPanelDefaultWidth(window.innerWidth)
    : T3_RIGHT_PANEL_MIN_WIDTH
  return clampPanelWidth(readAgentRightPanelWidth(fallback))
}

function useT3PanelWidth() {
  const [width, setWidth] = useState(initialPanelWidth)
  const [resizing, setResizing] = useState(false)
  const [narrow, setNarrow] = useState(
    () => IS_BROWSER && window.innerWidth <= T3_RIGHT_PANEL_BREAKPOINT
  )
  const dragState = useRef<{
    frame: number | null
    originWidth: number
    originX: number
    pendingWidth: number
    pointerId: number
    releaseCursorLock: () => void
    target: HTMLElement
  } | null>(null)

  const releaseResize = useCallback((pointerId: number) => {
    const state = dragState.current
    if (!state || state.pointerId !== pointerId) return null
    dragState.current = null
    if (state.frame !== null) window.cancelAnimationFrame(state.frame)
    try {
      if (state.target.hasPointerCapture(pointerId)) state.target.releasePointerCapture(pointerId)
    } catch (error) {
      console.warn('[T3 right panel] Pointer capture was already released.', error)
    }
    state.releaseCursorLock()
    setResizing(false)
    return state
  }, [])

  useEffect(() => {
    const resize = () => {
      setNarrow(window.innerWidth <= T3_RIGHT_PANEL_BREAKPOINT)
      setWidth((current) => clampPanelWidth(current))
    }
    window.addEventListener('resize', resize)
    return () => window.removeEventListener('resize', resize)
  }, [])

  useEffect(
    () => () => {
      const state = dragState.current
      if (state) releaseResize(state.pointerId)
    },
    [releaseResize]
  )

  function beginResize(event: ReactPointerEvent<HTMLDivElement>) {
    if (narrow || event.button !== 0) return
    event.preventDefault()
    event.stopPropagation()
    const target = event.currentTarget
    try {
      target.setPointerCapture(event.pointerId)
    } catch {
      return
    }
    dragState.current = {
      frame: null,
      originWidth: width,
      originX: event.clientX,
      pendingWidth: width,
      pointerId: event.pointerId,
      releaseCursorLock: lockHorizontalResizeCursor(),
      target
    }
    setResizing(true)
  }

  function moveResize(event: ReactPointerEvent<HTMLDivElement>) {
    const state = dragState.current
    if (!state || state.pointerId !== event.pointerId) return
    event.preventDefault()
    state.pendingWidth = clampPanelWidth(state.originWidth + state.originX - event.clientX)
    if (state.frame !== null) return
    state.frame = window.requestAnimationFrame(() => {
      const active = dragState.current
      if (!active) return
      active.frame = null
      setWidth(active.pendingWidth)
    })
  }

  function endResize(event: ReactPointerEvent<HTMLDivElement>) {
    const state = dragState.current
    if (!state || state.pointerId !== event.pointerId) return
    const finalWidth = clampPanelWidth(state.originWidth + state.originX - event.clientX)
    state.pendingWidth = finalWidth
    releaseResize(event.pointerId)
    setWidth(finalWidth)
    writeAgentRightPanelWidth(finalWidth)
  }

  function cancelResize(event: ReactPointerEvent<HTMLDivElement>) {
    const state = dragState.current
    if (!state || state.pointerId !== event.pointerId) return
    const originWidth = state.originWidth
    releaseResize(event.pointerId)
    setWidth(originWidth)
  }

  const resizeHandlers = {
    onLostPointerCapture: cancelResize,
    onPointerCancel: cancelResize,
    onPointerDown: beginResize,
    onPointerMove: moveResize,
    onPointerUp: endResize
  }

  return { narrow, resizeHandlers, resizing, width }
}

function lineTone(kind: T3DiffLine['kind']): string {
  if (kind === 'addition') return 'bg-success/10 text-surface'
  if (kind === 'deletion') return 'bg-red-400/10 text-surface'
  if (kind === 'hunk') return 'bg-chrome-detail/45 text-muted'
  if (kind === 'meta') return 'text-muted/70'
  return 'text-surface/90'
}

function lineMarker(kind: T3DiffLine['kind']): string {
  if (kind === 'addition') return '+'
  if (kind === 'deletion') return '−'
  return ' '
}

function FileIcon({ status }: { status: T3ParsedDiffFile['status'] }) {
  let tone = 'text-muted'
  if (status === 'added' || status === 'copied') tone = 'text-success'
  else if (status === 'deleted') tone = 'text-red-400'
  return (
    <span className={tone}>
      <FileDiff className="size-3.5" strokeWidth={1.6} />
    </span>
  )
}

function DiffStats({ additions, deletions }: { additions: number; deletions: number }) {
  return (
    <span className="flex shrink-0 items-center gap-1.5 font-mono text-[10px] tabular-nums">
      {additions ? <span className="text-success">+{additions}</span> : null}
      {deletions ? <span className="text-red-400">−{deletions}</span> : null}
    </span>
  )
}

function CommentEditor(props: {
  rangeLabel: string
  onCancel: () => void
  onSubmit: (text: string) => void
}) {
  const [text, setText] = useState('')
  const trimmed = text.trim()
  return (
    <div
      className="border-border/30 bg-agent-surface px-3 py-2 font-sans"
      data-test-id="t3-diff-comment-editor"
      onPointerDown={(event) => event.stopPropagation()}
    >
      <textarea
        autoFocus
        value={text}
        aria-label={`Comment on ${props.rangeLabel}`}
        placeholder="Add a comment…"
        className="border-border/60 bg-chrome-control min-h-12 w-full resize-none rounded-[7px] border px-2.5 py-1.5 text-[12px] leading-5 text-surface outline-none transition-colors placeholder:text-muted/75 focus:border-border"
        onChange={(event) => setText(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.preventDefault()
            props.onCancel()
          }
          if (event.key === 'Enter' && (event.metaKey || event.ctrlKey) && trimmed) {
            event.preventDefault()
            props.onSubmit(trimmed)
          }
        }}
      />
      <div className="mt-1.5 flex items-center gap-1">
        <span className="mr-auto text-[10px] text-muted/70">⌘/Ctrl Enter to send</span>
        <button
          type="button"
          className="rounded-[6px] px-2 py-1 text-[11px] text-muted hover:bg-hover hover:text-surface"
          onClick={props.onCancel}
        >
          Cancel
        </button>
        <button
          type="button"
          disabled={!trimmed}
          className="bg-surface rounded-[6px] px-2 py-1 text-[11px] text-panel disabled:opacity-35"
          onClick={() => trimmed && props.onSubmit(trimmed)}
        >
          Comment
        </button>
      </div>
    </div>
  )
}

function SavedComment(props: { comment: T3DiffReviewComment; onDelete: () => void }) {
  return (
    <div
      className="border-accent/55 bg-accent/[0.045] group/comment flex min-w-0 items-start gap-2.5 border-l-2 px-3 py-2.5 font-sans text-surface"
      data-test-id="t3-diff-comment"
    >
      <MessageCircle className="mt-0.5 size-3.5 shrink-0 text-accent/70" aria-hidden="true" />
      <p className="min-w-0 flex-1 whitespace-pre-wrap text-[13px] leading-5">
        {props.comment.text}
      </p>
      <button
        type="button"
        aria-label="Delete comment"
        className="-my-1 -mr-1 flex size-6 shrink-0 items-center justify-center rounded-[5px] text-muted opacity-0 transition-opacity group-hover/comment:opacity-100 hover:bg-hover hover:text-surface focus-visible:opacity-100"
        onClick={props.onDelete}
      >
        <Trash2 className="size-3" />
      </button>
    </div>
  )
}

function UnifiedLine(props: {
  line: T3DiffLine
  selected: boolean
  selectionEnd: boolean
  onComment: () => void
  onSelect: (event: ReactMouseEvent) => void
  wordWrap: boolean
}) {
  return (
    <div
      className={`group/line relative grid min-h-[20px] grid-cols-[2.75rem_2.75rem_1.25rem_minmax(0,1fr)] items-stretch font-mono text-[11px] leading-5 ${lineTone(props.line.kind)} ${props.selected ? 'ring-accent/35 ring-1 ring-inset' : ''}`}
      data-diff-line-kind={props.line.kind}
    >
      <button
        type="button"
        className="contents text-left"
        onClick={props.onSelect}
        aria-label={`Select ${props.line.newLine ?? props.line.oldLine ?? 'diff'} line`}
      >
        <span className="border-border/20 border-r px-1.5 text-right text-muted/55 tabular-nums select-none">
          {props.line.oldLine ?? ''}
        </span>
        <span className="border-border/20 border-r px-1.5 text-right text-muted/55 tabular-nums select-none">
          {props.line.newLine ?? ''}
        </span>
        <span className="text-center text-muted/55 select-none">{lineMarker(props.line.kind)}</span>
        <code
          className={`min-w-0 px-1.5 ${props.wordWrap ? 'whitespace-pre-wrap break-words' : 'whitespace-pre'}`}
        >
          {props.line.content || ' '}
        </code>
      </button>
      {props.selectionEnd ? (
        <button
          type="button"
          aria-label="Comment on selected lines"
          className="bg-agent-surface border-border/70 absolute right-2 z-10 mt-0.5 flex size-5 items-center justify-center rounded-[5px] border text-muted shadow-sm hover:text-surface"
          onClick={(event) => {
            event.stopPropagation()
            props.onComment()
          }}
        >
          <MessageCircle className="size-3" />
        </button>
      ) : null}
    </div>
  )
}

function SplitLine(props: {
  line: T3DiffLine
  selected: boolean
  selectionEnd: boolean
  onComment: () => void
  onSelect: (event: ReactMouseEvent) => void
  wordWrap: boolean
}) {
  const oldContent = props.line.kind === 'addition' ? '' : props.line.content
  const newContent = props.line.kind === 'deletion' ? '' : props.line.content
  return (
    <div
      className={`group/line relative grid min-h-[20px] grid-cols-[2.75rem_minmax(0,1fr)_2.75rem_minmax(0,1fr)] items-stretch font-mono text-[11px] leading-5 ${lineTone(props.line.kind)} ${props.selected ? 'ring-accent/35 ring-1 ring-inset' : ''}`}
      data-diff-line-kind={props.line.kind}
    >
      <button type="button" className="contents text-left" onClick={props.onSelect}>
        <span className="border-border/20 border-r px-1.5 text-right text-muted/55 tabular-nums select-none">
          {props.line.oldLine ?? ''}
        </span>
        <code
          className={`border-border/30 min-w-0 border-r px-1.5 ${props.wordWrap ? 'whitespace-pre-wrap break-words' : 'whitespace-pre'}`}
        >
          {oldContent || ' '}
        </code>
        <span className="border-border/20 border-r px-1.5 text-right text-muted/55 tabular-nums select-none">
          {props.line.newLine ?? ''}
        </span>
        <code
          className={`min-w-0 px-1.5 ${props.wordWrap ? 'whitespace-pre-wrap break-words' : 'whitespace-pre'}`}
        >
          {newContent || ' '}
        </code>
      </button>
      {props.selectionEnd ? (
        <button
          type="button"
          aria-label="Comment on selected lines"
          className="bg-agent-surface border-border/70 absolute right-2 z-10 mt-0.5 flex size-5 items-center justify-center rounded-[5px] border text-muted shadow-sm hover:text-surface"
          onClick={(event) => {
            event.stopPropagation()
            props.onComment()
          }}
        >
          <MessageCircle className="size-3" />
        </button>
      ) : null}
    </div>
  )
}

function DiffFileView(props: {
  collapsed: boolean
  comments: T3DiffReviewComment[]
  file: T3ParsedDiffFile
  mode: DiffRenderMode
  selected: T3DiffLineSelection | null
  selectedPath?: string
  wordWrap: boolean
  onAddComment: (comment: Omit<T3DiffReviewComment, 'id'>) => void
  onDeleteComment: (commentId: string) => void
  onSelect: (selection: T3DiffLineSelection) => void
  onSelectFile: (path: string) => void
  onToggle: () => void
}) {
  const host = useRef<HTMLDivElement>(null)
  const [draftSelection, setDraftSelection] = useState<T3DiffLineSelection | null>(null)

  useEffect(() => {
    if (props.selectedPath === props.file.path) {
      host.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }
  }, [props.file.path, props.selectedPath])

  function selectLine(index: number, event: ReactMouseEvent) {
    const current = props.selected?.path === props.file.path ? props.selected : null
    const selection =
      event.shiftKey && current
        ? normalizeT3DiffSelection({ ...current, endIndex: index })
        : { endIndex: index, path: props.file.path, startIndex: index }
    setDraftSelection(null)
    props.onSelect(selection)
  }

  function submitComment(selection: T3DiffLineSelection, text: string) {
    props.onAddComment({
      capturedAt: '',
      ...normalizeT3DiffSelection(selection),
      quote: t3DiffSelectionQuote(props.file, selection),
      rangeLabel: t3DiffRangeLabel(props.file, selection),
      text
    })
    setDraftSelection(null)
  }

  return (
    <div
      ref={host}
      data-diff-file={props.file.path}
      className="border-border/50 border-b last:border-b-0"
    >
      <div
        className={`bg-agent-surface sticky top-0 z-[2] flex h-8 items-center gap-1.5 border-b px-2 pr-3 text-[11px] ${props.selectedPath === props.file.path ? 'border-accent/35' : 'border-border/45'}`}
        data-test-id="t3-diff-file-header"
      >
        <button
          type="button"
          className="flex size-5 shrink-0 items-center justify-center rounded-[5px] text-muted hover:bg-hover hover:text-surface"
          aria-label={props.collapsed ? `Expand ${props.file.path}` : `Collapse ${props.file.path}`}
          aria-expanded={!props.collapsed}
          onClick={props.onToggle}
        >
          {props.collapsed ? (
            <ChevronRight className="size-3.5" />
          ) : (
            <ChevronDown className="size-3.5" />
          )}
        </button>
        <FileIcon status={props.file.status} />
        <button
          type="button"
          title={props.file.path}
          className="min-w-0 flex-1 truncate text-left font-mono text-[11px] text-surface/90 hover:underline"
          onClick={() => props.onSelectFile(props.file.path)}
        >
          {props.file.path}
        </button>
        <DiffStats additions={props.file.additions} deletions={props.file.deletions} />
      </div>
      {!props.collapsed ? (
        props.file.lines.length ? (
          <div className="relative min-w-max" data-test-id="t3-diff-code-view">
            {props.file.lines.map((line, index) => {
              const selected =
                props.selected?.path === props.file.path &&
                index >= props.selected.startIndex &&
                index <= props.selected.endIndex
              const selectionEnd = selected && index === props.selected?.endIndex
              const Line = props.mode === 'split' ? SplitLine : UnifiedLine
              const lineComments = props.comments.filter((comment) => comment.endIndex === index)
              return (
                <div key={line.id} className="relative">
                  <Line
                    line={line}
                    selected={selected}
                    selectionEnd={selectionEnd && draftSelection === null}
                    wordWrap={props.wordWrap}
                    onSelect={(event) => selectLine(index, event)}
                    onComment={() => props.selected && setDraftSelection(props.selected)}
                  />
                  {draftSelection?.endIndex === index ? (
                    <CommentEditor
                      rangeLabel={t3DiffRangeLabel(props.file, draftSelection)}
                      onCancel={() => setDraftSelection(null)}
                      onSubmit={(text) => submitComment(draftSelection, text)}
                    />
                  ) : null}
                  {lineComments.map((comment) => (
                    <SavedComment
                      key={comment.id}
                      comment={comment}
                      onDelete={() => props.onDeleteComment(comment.id)}
                    />
                  ))}
                </div>
              )
            })}
          </div>
        ) : (
          <div className="px-3 py-4 text-center text-[11px] text-muted">Patch unavailable.</div>
        )
      ) : null}
    </div>
  )
}

type SurfaceAction = {
  icon: typeof Globe2
  kind: RightPanelSurface
  label: string
  shortcut: string
}

const DIFF_SURFACE_ACTION: SurfaceAction = {
  icon: FileDiff,
  kind: 'diff',
  label: 'Diff',
  shortcut: 'D'
}

const SURFACE_ACTIONS: SurfaceAction[] = [
  { icon: Layers3, kind: 'layers', label: 'Layers', shortcut: 'L' },
  { icon: PackageOpen, kind: 'assets', label: 'Assets', shortcut: 'A' },
  { icon: Activity, kind: 'activity', label: 'Activity', shortcut: 'V' },
  { icon: Globe2, kind: 'browser', label: 'Browser', shortcut: 'B' },
  { icon: TerminalSquare, kind: 'terminal', label: 'Terminal', shortcut: 'T' },
  { icon: Files, kind: 'files', label: 'Files', shortcut: 'F' },
  DIFF_SURFACE_ACTION
]

function surfaceAction(kind: RightPanelSurface) {
  return SURFACE_ACTIONS.find((action) => action.kind === kind) ?? DIFF_SURFACE_ACTION
}

function AddSurfaceMenu(props: {
  open: boolean
  onClose: () => void
  onSelect: (kind: RightPanelSurface) => void
}) {
  if (!props.open) return null
  return (
    <div
      className="border-border bg-agent-surface shadow-chrome-menu absolute top-8 left-1 z-20 min-w-44 rounded-[10px] border p-1.5"
      data-test-id="t3-right-panel-add-menu"
    >
      {SURFACE_ACTIONS.map((action) => {
        const Icon = action.icon
        return (
          <button
            key={action.label}
            type="button"
            className="flex h-8 w-full items-center gap-2 rounded-[7px] px-2 text-left text-[12px] text-surface hover:bg-hover"
            onClick={() => {
              props.onSelect(action.kind)
              props.onClose()
            }}
          >
            <Icon className="size-3.5" strokeWidth={1.6} />
            <span className="flex-1">{action.label}</span>
            <kbd className="text-[10px] text-muted">{action.shortcut}</kbd>
          </button>
        )
      })}
    </div>
  )
}

// oxlint-disable-next-line eslint/complexity -- This island coordinates T3's panel shell and mounted surface states.
export default function T3RightPanelWorkspace(props: T3RightPanelWorkspaceProps) {
  const { narrow, resizeHandlers, resizing, width } = useT3PanelWidth()
  const [maximized, setMaximized] = useState(false)
  const [addMenuOpen, setAddMenuOpen] = useState(false)
  const [mode, setMode] = useState<DiffRenderMode>('stacked')
  const [wordWrap, setWordWrap] = useState(false)
  const [collapsedPaths, setCollapsedPaths] = useState<ReadonlySet<string>>(new Set())
  const [selected, setSelected] = useState<T3DiffLineSelection | null>(null)
  const [surfaces, setSurfaces] = useState<RightPanelSurface[]>(['diff'])
  const [activeSurface, setActiveSurface] = useState<RightPanelSurface>('diff')
  const panel = useRef<HTMLElement>(null)
  const files = useMemo(
    () => props.changes?.files.map((file) => parseT3UnifiedPatch(file)) ?? [],
    [props.changes]
  )
  const allCollapsed = files.length > 0 && files.every((file) => collapsedPaths.has(file.path))

  function openSurface(kind: RightPanelSurface, notify = false) {
    setSurfaces((current) => {
      const requested: RightPanelSurface[] =
        kind === 'layers' || kind === 'assets' ? ['layers', 'assets'] : [kind]
      return requested.reduce<RightPanelSurface[]>(
        (next, surface) => (next.includes(surface) ? next : [...next, surface]),
        current
      )
    })
    setActiveSurface(kind)
    if (notify) props.onSurfaceChange(kind)
  }

  function closeSurface(kind: RightPanelSurface) {
    setSurfaces((current) => {
      const index = current.indexOf(kind)
      const next = current.filter((surface) => surface !== kind)
      if (activeSurface === kind && next.length) {
        const fallback = next[Math.min(index, next.length - 1)] ?? 'diff'
        setActiveSurface(fallback)
        props.onSurfaceChange(fallback)
      }
      if (!next.length) props.onClose()
      return next
    })
  }

  useEffect(() => {
    let nextSurfaces: RightPanelSurface[] = ['diff']
    if (props.requestedSurface === 'layers' || props.requestedSurface === 'assets') {
      nextSurfaces = ['diff', 'layers', 'assets']
    } else if (props.requestedSurface !== 'diff') {
      nextSurfaces = ['diff', props.requestedSurface]
    }
    setSurfaces(nextSurfaces)
    setActiveSurface(props.requestedSurface)
  }, [props.threadId])

  useEffect(() => {
    if (props.activationNonce > 0) openSurface(props.requestedSurface)
  }, [props.activationNonce])

  useEffect(() => {
    if (props.open && surfaces.length === 0) openSurface('diff')
  }, [props.open, surfaces.length])

  useEffect(() => {
    if (!props.open) setAddMenuOpen(false)
  }, [props.open])

  useEffect(() => {
    if (!props.open) return undefined
    const keydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        if (addMenuOpen) setAddMenuOpen(false)
        else props.onClose()
      }
    }
    window.addEventListener('keydown', keydown)
    return () => {
      window.removeEventListener('keydown', keydown)
    }
  }, [addMenuOpen, props.onClose])

  useEffect(() => {
    if (!addMenuOpen) return undefined
    const pointerDown = (event: PointerEvent) => {
      if (!panel.current?.contains(event.target as Node)) setAddMenuOpen(false)
    }
    window.addEventListener('pointerdown', pointerDown)
    return () => {
      window.removeEventListener('pointerdown', pointerDown)
    }
  }, [addMenuOpen])

  const panelStyle: CSSProperties = maximized
    ? { bottom: 12, left: 12, right: 12, top: 12 }
    : {
        bottom: 12,
        right: 12,
        top: 12,
        width: narrow ? 'min(88vw, 24rem)' : width
      }

  return (
    <div
      className={`fixed inset-0 z-[70] transition-colors duration-200 ${props.open && narrow ? 'pointer-events-auto bg-black/15' : 'pointer-events-none bg-transparent'}`}
      data-test-id="t3-right-panel-layer"
      data-t3-source-revision="e67074f80933a27bd3cdc4e24f486358407690fb"
      onMouseDown={(event) => {
        if (narrow && event.target === event.currentTarget) props.onClose()
      }}
    >
      {props.open && !narrow && !maximized ? (
        <div
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize right workspace"
          data-test-id="t3-right-panel-resize-handle"
          style={{
            backgroundColor: 'rgb(0 0 0 / 0.005)',
            bottom: 12,
            cursor: 'col-resize',
            right: width - 8,
            top: 12
          }}
          className="pointer-events-auto fixed z-[71] w-10 touch-none select-none"
          {...resizeHandlers}
        />
      ) : null}
      <aside
        ref={panel}
        aria-hidden={!props.open}
        data-test-id="t3-right-panel"
        data-state={props.open ? 'open' : 'closed'}
        data-resizing={resizing ? 'true' : 'false'}
        style={panelStyle}
        className={`border-chrome-border bg-sidebar shadow-chrome-panel pointer-events-auto fixed flex min-h-0 min-w-0 flex-col overflow-hidden rounded-[14px] border motion-reduce:transition-none ${resizing ? 'transition-none' : 'transition-[transform,opacity,width,left] duration-200 ease-[cubic-bezier(0.16,1,0.3,1)]'} ${props.open ? 'translate-x-0 opacity-100' : 'translate-x-[calc(100%+1rem)] opacity-0'} ${maximized ? 'max-w-none' : 'max-w-full'}`}
      >
        <div
          className="border-border/40 relative flex h-10 min-h-10 shrink-0 items-center gap-1 border-b px-2"
          data-right-panel-tabbar
        >
          {surfaces.map((surface) => {
            const action = surfaceAction(surface)
            const Icon = action.icon
            return (
              <div
                key={surface}
                className={`group/tab flex h-6 max-w-36 items-center gap-1 rounded-[6px] pr-1.5 pl-1 text-[12px] ${activeSurface === surface ? 'bg-chrome-control-active text-surface' : 'text-muted hover:bg-hover hover:text-surface'}`}
              >
                <button
                  type="button"
                  aria-label={`Close ${action.label}`}
                  className="group/tab-close flex size-4 shrink-0 items-center justify-center rounded-[4px] outline-none focus-visible:ring-1 focus-visible:ring-accent/25"
                  onClick={() => closeSurface(surface)}
                >
                  <Icon className="size-3 group-hover/tab-close:hidden" strokeWidth={1.7} />
                  <X className="hidden size-3 group-hover/tab-close:block" strokeWidth={1.7} />
                </button>
                <button
                  type="button"
                  className="min-w-0 truncate rounded-[3px] outline-none focus-visible:ring-1 focus-visible:ring-accent/25"
                  onClick={() => {
                    setActiveSurface(surface)
                    props.onSurfaceChange(surface)
                  }}
                >
                  {action.label}
                </button>
              </div>
            )
          })}
          <div className="relative">
            <button
              type="button"
              aria-label="Add panel surface"
              aria-expanded={addMenuOpen}
              className="flex size-6 items-center justify-center rounded-[6px] text-muted hover:bg-hover hover:text-surface"
              onClick={() => setAddMenuOpen((current) => !current)}
            >
              <Plus className="size-3.5" />
            </button>
            <AddSurfaceMenu
              open={addMenuOpen}
              onClose={() => setAddMenuOpen(false)}
              onSelect={(surface) => openSurface(surface, true)}
            />
          </div>
          <div className="ml-auto flex items-center gap-1">
            {!narrow ? (
              <button
                type="button"
                aria-label={maximized ? 'Restore diff panel' : 'Maximize diff panel'}
                className="flex size-7 items-center justify-center rounded-[6px] text-muted hover:bg-hover hover:text-surface"
                onClick={() => setMaximized((current) => !current)}
              >
                {maximized ? (
                  <Minimize2 className="size-3.5" />
                ) : (
                  <Maximize2 className="size-3.5" />
                )}
              </button>
            ) : null}
            <button
              type="button"
              aria-label="Close right panel"
              className="flex size-7 items-center justify-center rounded-[6px] text-muted hover:bg-hover hover:text-surface"
              onClick={props.onClose}
            >
              <PanelRightClose className="size-3.5" />
            </button>
          </div>
        </div>

        <div className={activeSurface === 'diff' ? 'contents' : 'hidden'}>
          <div
            className="border-border/60 bg-agent-surface flex h-10 min-h-10 shrink-0 items-center justify-between gap-2 border-b px-4"
            data-test-id="t3-diff-toolbar"
          >
            <button
              type="button"
              aria-label="Diff scope: Latest turn"
              className="bg-chrome-control-active inline-flex h-6 max-w-full items-center gap-1 rounded-[6px] px-2 text-[12px] font-medium text-surface"
            >
              <span className="truncate">Latest turn</span>
              <ChevronDown className="size-3.5 opacity-70" />
            </button>
            <div className="flex shrink-0 items-center gap-1">
              {props.changes ? (
                <DiffStats
                  additions={props.changes.additions}
                  deletions={props.changes.deletions}
                />
              ) : null}
              {files.length ? (
                <button
                  type="button"
                  aria-label={allCollapsed ? 'Expand all files' : 'Collapse all files'}
                  className="flex size-7 items-center justify-center rounded-[6px] text-muted hover:bg-hover hover:text-surface"
                  onClick={() =>
                    setCollapsedPaths(
                      allCollapsed ? new Set() : new Set(files.map((file) => file.path))
                    )
                  }
                >
                  {allCollapsed ? (
                    <ChevronsUpDown className="size-3.5" />
                  ) : (
                    <ChevronsDownUp className="size-3.5" />
                  )}
                </button>
              ) : null}
              <div className="bg-chrome-control flex items-center gap-0.5 rounded-[7px] p-0.5">
                <button
                  type="button"
                  aria-label="Unified diff view"
                  aria-pressed={mode === 'stacked'}
                  className={`flex size-6 items-center justify-center rounded-[5px] ${mode === 'stacked' ? 'bg-chrome-control-active text-surface shadow-sm' : 'text-muted hover:text-surface'}`}
                  onClick={() => setMode('stacked')}
                >
                  <Rows3 className="size-3.5" />
                </button>
                <button
                  type="button"
                  aria-label="Split diff view"
                  aria-pressed={mode === 'split'}
                  className={`flex size-6 items-center justify-center rounded-[5px] ${mode === 'split' ? 'bg-chrome-control-active text-surface shadow-sm' : 'text-muted hover:text-surface'}`}
                  onClick={() => setMode('split')}
                >
                  <Columns2 className="size-3.5" />
                </button>
              </div>
              <button
                type="button"
                aria-label={wordWrap ? 'Disable diff line wrapping' : 'Enable diff line wrapping'}
                aria-pressed={wordWrap}
                className={`flex size-7 items-center justify-center rounded-[6px] ${wordWrap ? 'bg-chrome-control-active text-surface' : 'text-muted hover:bg-hover hover:text-surface'}`}
                onClick={() => setWordWrap((current) => !current)}
              >
                <TextWrap className="size-3.5" />
              </button>
            </div>
          </div>

          <div className="scrollbar-panel min-h-0 flex-1 overflow-auto bg-agent-surface">
            {props.changes?.truncated ? (
              <p className="border-border/70 bg-chrome-detail/40 shrink-0 border-b px-3 py-1.5 text-[11px] text-muted">
                This diff was truncated because it exceeded the preview limit.
              </p>
            ) : null}
            {files.length ? (
              files.map((file) => (
                <DiffFileView
                  key={file.path}
                  file={file}
                  comments={props.comments.filter((comment) => comment.path === file.path)}
                  collapsed={collapsedPaths.has(file.path)}
                  mode={mode}
                  selected={selected}
                  selectedPath={props.selectedPath}
                  wordWrap={wordWrap}
                  onAddComment={(comment) =>
                    props.onAddComment({ ...comment, capturedAt: props.changes?.capturedAt ?? '' })
                  }
                  onDeleteComment={props.onDeleteComment}
                  onSelect={setSelected}
                  onSelectFile={props.onSelectFile}
                  onToggle={() =>
                    setCollapsedPaths((current) => {
                      const next = new Set(current)
                      if (next.has(file.path)) next.delete(file.path)
                      else next.add(file.path)
                      return next
                    })
                  }
                />
              ))
            ) : (
              <div className="flex h-full items-center justify-center px-3 py-2 text-[12px] text-muted">
                No patch available for this turn.
              </div>
            )}
          </div>
        </div>
        {surfaces.includes('browser') ? (
          <div className={activeSurface === 'browser' ? 'contents' : 'hidden'}>
            <T3BrowserSurface />
          </div>
        ) : null}
        {surfaces.includes('files') ? (
          <div className={activeSurface === 'files' ? 'contents' : 'hidden'}>
            <T3FilesSurface />
          </div>
        ) : null}
        {surfaces.includes('terminal') ? (
          <div className={activeSurface === 'terminal' ? 'contents' : 'hidden'}>
            <T3TerminalSurface active={props.open && activeSurface === 'terminal'} />
          </div>
        ) : null}
        {surfaces.includes('layers') ? (
          <div className={activeSurface === 'layers' ? 'contents' : 'hidden'}>
            <div
              ref={(host) => props.onSurfaceHostChange('layers', host)}
              className="flex min-h-0 flex-1 flex-col overflow-hidden"
              data-test-id="t3-right-panel-layers-host"
            />
          </div>
        ) : null}
        {surfaces.includes('assets') ? (
          <div className={activeSurface === 'assets' ? 'contents' : 'hidden'}>
            <div
              ref={(host) => props.onSurfaceHostChange('assets', host)}
              className="flex min-h-0 flex-1 flex-col overflow-hidden"
              data-test-id="t3-right-panel-assets-host"
            />
          </div>
        ) : null}
        {surfaces.includes('activity') ? (
          <div className={activeSurface === 'activity' ? 'contents' : 'hidden'}>
            <div
              ref={(host) => props.onSurfaceHostChange('activity', host)}
              className="flex min-h-0 flex-1 flex-col overflow-hidden"
              data-test-id="t3-right-panel-activity-host"
            />
          </div>
        ) : null}
      </aside>
    </div>
  )
}
