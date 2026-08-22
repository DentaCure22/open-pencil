type DirectedWorkPromptInput = {
  exactWords: string
  namedTargetLines?: string[]
}

export function composeDirectedWorkPrompt(input: DirectedWorkPromptInput): string {
  return [
    input.exactWords.trim(),
    ...(input.namedTargetLines?.length ? ['', ...input.namedTargetLines] : [])
  ].join('\n')
}
