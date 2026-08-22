import type { AgentPromptAnnotation } from './models'

const MAX_ANNOTATION_QUOTE_LENGTH = 12_000
const MAX_ANNOTATION_COMMENT_LENGTH = 4_000

function quoteAnnotationText(value: string): string {
  return value
    .replace(/\r\n?/g, '\n')
    .trim()
    .slice(0, MAX_ANNOTATION_QUOTE_LENGTH)
    .split('\n')
    .map((line) => `> ${line}`.trimEnd())
    .join('\n')
}

export function promptWithAnnotations(
  message: string,
  annotations: readonly AgentPromptAnnotation[]
): string {
  const prompt = message.trim()
  if (!annotations.length) return prompt
  const entries = annotations.flatMap((annotation, index) => {
    const quote = quoteAnnotationText(annotation.quote)
    if (!quote) return []
    const comment = annotation.comment.trim().slice(0, MAX_ANNOTATION_COMMENT_LENGTH)
    return [
      [`Annotation ${String(index + 1)}:`, quote, ...(comment ? [`Comment: ${comment}`] : [])].join(
        '\n'
      )
    ]
  })
  if (!entries.length) return prompt
  return [prompt, 'Annotations:', entries.join('\n\n')].filter(Boolean).join('\n\n')
}
