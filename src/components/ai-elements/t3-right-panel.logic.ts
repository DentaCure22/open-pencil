import type { AiFileChange } from './types'

// Adapted from T3 Code's rightPanelLayout, PreviewPanelShell, DiffPanel,
// AnnotatableCodeView, and reviewCommentContext at revision
// e67074f80933a27bd3cdc4e24f486358407690fb (MIT).

export const T3_RIGHT_PANEL_BREAKPOINT = 720
export const T3_RIGHT_PANEL_DEFAULT_WIDTH_FRACTION = 0.2
export const T3_RIGHT_PANEL_MIN_WIDTH = 160
export const T3_RIGHT_PANEL_MAX_WIDTH_FRACTION = 1 / 3
export const T3_RIGHT_PANEL_SIBLING_MIN_WIDTH = 360

export type T3DiffLineKind = 'addition' | 'context' | 'deletion' | 'hunk' | 'meta'

export type T3DiffLine = {
  content: string
  id: string
  kind: T3DiffLineKind
  newLine: number | null
  oldLine: number | null
  raw: string
}

export type T3ParsedDiffFile = {
  additions: number
  deletions: number
  lines: T3DiffLine[]
  path: string
  previousPath?: string
  status: AiFileChange['status']
}

export type T3DiffLineSelection = {
  endIndex: number
  path: string
  startIndex: number
}

export type T3DiffReviewComment = T3DiffLineSelection & {
  capturedAt: string
  id: string
  quote: string
  rangeLabel: string
  text: string
}

const HUNK_HEADER = /^@@\s+-(\d+)(?:,(\d+))?\s+\+(\d+)(?:,(\d+))?\s+@@/
const DIFF_ANNOTATION_PREFIX = 'diff-review'

function patchLineKind(raw: string): T3DiffLineKind {
  if (raw.startsWith('@@')) return 'hunk'
  if (raw.startsWith('+') && !raw.startsWith('+++')) return 'addition'
  if (raw.startsWith('-') && !raw.startsWith('---')) return 'deletion'
  if (raw.startsWith(' ')) return 'context'
  return 'meta'
}

function visiblePatchContent(raw: string, kind: T3DiffLineKind): string {
  return kind === 'addition' || kind === 'deletion' || kind === 'context' ? raw.slice(1) : raw
}

export function parseT3UnifiedPatch(file: AiFileChange): T3ParsedDiffFile {
  const lines: T3DiffLine[] = []
  let oldLine = 0
  let newLine = 0
  let hunkReady = false

  for (const [index, raw] of (file.patch ?? '').replace(/\r\n?/g, '\n').split('\n').entries()) {
    if (
      raw.startsWith('diff --git ') ||
      raw.startsWith('index ') ||
      raw.startsWith('--- ') ||
      raw.startsWith('+++ ')
    ) {
      continue
    }

    const kind = patchLineKind(raw)
    if (kind === 'hunk') {
      const match = HUNK_HEADER.exec(raw)
      if (match) {
        oldLine = Number.parseInt(match[1] ?? '0', 10)
        newLine = Number.parseInt(match[3] ?? '0', 10)
        hunkReady = true
      }
      lines.push({
        content: raw,
        id: `${file.path}:${String(index)}`,
        kind,
        newLine: null,
        oldLine: null,
        raw
      })
      continue
    }

    if (!hunkReady && kind !== 'meta') continue

    const currentOldLine = kind === 'addition' || kind === 'meta' ? null : oldLine
    const currentNewLine = kind === 'deletion' || kind === 'meta' ? null : newLine
    lines.push({
      content: visiblePatchContent(raw, kind),
      id: `${file.path}:${String(index)}`,
      kind,
      newLine: currentNewLine,
      oldLine: currentOldLine,
      raw
    })
    if (kind === 'context' || kind === 'deletion') oldLine += 1
    if (kind === 'context' || kind === 'addition') newLine += 1
  }

  return {
    additions: file.additions,
    deletions: file.deletions,
    lines,
    path: file.path,
    ...(file.previousPath ? { previousPath: file.previousPath } : {}),
    status: file.status
  }
}

export function normalizeT3DiffSelection(selection: T3DiffLineSelection): T3DiffLineSelection {
  return selection.startIndex <= selection.endIndex
    ? selection
    : { ...selection, endIndex: selection.startIndex, startIndex: selection.endIndex }
}

export function t3DiffRangeLabel(file: T3ParsedDiffFile, selection: T3DiffLineSelection): string {
  const normalized = normalizeT3DiffSelection(selection)
  const lineNumbers = file.lines
    .slice(normalized.startIndex, normalized.endIndex + 1)
    .map((line) => line.newLine ?? line.oldLine)
    .filter((line): line is number => line !== null)
  const start = lineNumbers[0]
  const end = lineNumbers.at(-1)
  if (start === undefined || end === undefined) return 'selected lines'
  return start === end ? `line ${String(start)}` : `lines ${String(start)}–${String(end)}`
}

export function t3DiffSelectionQuote(
  file: T3ParsedDiffFile,
  selection: T3DiffLineSelection
): string {
  const normalized = normalizeT3DiffSelection(selection)
  const code = file.lines
    .slice(normalized.startIndex, normalized.endIndex + 1)
    .map((line) => line.raw)
    .join('\n')
  return [`File: ${file.path}`, t3DiffRangeLabel(file, normalized), code].filter(Boolean).join('\n')
}

export function t3DiffAnnotationSourceId(input: {
  capturedAt: string
  endIndex: number
  path: string
  startIndex: number
}): string {
  return [
    DIFF_ANNOTATION_PREFIX,
    encodeURIComponent(input.capturedAt),
    encodeURIComponent(input.path),
    String(input.startIndex),
    String(input.endIndex)
  ].join(':')
}

export function parseT3DiffAnnotationSourceId(
  sourceMessageId: string
): Omit<T3DiffReviewComment, 'id' | 'quote' | 'rangeLabel' | 'text'> | null {
  const [prefix, capturedAt, path, rawStart, rawEnd, ...extra] = sourceMessageId.split(':')
  if (
    prefix !== DIFF_ANNOTATION_PREFIX ||
    !capturedAt ||
    !path ||
    rawStart === undefined ||
    rawEnd === undefined ||
    extra.length
  ) {
    return null
  }
  const startIndex = Number.parseInt(rawStart, 10)
  const endIndex = Number.parseInt(rawEnd, 10)
  if (!Number.isInteger(startIndex) || !Number.isInteger(endIndex)) return null
  try {
    return {
      capturedAt: decodeURIComponent(capturedAt),
      endIndex,
      path: decodeURIComponent(path),
      startIndex
    }
  } catch {
    return null
  }
}

export function getT3RightPanelMaxWidth(viewportWidth: number, containerWidth = viewportWidth) {
  const fractionCap = Math.floor(viewportWidth * T3_RIGHT_PANEL_MAX_WIDTH_FRACTION)
  const containerCap = Math.floor(containerWidth) - T3_RIGHT_PANEL_SIBLING_MIN_WIDTH
  return Math.max(T3_RIGHT_PANEL_MIN_WIDTH, Math.min(fractionCap, containerCap))
}

export function getT3RightPanelDefaultWidth(viewportWidth: number, containerWidth = viewportWidth) {
  return Math.max(
    T3_RIGHT_PANEL_MIN_WIDTH,
    Math.min(
      Math.floor(viewportWidth * T3_RIGHT_PANEL_DEFAULT_WIDTH_FRACTION),
      getT3RightPanelMaxWidth(viewportWidth, containerWidth)
    )
  )
}
