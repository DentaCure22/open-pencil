import NEW_BOT_SETUP_CONTEXT from './new-bot-setup-prompt.md?raw'

export function agentConversationContextPrompt(input: {
  browserContext?: string
  configuringBot: boolean
}): string | undefined {
  const parts = [
    input.configuringBot ? NEW_BOT_SETUP_CONTEXT.trim() : '',
    input.browserContext?.trim() ?? ''
  ].filter(Boolean)
  return parts.length ? parts.join('\n\n') : undefined
}
