import { readFile } from 'node:fs/promises'

import type { AgentReasoningEffort } from '#mcp/agent-models/catalog'

export type PiLaunchMode = 'fork' | 'new' | 'resume'

export type PiRpcArgumentsInput = {
  effort: string
  mcpConfigPath?: string
  mode: PiLaunchMode
  model: string
  sessionDir?: string
  sessionId: string
  sourceSessionId?: string
}

const PI_THINKING = new Set(['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'])
const MAX_INPUT_IMAGE_BYTES = 10 * 1024 * 1024
const MAX_TOTAL_INPUT_IMAGE_BYTES = 25 * 1024 * 1024
const MAX_INPUT_IMAGES = 10

export type PiPromptInput = {
  images?: Array<{ data: string; mimeType: string; type: 'image' }>
  message: string
}

function imageMimeType(filePath: string): string | null {
  const extension = /\.([^./]+)$/.exec(filePath)?.[1]?.toLowerCase()
  if (extension === 'png') return 'image/png'
  if (extension === 'jpg' || extension === 'jpeg') return 'image/jpeg'
  if (extension === 'webp') return 'image/webp'
  if (extension === 'gif') return 'image/gif'
  return null
}

export function parsePiModelId(modelId: string): { model: string; provider: string } {
  const slash = modelId.indexOf('/')
  const model = slash <= 0 ? modelId : modelId.slice(slash + 1)
  const provider = slash <= 0 ? 'xai-auth' : modelId.slice(0, slash)
  return {
    model,
    provider: provider === 'xai' ? 'xai-auth' : provider
  }
}

export function piThinkingLevel(effort: string): AgentReasoningEffort | 'off' | 'minimal' {
  if (PI_THINKING.has(effort)) return effort as AgentReasoningEffort | 'off' | 'minimal'
  return 'high'
}

export function piRpcArguments(input: PiRpcArgumentsInput): string[] {
  const { model, provider } = parsePiModelId(input.model)
  const args = [
    '--mode',
    'rpc',
    '--provider',
    provider,
    '--model',
    model,
    '--thinking',
    piThinkingLevel(input.effort),
    '--approve',
    '--session-id',
    input.sessionId
  ]
  if (input.sessionDir) args.push('--session-dir', input.sessionDir)
  if (input.mcpConfigPath) args.push('--mcp-config', input.mcpConfigPath)
  if (input.mode === 'fork' && input.sourceSessionId) {
    args.push('--fork', input.sourceSessionId)
  }
  return args
}

export function piPromptWithEvidence(prompt: string, evidencePath?: string): string {
  if (!evidencePath) return prompt
  return `${prompt}\n\nVisual evidence is attached at ${evidencePath}. Read that image if the task needs what the user pointed at.`
}

export async function piPromptInputWithEvidence(
  prompt: string,
  evidencePath?: string,
  imagePaths: readonly string[] = []
): Promise<PiPromptInput> {
  const message = piPromptWithEvidence(prompt, evidencePath)
  const paths = [...new Set([...(evidencePath ? [evidencePath] : []), ...imagePaths])].slice(
    0,
    MAX_INPUT_IMAGES
  )
  const images: NonNullable<PiPromptInput['images']> = []
  let totalBytes = 0
  for (const imagePath of paths) {
    const mimeType = imageMimeType(imagePath)
    if (!mimeType) continue
    try {
      const data = await readFile(imagePath)
      if (
        data.byteLength > MAX_INPUT_IMAGE_BYTES ||
        totalBytes + data.byteLength > MAX_TOTAL_INPUT_IMAGE_BYTES
      ) {
        continue
      }
      totalBytes += data.byteLength
      images.push({ data: data.toString('base64'), mimeType, type: 'image' })
    } catch {
      continue
    }
  }
  return images.length ? { images, message } : { message }
}
