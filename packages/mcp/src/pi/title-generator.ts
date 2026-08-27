import { agentWorkerEnv } from '#mcp/agent-router/worker-env'

import { parsePiModelId, piPromptInputWithEvidence } from './arguments'
import { piEventText } from './events'
import { PiRpcProcess, type PiRpcRecord } from './rpc-process'

const TITLE_MAX_CHARACTERS = 40
const TITLE_PROMPT_MAX_CHARACTERS = 8_000
const TITLE_TIMEOUT_MS = 30_000

export type ConversationTitleInput = {
  attachmentNames?: readonly string[]
  evidencePath?: string
  imagePaths?: readonly string[]
  message: string
}

export interface ConversationTitleGenerator {
  close(): void
  generate(input: ConversationTitleInput): Promise<string | null>
}

export type PiConversationTitleGeneratorOptions = {
  cwd: string
  effort?: string
  env?: NodeJS.ProcessEnv
  executable: string
  extensionPaths?: readonly string[]
  model: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

export function piConversationTitleArguments(
  options: Pick<PiConversationTitleGeneratorOptions, 'effort' | 'extensionPaths' | 'model'>
): string[] {
  const { model, provider } = parsePiModelId(options.model)
  const args = [
    '--mode',
    'rpc',
    '--provider',
    provider,
    '--model',
    model,
    '--thinking',
    options.effort?.trim() || 'medium',
    '--no-session',
    '--no-tools',
    '--no-skills',
    '--no-prompt-templates',
    '--no-themes',
    '--no-context-files',
    '--no-approve'
  ]
  if (options.extensionPaths?.length) {
    args.push('--no-extensions')
    for (const extensionPath of options.extensionPaths) {
      args.push('--extension', extensionPath)
    }
  }
  return args
}

export function conversationTitlePrompt(input: ConversationTitleInput): string {
  const message = input.message.trim().slice(0, TITLE_PROMPT_MAX_CHARACTERS)
  const attachments = (input.attachmentNames ?? []).map((name) => name.trim()).filter(Boolean)
  const attachmentContext = attachments.length
    ? `\n\nAttached items:\n${attachments.map((name) => `- ${name}`).join('\n')}`
    : ''
  return `Generate a title that will help the user recognize this OpenPencil chat later.
Return JSON with exactly one key: title.

Rules:
- Summarize the user's durable goal instead of repeating the request verbatim.
- Use 3-8 words and fewer than ${String(TITLE_MAX_CHARACTERS)} characters.
- Use a compact noun phrase or clear action phrase.
- Ignore incidental instructions, tools, models, output formats, and implementation steps unless they are the topic.
- Do not claim the work is complete.
- Do not use quotes, markdown, prefixes, or trailing punctuation.
- Do not answer the request.

User request:
${message}${attachmentContext}`
}

function jsonTitle(response: string): string | null {
  const start = response.indexOf('{')
  const end = response.lastIndexOf('}')
  if (start === -1 || end <= start) return null
  try {
    const parsed: unknown = JSON.parse(response.slice(start, end + 1))
    return isRecord(parsed) && typeof parsed.title === 'string' ? parsed.title : null
  } catch {
    return null
  }
}

export function sanitizeConversationTitle(response: string): string | null {
  const raw = jsonTitle(response)
  if (!raw) return null
  const compact = raw
    .trim()
    .replace(/^['"`“”‘’]+|['"`“”‘’]+$/g, '')
    .replace(/\s+/g, ' ')
    .replace(/[.!?:;]+$/g, '')
    .trim()
  if (!compact) return null
  const characters = Array.from(compact)
  if (characters.length <= TITLE_MAX_CHARACTERS) return compact
  return `${characters
    .slice(0, TITLE_MAX_CHARACTERS - 1)
    .join('')
    .trimEnd()}…`
}

function assistantResponse(event: PiRpcRecord): string {
  if (event.type !== 'message_end' || !isRecord(event.message)) return ''
  if (event.message.role !== 'assistant') return ''
  return piEventText(event.message).trim()
}

export class PiConversationTitleGenerator implements ConversationTitleGenerator {
  private readonly active = new Set<PiRpcProcess>()
  private readonly env: NodeJS.ProcessEnv
  private closed = false

  constructor(private readonly options: PiConversationTitleGeneratorOptions) {
    this.env = agentWorkerEnv(options.env ?? process.env, options.executable)
  }

  close(): void {
    this.closed = true
    for (const process of this.active) process.close()
    this.active.clear()
  }

  private isClosed(): boolean {
    return this.closed
  }

  async generate(input: ConversationTitleInput): Promise<string | null> {
    if (this.closed || !input.message.trim()) return null
    let rpc: PiRpcProcess | null = null
    let finalResponse = ''
    let settled = false
    let resolveSettled: (value: string) => void = () => undefined
    const settledResponse = new Promise<string>((resolve) => {
      resolveSettled = resolve
    })
    const finish = (response: string) => {
      if (settled) return
      settled = true
      resolveSettled(response)
    }

    try {
      rpc = await PiRpcProcess.start({
        args: piConversationTitleArguments(this.options),
        cwd: this.options.cwd,
        env: this.env,
        executable: this.options.executable,
        onEvent: (event) => {
          if (event.type === 'extension_ui_request' && typeof event.id === 'string') {
            try {
              rpc?.write({ cancelled: true, id: event.id, type: 'extension_ui_response' })
            } catch {
              rpc?.close()
            }
            return
          }
          const response = assistantResponse(event)
          if (response) finalResponse = response
          if (event.type === 'agent_settled') finish(finalResponse)
        },
        onExit: () => {
          if (!settled) finish('')
        }
      })
      if (this.isClosed()) return null
      this.active.add(rpc)
      const prompt = conversationTitlePrompt(input)
      const promptInput = await piPromptInputWithEvidence(
        prompt,
        input.evidencePath,
        input.imagePaths
      )
      const promptResponse = await rpc.command({ ...promptInput, type: 'prompt' }, TITLE_TIMEOUT_MS)
      if (!promptResponse.success) return null
      let timeout: ReturnType<typeof setTimeout> | null = null
      const response = await Promise.race([
        settledResponse,
        new Promise<string>((_, reject) => {
          timeout = setTimeout(
            () => reject(new Error('Pi title generation timed out.')),
            TITLE_TIMEOUT_MS
          )
          timeout.unref()
        })
      ]).finally(() => {
        if (timeout) clearTimeout(timeout)
      })
      return sanitizeConversationTitle(response)
    } catch {
      return null
    } finally {
      if (rpc) {
        this.active.delete(rpc)
        rpc.close()
      }
    }
  }
}
