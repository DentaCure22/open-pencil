import { fileURLToPath } from 'node:url'

import { imagePreviewFromPath } from './image-preview'

type AntigravityActivityDetail = { input?: string; output?: string }

export type AntigravityActivity =
  | ({ description: string; type: 'edit' } & AntigravityActivityDetail)
  | ({ name: string; type: 'tool' } & AntigravityActivityDetail)

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function parsedAntigravityInput(value: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(value)
    return isRecord(parsed) ? parsed : null
  } catch {
    return null
  }
}

function antigravityToolName(label: string, input: string): string {
  const parsed = parsedAntigravityInput(input)
  const bridgedName = parsed && typeof parsed.ToolName === 'string' ? parsed.ToolName.trim() : ''
  if (!bridgedName) return label
  if (bridgedName !== 'mcp') return bridgedName

  const args = isRecord(parsed?.Arguments) ? parsed.Arguments : null
  if (typeof args?.tool === 'string' && args.tool.trim()) return args.tool.trim()
  if (typeof args?.search === 'string' && args.search.trim()) return 'connected_app_search'
  return bridgedName
}

function isAntigravityImageTool(name: string): boolean {
  const normalized = name.trim().replaceAll('_', ' ').toLowerCase()
  return (
    normalized.includes('generate image') ||
    normalized.includes('image generation') ||
    normalized.includes('edit image') ||
    normalized === 'imagegen'
  )
}

function imagePathFromValue(value: unknown): string {
  return isRecord(value) && typeof value.path === 'string' ? value.path.trim() : ''
}

function jsonImagePaths(value: string): string[] {
  try {
    const parsed: unknown = JSON.parse(value)
    if (!isRecord(parsed)) return []
    const result = isRecord(parsed.result) ? parsed.result : parsed
    const paths = Array.isArray(result.images)
      ? result.images.map(imagePathFromValue).filter(Boolean)
      : []
    if (typeof result.path === 'string' && result.path.trim()) paths.push(result.path.trim())
    return [...new Set(paths)]
  } catch {
    return []
  }
}

function localResourcePath(value: string): string {
  try {
    return fileURLToPath(value)
  } catch {
    return ''
  }
}

function antigravityImagePaths(output: string): string[] {
  const resultText = output.split(/\r?\n\[Resource offloaded to /, 1)[0]?.trim() ?? ''
  const paths = jsonImagePaths(resultText)
  const savedPath = /\bsaved at\s+([^\r\n]+?\.(?:gif|jpe?g|png|webp))\b/i.exec(output)?.[1]
  if (savedPath) paths.push(savedPath.trim())
  if (!paths.length) {
    const resourceUrl = /\[Resource offloaded to (file:\/\/[^\]\r\n]+)\]/i.exec(output)?.[1]
    if (resourceUrl) {
      const resourcePath = localResourcePath(resourceUrl)
      if (resourcePath) paths.push(resourcePath)
    }
  }
  return [...new Set(paths)]
}

export function antigravityToolImages(
  name: string,
  output: string
): Array<{ alt: string; url: string }> {
  if (!isAntigravityImageTool(name) || !output) return []
  return antigravityImagePaths(output).flatMap((path) => {
    const preview = imagePreviewFromPath(path, `${name} image`)
    return preview ? [preview] : []
  })
}

export function pendingAntigravityOutput(value?: string): boolean {
  return !value || /^Step is still running\.?$/i.test(value.trim())
}

function sameAntigravityActivity(first: AntigravityActivity, second: AntigravityActivity): boolean {
  if (first.type !== second.type || first.input !== second.input) return false
  if (first.type === 'edit' && second.type === 'edit') {
    return first.description === second.description
  }
  return first.type === 'tool' && second.type === 'tool' && first.name === second.name
}

export function antigravityActivities(
  value: unknown,
  safeActivityText: (value: unknown) => string
): AntigravityActivity[] {
  if (typeof value !== 'string') return []
  const activities: AntigravityActivity[] = []
  const pattern =
    /\[agy (edit|tool): ([^\]\r\n]+)\](?:\r?\n\[agy input\]\r?\n([\s\S]*?)\r?\n\[\/agy input\])?(?:\r?\n\[agy output\]\r?\n([\s\S]*?)\r?\n\[\/agy output\])?/g
  for (const match of value.matchAll(pattern)) {
    const label = match[2]?.trim()
    if (!label) continue
    const input = safeActivityText(match[3])
    const output = safeActivityText(match[4])
    const activity: AntigravityActivity =
      match[1] === 'edit'
        ? {
            description: label,
            ...(input ? { input } : {}),
            ...(output ? { output } : {}),
            type: 'edit'
          }
        : {
            ...(input ? { input } : {}),
            name: antigravityToolName(label, input),
            ...(output ? { output } : {}),
            type: 'tool'
          }
    const previous = activities.at(-1)
    if (
      previous &&
      sameAntigravityActivity(previous, activity) &&
      pendingAntigravityOutput(previous.output) &&
      !pendingAntigravityOutput(activity.output)
    ) {
      activities[activities.length - 1] = activity
    } else {
      activities.push(activity)
    }
  }
  return activities
}
