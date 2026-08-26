import { mkdir, realpath } from 'node:fs/promises'

/** The local authority is one writer process; canonical roots also cover sibling store instances. */
const traceFileTails = new Map<string, Promise<void>>()

async function canonicalTraceRoot(root: string): Promise<string> {
  await mkdir(root, { mode: 0o700, recursive: true })
  return realpath(root)
}

export async function withTraceFileQueue<T>(root: string, operation: () => Promise<T>): Promise<T> {
  const key = await canonicalTraceRoot(root)
  const previous = traceFileTails.get(key) ?? Promise.resolve()
  let release: () => void = () => undefined
  const current = new Promise<void>((resolve) => {
    release = resolve
  })
  traceFileTails.set(key, current)
  await previous
  try {
    return await operation()
  } finally {
    release()
    if (traceFileTails.get(key) === current) traceFileTails.delete(key)
  }
}
