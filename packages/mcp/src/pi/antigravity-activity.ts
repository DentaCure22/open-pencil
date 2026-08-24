import { readFileSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { imagePreviewFromPath } from './image-preview'

const MAX_RESOLVED_OUTPUT = 12_000
const MAX_OFFLOAD_FILE_BYTES = 2 * 1024 * 1024
const OFFLOAD_NOTICE =
  /(?:output was large and was saved to|saved to:|Resource offloaded to)\s+(file:\/\/[^\s\]\r\n]+|[^\s\]\r\n]+)/i

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
  if (typeof args?.describe === 'string' && args.describe.trim()) return 'connected_app_search'
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

function offloadPath(output: string): string {
  const raw = OFFLOAD_NOTICE.exec(output)?.[1]?.trim() ?? ''
  if (!raw) return ''
  if (raw.startsWith('file://')) return localResourcePath(raw)
  return raw
}

function readCappedText(path: string): string {
  try {
    const size = statSync(path).size
    if (size <= 0 || size > MAX_OFFLOAD_FILE_BYTES) return ''
    const bytes = readFileSync(path)
    if (bytes.includes(0)) return ''
    const text = bytes.toString('utf8').trim()
    if (!text) return ''
    return text.length <= MAX_RESOLVED_OUTPUT
      ? text
      : `${text.slice(0, MAX_RESOLVED_OUTPUT - 1).trimEnd()}…`
  } catch {
    return ''
  }
}

export function antigravityResolvedOutput(name: string, output: string): string {
  const trimmed = output.trim()
  if (!trimmed || isAntigravityImageTool(name)) return trimmed
  const path = offloadPath(trimmed)
  if (!path) return trimmed
  const loaded = readCappedText(path)
  if (!loaded) return trimmed
  if (trimmed.length <= 800) return loaded
  const preface = trimmed.split(/\r?\n\[Resource offloaded to /, 1)[0]?.trim() ?? trimmed
  return `${preface}\n\n${loaded}`.trim()
}

function antigravityActivityPattern(): RegExp {
  return /\[agy (edit|tool): ([^\]\r\n]+)\](?:\r?\n\[agy input\]\r?\n([\s\S]*?)\r?\n\[\/agy input\])?(?:\r?\n\[agy output\]\r?\n([\s\S]*?)\r?\n\[\/agy output\])?/g
}

export function pendingAntigravityOutput(value?: string): boolean {
  return !value || /^Step is still running\.?$/i.test(value.trim())
}

export function antigravityThoughtText(value: unknown): string {
  if (typeof value !== 'string') return ''
  let text = value.replace(antigravityActivityPattern(), '\n')
  const incomplete = text.indexOf('[agy')
  if (incomplete !== -1) text = text.slice(0, incomplete)
  const thought = text.replace(/\n{3,}/g, '\n\n').trim()
  return !thought || ['thinking', 'thought'].includes(thought.toLowerCase()) ? '' : thought
}

function antigravityActivityName(activity: AntigravityActivity): string {
  return activity.type === 'edit' ? activity.description : activity.name
}

function canUpgradeAntigravityActivity(
  previous: AntigravityActivity,
  next: AntigravityActivity
): boolean {
  if (previous.type !== next.type) return false
  if (antigravityActivityName(previous) !== antigravityActivityName(next)) return false
  if (previous.input && next.input && previous.input !== next.input) return false
  if (!pendingAntigravityOutput(previous.output) && pendingAntigravityOutput(next.output)) {
    return false
  }
  return Boolean(next.input && !previous.input) || !pendingAntigravityOutput(next.output)
}

export function antigravityActivities(
  value: unknown,
  safeActivityText: (value: unknown) => string
): AntigravityActivity[] {
  if (typeof value !== 'string') return []
  const activities: AntigravityActivity[] = []
  for (const match of value.matchAll(antigravityActivityPattern())) {
    const label = match[2]?.trim()
    if (!label) continue
    const input = safeActivityText(match[3])
    const name = match[1] === 'edit' ? 'edit' : antigravityToolName(label, input)
    const output = antigravityResolvedOutput(name, safeActivityText(match[4]))
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
            name,
            ...(output ? { output } : {}),
            type: 'tool'
          }
    const previous = activities.at(-1)
    if (previous && canUpgradeAntigravityActivity(previous, activity)) {
      activities[activities.length - 1] = activity
    } else {
      activities.push(activity)
    }
  }
  return activities
}
