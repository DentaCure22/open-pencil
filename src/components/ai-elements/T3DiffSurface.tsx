import {
  ChevronDown,
  ChevronRight,
  ChevronsDownUp,
  ChevronsUpDown,
  Columns2,
  FileDiff,
  MessageCircle,
  Rows3,
  TextWrap,
  Trash2
} from 'lucide-react'
import { type MouseEvent as ReactMouseEvent, useEffect, useMemo, useRef, useState } from 'react'

import {
  normalizeT3DiffSelection,
  parseT3UnifiedPatch,
  t3DiffRangeLabel,
  t3DiffSelectionQuote,
  type T3DiffLine,
  type T3DiffLineSelection,
  type T3DiffReviewComment,
  type T3ParsedDiffFile
} from './t3-right-panel.logic'
import type { AiTurnChanges } from './types'

type DiffRenderMode = 'split' | 'stacked'

export interface T3DiffSurfaceProps {
  changes: AiTurnChanges | null
  comments: T3DiffReviewComment[]
  selectedPath?: string
  onAddComment: (comment: Omit<T3DiffReviewComment, 'id'>) => void
  onDeleteComment: (commentId: string) => void
  onSelectFile: (path: string) => void
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

export default function T3DiffSurface(props: T3DiffSurfaceProps) {
  const [mode, setMode] = useState<DiffRenderMode>('stacked')
  const [wordWrap, setWordWrap] = useState(false)
  const [collapsedPaths, setCollapsedPaths] = useState<ReadonlySet<string>>(new Set())
  const [selected, setSelected] = useState<T3DiffLineSelection | null>(null)
  const files = useMemo(
    () => props.changes?.files.map((file) => parseT3UnifiedPatch(file)) ?? [],
    [props.changes]
  )
  const selectedFile = props.selectedPath
    ? files.find((file) => file.path === props.selectedPath)
    : undefined
  const displayedFiles = selectedFile ? [selectedFile] : files
  const allCollapsed =
    displayedFiles.length > 0 && displayedFiles.every((file) => collapsedPaths.has(file.path))

  return (
    <>
      <div
        className="border-border/60 bg-agent-surface flex h-10 min-h-10 shrink-0 items-center justify-between gap-2 border-b px-4"
        data-test-id="t3-diff-toolbar"
      >
        <button
          type="button"
          aria-label="Diff scope: Latest turn"
          className="bg-chrome-control-active inline-flex h-6 max-w-full items-center gap-1 rounded-[6px] px-2 text-[12px] font-medium text-surface"
        >
          <span className="truncate">{selectedFile?.path ?? 'Latest turn'}</span>
          <ChevronDown className="size-3.5 opacity-70" />
        </button>
        <div className="flex shrink-0 items-center gap-1">
          {props.changes ? (
            <DiffStats additions={props.changes.additions} deletions={props.changes.deletions} />
          ) : null}
          {files.length ? (
            <button
              type="button"
              aria-label={allCollapsed ? 'Expand all files' : 'Collapse all files'}
              className="flex size-7 items-center justify-center rounded-[6px] text-muted hover:bg-hover hover:text-surface"
              onClick={() =>
                setCollapsedPaths(
                  allCollapsed ? new Set() : new Set(displayedFiles.map((file) => file.path))
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
        {displayedFiles.length ? (
          displayedFiles.map((file) => (
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
    </>
  )
}
