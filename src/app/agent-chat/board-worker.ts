export const BOARD_WORKER_TOOL_SCOPE = 'board-worker' as const

export function boardWorkerLaunchFields(prompt: string) {
  return {
    prompt,
    toolScope: BOARD_WORKER_TOOL_SCOPE
  }
}
