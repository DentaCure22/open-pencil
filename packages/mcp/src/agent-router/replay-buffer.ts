/** Keep the start of a command dump so the invocation stays readable. */
export const REPLAY_BUFFER_HEAD_CHARS = 1_200
/** Keep the end of a command dump so the result stays readable. */
export const REPLAY_BUFFER_TAIL_CHARS = 1_200

export function clipReplayText(
  value: string,
  head = REPLAY_BUFFER_HEAD_CHARS,
  tail = REPLAY_BUFFER_TAIL_CHARS
): string {
  const marker = '\n…\n'
  const budget = Math.max(0, head) + Math.max(0, tail)
  if (budget <= 0) return ''
  if (value.length <= budget) return value
  if (head <= 0) return value.slice(-Math.min(tail, budget))
  if (tail <= 0) {
    const take = Math.max(0, budget - 1)
    return `${value.slice(0, take).trimEnd()}…`
  }
  const available = Math.max(0, budget - marker.length)
  if (available <= 0) return '…'
  const headTake = Math.min(head, Math.ceil(available / 2))
  const tailTake = Math.max(0, available - headTake)
  return `${value.slice(0, headTake).trimEnd()}${marker}${value.slice(-tailTake).trimStart()}`
}
