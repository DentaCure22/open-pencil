export function compactContextCommentText(value: string, max = 500): string {
  const normalized = value.replaceAll(/\s+/g, ' ').trim()
  return normalized.length <= max ? normalized : `${normalized.slice(0, max - 1)}…`
}
