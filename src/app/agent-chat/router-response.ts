export async function agentRouterResponseError(
  response: Response,
  fallback: string
): Promise<Error> {
  const payload = (await response.json().catch(() => null)) as { error?: unknown } | null
  return new Error(typeof payload?.error === 'string' ? payload.error : fallback)
}
