import { composeDirectedWorkPrompt } from '@/app/agent-chat/directed-work-prompt'

import { contextCommentAnnotationAnchorLines } from './anchor-format'
import { contextCommentTargetLines } from './selection-brief'
import type { ContextCommentDraft } from './types'

function formatPercent(value: number) {
  return `${String(Math.round(value * 1_000) / 10)}%`
}

function formatCoordinate(value: number) {
  return String(Math.round(value * 10) / 10)
}

function compactComment(value: string) {
  return value.replaceAll(/\s+/g, ' ').trim().slice(0, 4_000)
}

export function contextCommentImageInstructions(draft: ContextCommentDraft) {
  const annotations = draft.annotations.flatMap((annotation) => {
    const comment = compactComment(annotation.comment)
    return comment ? [{ ...annotation, comment }] : []
  })
  const additionalInstructions = draft.text.trim()
  const captureContext = draft.captureContext
  const boardContextLines = captureContext
    ? [
        '',
        'Board context:',
        `Crop (page space): x ${formatCoordinate(captureContext.boardBounds.x)}, y ${formatCoordinate(captureContext.boardBounds.y)}, width ${formatCoordinate(captureContext.boardBounds.width)}, height ${formatCoordinate(captureContext.boardBounds.height)}`,
        `Viewport: panX ${formatCoordinate(captureContext.viewport.panX)}, panY ${formatCoordinate(captureContext.viewport.panY)}, zoom ${formatCoordinate(captureContext.viewport.zoom)}`,
        ...(annotations.length
          ? [
              'Comment points (page space):',
              ...annotations.map(
                (annotation, index) =>
                  `${String(index + 1)}. (x: ${formatCoordinate(captureContext.boardBounds.x + annotation.x * captureContext.boardBounds.width)}, y: ${formatCoordinate(captureContext.boardBounds.y + annotation.y * captureContext.boardBounds.height)})`
              )
            ]
          : [])
      ]
    : []
  return [
    'Image 1:',
    ...(annotations.length
      ? annotations.flatMap((annotation, index) => [
          `${String(index + 1)}. (x: ${formatPercent(annotation.x)}, y: ${formatPercent(annotation.y)}) ${annotation.comment}`,
          ...(annotation.anchor
            ? contextCommentAnnotationAnchorLines(annotation.anchor).map((line) => `   ${line}`)
            : [])
        ])
      : ['No comments.']),
    '',
    'Additional instructions:',
    additionalInstructions || 'None.',
    ...boardContextLines
  ].join('\n')
}

export function contextCommentPrompt(draft: ContextCommentDraft) {
  if (draft.imageEdit || draft.destination?.kind === 'agent-conversation') {
    return [
      'Edit the attached image using the image editing tool.',
      'Apply the numbered comments and additional instructions exactly.',
      ...(draft.capture?.sourceHasTransparency
        ? [
            'The source image has a transparent background. Preserve its alpha channel and keep the background transparent. Do not flatten it onto white, black, or any solid color unless the user explicitly asks.'
          ]
        : []),
      'Return the edited image in this conversation.',
      '',
      contextCommentImageInstructions(draft)
    ].join('\n')
  }
  return composeDirectedWorkPrompt({
    exactWords: draft.capture ? contextCommentImageInstructions(draft) : draft.text.trim(),
    namedTargetLines: draft.target ? contextCommentTargetLines(draft.target) : []
  })
}
