import type { NarratedTraceActivityItem } from './history'
import type { NarratedTraceTarget } from './types'

function sourceParts(target: NarratedTraceTarget) {
  const source = target.source
  if (!source) return []
  const fileName = source.filePath?.split(/[\\/]/).at(-1)
  const location = fileName
    ? `${fileName}${source.lineNumber ? `:${String(source.lineNumber)}` : ''}`
    : ''
  return [source.componentName, location].filter(
    (part): part is string => typeof part === 'string' && part.length > 0
  )
}

function hierarchyLabel(target: NarratedTraceTarget) {
  const labels = target.hierarchy
    ? [target.hierarchy.parent?.label, target.hierarchy.current.label]
    : target.path.slice(-3)
  return labels
    .filter((label): label is string => typeof label === 'string' && label.length > 0)
    .filter((label, index, values) => label !== values[index - 1])
    .join(' > ')
}

export function narratedTraceActivityMetadata(item: NarratedTraceActivityItem) {
  if (item.event.kind === 'transcript') return `Turn ${item.event.id}`
  const target = item.event.target
  if (!target) return item.scope?.pageName ?? item.scope?.pageId ?? ''
  const details = [...sourceParts(target), hierarchyLabel(target), target.route].filter(
    (detail): detail is string => typeof detail === 'string' && detail.length > 0
  )
  return [...new Set(details)].join(' · ')
}
