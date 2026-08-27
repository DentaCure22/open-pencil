const MAX_CONTEXT_BYTES = 24 * 1024
const MAX_LIST_ITEMS = 60
const MAX_TEXT_LENGTH = 600

type VoiceContext = {
  active?: {
    composerText?: string
    conversationTitle?: string
    recentPhrases?: string[]
    terms?: string[]
    todoTitle?: string
  }
  global?: {
    projectPaths?: string[]
  }
  project?: {
    childNames?: string[]
    path?: string[]
    todoTitles?: string[]
  }
}

function text(value: unknown, limit = MAX_TEXT_LENGTH): string | undefined {
  if (typeof value !== 'string') return undefined
  const compact = value.replace(/\s+/g, ' ').trim()
  if (!compact) return undefined
  return compact.slice(0, limit)
}

function list(value: unknown, itemLimit = MAX_LIST_ITEMS): string[] {
  if (!Array.isArray(value)) return []
  return value
    .map((item) => text(item, 240))
    .filter((item): item is string => Boolean(item))
    .slice(0, itemLimit)
}

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

export function parseVoiceDictationContext(value: unknown): VoiceContext | undefined {
  if (value === undefined || value === null) return undefined
  const encoded = JSON.stringify(value)
  if (Buffer.byteLength(encoded, 'utf8') > MAX_CONTEXT_BYTES) {
    throw new Error('Voice context is too large')
  }

  const input = object(value)
  const activeInput = object(input.active)
  const globalInput = object(input.global)
  const projectInput = object(input.project)
  const active = {
    ...(text(activeInput.composerText) ? { composerText: text(activeInput.composerText) } : {}),
    ...(text(activeInput.conversationTitle, 240)
      ? { conversationTitle: text(activeInput.conversationTitle, 240) }
      : {}),
    ...(list(activeInput.recentPhrases, 6).length
      ? { recentPhrases: list(activeInput.recentPhrases, 6) }
      : {}),
    ...(list(activeInput.terms, 24).length ? { terms: list(activeInput.terms, 24) } : {}),
    ...(text(activeInput.todoTitle, 240) ? { todoTitle: text(activeInput.todoTitle, 240) } : {})
  }
  const global = { projectPaths: list(globalInput.projectPaths) }
  const project = {
    childNames: list(projectInput.childNames, 24),
    path: list(projectInput.path, 12),
    todoTitles: list(projectInput.todoTitles, 24)
  }
  if (
    !Object.keys(active).length &&
    !global.projectPaths.length &&
    !project.childNames.length &&
    !project.path.length &&
    !project.todoTitles.length
  ) {
    return undefined
  }
  return {
    ...(Object.keys(active).length ? { active } : {}),
    ...(global.projectPaths.length ? { global } : {}),
    ...(project.childNames.length || project.path.length || project.todoTitles.length
      ? { project }
      : {})
  }
}
