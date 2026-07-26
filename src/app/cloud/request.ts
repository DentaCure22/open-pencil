export const CLOUD_REQUEST_TIMEOUT_MS = 15_000

const CLOUD_TIMEOUT_MESSAGE =
  'OpenPencil Cloud could not connect within 15 seconds. Wait a moment, then try again.'
const CLOUD_UNAVAILABLE_MESSAGE =
  'OpenPencil Cloud could not reach its storage service. Wait a moment, then try again.'

export async function runCloudRequest<T>(
  request: (signal: AbortSignal) => PromiseLike<T>,
  timeoutMs = CLOUD_REQUEST_TIMEOUT_MS
): Promise<T> {
  const controller = new AbortController()
  const timeoutSignal = AbortSignal.timeout(timeoutMs)
  const deadline = new Promise<never>((_, reject) => {
    timeoutSignal.addEventListener(
      'abort',
      () => {
        reject(new Error(CLOUD_TIMEOUT_MESSAGE))
        controller.abort()
      },
      { once: true }
    )
  })
  return Promise.race([Promise.resolve(request(controller.signal)), deadline])
}

export function cloudRequestErrorMessage(error: unknown): string {
  if (!(error instanceof Error)) return 'OpenPencil Cloud could not connect'
  if (error.message === CLOUD_TIMEOUT_MESSAGE) return error.message
  if (
    error.name === 'AuthRetryableFetchError' ||
    error.name === 'AbortError' ||
    error.message.includes('Failed to fetch')
  ) {
    return CLOUD_UNAVAILABLE_MESSAGE
  }
  return error.message
}
