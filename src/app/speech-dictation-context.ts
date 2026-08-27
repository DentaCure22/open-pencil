import type { AgentConversationThread } from '@/app/agent-chat/conversations'
import type { AgentWorkMap, AgentWorkMapProject } from '@/app/agent-chat/work-map'
import type { VoiceDictationContext } from '@/app/speech-dictation-bridge'

const MAX_GLOBAL_PROJECT_PATHS = 60
const MAX_PROJECT_CHILDREN = 20
const MAX_PROJECT_TODOS = 20
const MAX_RECENT_PHRASES = 4
const MAX_ACTIVE_TERMS = 24

type SpeechDictationContextInput = {
  composerText?: string
  projectId?: string | null
  thread?: AgentConversationThread | null
  workMap?: AgentWorkMap | null
}

function boundedText(value: string | undefined, limit: number): string | undefined {
  const compact = value?.replace(/\s+/g, ' ').trim()
  if (!compact) return undefined
  return compact.length <= limit ? compact : `${compact.slice(0, Math.max(0, limit - 1))}…`
}

function projectPath(
  projects: readonly AgentWorkMapProject[],
  projectId: string
): AgentWorkMapProject[] {
  const byId = new Map(projects.map((project) => [project.id, project] as const))
  const path: AgentWorkMapProject[] = []
  const seen = new Set<string>()
  let current = byId.get(projectId)
  while (current && !seen.has(current.id)) {
    path.unshift(current)
    seen.add(current.id)
    current = current.parentId ? byId.get(current.parentId) : undefined
  }
  return path
}

function activeProjectId(input: SpeechDictationContextInput): string | null {
  if (input.projectId !== undefined) return input.projectId
  const workMap = input.workMap
  const thread = input.thread
  if (!workMap || !thread) return thread?.todoDraft?.projectId ?? null
  if (thread.todoDraft?.projectId) return thread.todoDraft.projectId

  const threadId = thread.nativeThreadId
  return (
    workMap.todos.find((todo) => todo.threadId === threadId)?.projectId ??
    workMap.bots.find((bot) => bot.threadId === threadId)?.projectId ??
    workMap.placements.find((placement) => placement.threadId === threadId)?.projectId ??
    null
  )
}

function globalProjectPaths(projects: readonly AgentWorkMapProject[]): string[] {
  return projects
    .map((project) =>
      projectPath(projects, project.id)
        .map(({ name }) => name)
        .join(' / ')
    )
    .filter(Boolean)
    .slice(0, MAX_GLOBAL_PROJECT_PATHS)
}

function recentUserPhrases(thread: AgentConversationThread | null | undefined): string[] {
  return (thread?.messages ?? [])
    .filter((message) => message.role === 'user')
    .map((message) => boundedText(message.text, 280))
    .filter((value): value is string => Boolean(value))
    .slice(-MAX_RECENT_PHRASES)
}

function distinctiveTerms(value: string | undefined): string[] {
  return (value?.match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu) ?? []).filter(
    (term) =>
      term.length >= 3 &&
      (/[a-z][A-Z]/.test(term) ||
        /^[A-Z\d]{2,}$/.test(term) ||
        (term.length >= 4 && !/[aeiou]/i.test(term)))
  )
}

function uniqueTerms(values: readonly (string | undefined)[]): string[] {
  const result: string[] = []
  const seen = new Set<string>()
  for (const value of values) {
    const term = boundedText(value, 160)
    if (!term) continue
    const key = term.toLocaleLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    result.push(term)
    if (result.length >= MAX_ACTIVE_TERMS) break
  }
  return result
}

/**
 * Build a small language-context packet for voice transcription. It carries
 * names and recent phrasing, not the full contents of every project or chat.
 */
export function buildSpeechDictationContext(
  input: SpeechDictationContextInput
): VoiceDictationContext {
  const workMap = input.workMap
  const thread = input.thread
  const projectId = activeProjectId(input)
  const project = projectId
    ? workMap?.projects.find((candidate) => candidate.id === projectId)
    : undefined
  const todo = thread
    ? workMap?.todos.find(
        (candidate) =>
          candidate.id === thread.todoDraft?.todoId || candidate.threadId === thread.nativeThreadId
      )
    : undefined
  const path = project && workMap ? projectPath(workMap.projects, project.id) : []
  const conversationTitle = boundedText(thread?.title || thread?.task, 160)
  const todoTitle = boundedText(todo?.title || thread?.todoDraft?.brief.goal, 180)
  const composerText = boundedText(input.composerText, 500)
  const recentPhrases = recentUserPhrases(thread)
  const terms = uniqueTerms([
    ...path
      .slice()
      .reverse()
      .map(({ name }) => name),
    ...distinctiveTerms(conversationTitle),
    ...distinctiveTerms(todoTitle),
    ...distinctiveTerms(composerText),
    ...recentPhrases.flatMap((phrase) => distinctiveTerms(phrase))
  ])

  const active = {
    ...(composerText ? { composerText } : {}),
    ...(conversationTitle ? { conversationTitle } : {}),
    ...(recentPhrases.length ? { recentPhrases } : {}),
    ...(terms.length ? { terms } : {}),
    ...(todoTitle ? { todoTitle } : {})
  }

  return {
    ...(Object.keys(active).length ? { active } : {}),
    global: {
      projectPaths: globalProjectPaths(workMap?.projects ?? [])
    },
    ...(project && workMap
      ? {
          project: {
            childNames: workMap.projects
              .filter((candidate) => candidate.parentId === project.id)
              .map(({ name }) => name)
              .slice(0, MAX_PROJECT_CHILDREN),
            path: path.map(({ name }) => name),
            todoTitles: workMap.todos
              .filter((candidate) => candidate.projectId === project.id && !candidate.archivedAt)
              .map(({ title }) => title)
              .slice(0, MAX_PROJECT_TODOS)
          }
        }
      : {})
  }
}

type WordToken = {
  end: number
  start: number
  value: string
}

function phraseWords(value: string): string[] {
  return (
    value
      .replace(/([a-z\d])([A-Z])/g, '$1 $2')
      .match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu)
      ?.map((word) => word.toLocaleLowerCase()) ?? []
  )
}

function transcriptWords(value: string): WordToken[] {
  const words: WordToken[] = []
  for (const match of value.matchAll(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu)) {
    const start = match.index ?? 0
    words.push({ end: start + match[0].length, start, value: match[0].toLocaleLowerCase() })
  }
  return words
}

function editDistance(left: string, right: string): number {
  const previous = Array.from({ length: right.length + 1 }, (_, index) => index)
  for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
    const current = [leftIndex]
    for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
      current[rightIndex] = Math.min(
        (current[rightIndex - 1] ?? 0) + 1,
        (previous[rightIndex] ?? 0) + 1,
        (previous[rightIndex - 1] ?? 0) + (left[leftIndex - 1] === right[rightIndex - 1] ? 0 : 1)
      )
    }
    previous.splice(0, previous.length, ...current)
  }
  return previous[right.length] ?? right.length
}

function exactAliasPattern(canonical: string): RegExp | null {
  const words = phraseWords(canonical)
  if (!words.length) return null
  const body = words.map((word) => word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('[\\s_-]+')
  return new RegExp(`(^|[^\\p{L}\\p{N}])${body}(?=$|[^\\p{L}\\p{N}])`, 'giu')
}

function replaceExactAlias(transcript: string, canonical: string): string {
  const pattern = exactAliasPattern(canonical)
  return pattern
    ? transcript.replace(pattern, (_match, prefix: string) => `${prefix}${canonical}`)
    : transcript
}

function unusualSpelling(value: string): boolean {
  return /[a-z][A-Z]/.test(value) || /^[A-Z\d]{2,}$/.test(value) || !/[aeiou]/i.test(value)
}

function replaceFuzzyAlias(transcript: string, canonical: string): string {
  const expected = phraseWords(canonical)
  if (!expected.length || expected.length > 8) return transcript
  const words = transcriptWords(transcript)
  const matches: Array<{ end: number; start: number }> = []
  const windowLengths =
    expected.length >= 3 ? [expected.length, expected.length - 1] : [expected.length]
  for (let index = 0; index < words.length; index += 1) {
    for (const windowLength of windowLengths) {
      if (index + windowLength > words.length) continue
      const window = words.slice(index, index + windowLength)
      const changed =
        windowLength === expected.length
          ? expected
              .map((word, offset) => editDistance(word, window[offset]?.value ?? ''))
              .filter(Boolean)
          : []
      const compactDistance = editDistance(
        expected.join(''),
        window.map(({ value }) => value).join('')
      )
      const accepted =
        expected.length === 1
          ? (changed[0] ?? 0) > 0 &&
            (changed[0] ?? 0) <= (unusualSpelling(canonical) ? 2 : 1) &&
            Math.abs(expected[0]!.length - window[0]!.value.length) <= 2
          : windowLength === expected.length
            ? changed.length === 1 && (changed[0] ?? 0) <= (unusualSpelling(canonical) ? 3 : 2)
            : compactDistance > 0 && compactDistance <= 3
      if (!accepted) continue
      matches.push({ start: window[0]!.start, end: window.at(-1)!.end })
      index += windowLength - 1
      break
    }
  }
  let result = transcript
  for (const match of matches.reverse()) {
    result = `${result.slice(0, match.start)}${canonical}${result.slice(match.end)}`
  }
  return result
}

function uniqueContextValues(values: readonly (string | undefined)[]): string[] {
  const seen = new Set<string>()
  return values.filter((value): value is string => {
    if (!value?.trim()) return false
    const key = value.toLocaleLowerCase()
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

/** Preserve exact project and product spellings while the CLI revises its live transcript. */
export function contextualizeSpeechDictation(
  transcript: string,
  context: VoiceDictationContext | undefined
): string {
  if (!transcript.trim() || !context) return transcript
  const exactValues = uniqueContextValues([
    ...(context.active?.terms ?? []),
    context.active?.conversationTitle,
    context.active?.todoTitle,
    ...(context.project?.path?.slice().reverse() ?? []),
    ...(context.project?.childNames ?? []),
    ...(context.project?.todoTitles ?? []),
    ...(context.global?.projectPaths ?? []).flatMap((projectPath) =>
      projectPath.split('/').map((part) => part.trim())
    )
  ])
  const fuzzyValues = uniqueContextValues([
    ...(context.active?.terms ?? []),
    context.active?.conversationTitle,
    context.active?.todoTitle
  ])
  let result = exactValues.reduce(replaceExactAlias, transcript)
  result = fuzzyValues.reduce(replaceFuzzyAlias, result)
  return result
}
