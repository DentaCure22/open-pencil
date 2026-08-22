import type * as CodeObjectRuntime from '@/app/code-object/runtime-implementation'

export type CodeObjectRuntimeModule = typeof CodeObjectRuntime

let loadedRuntime: CodeObjectRuntimeModule | null = null
let runtimePromise: Promise<CodeObjectRuntimeModule> | null = null

export function loadedCodeObjectRuntime(): CodeObjectRuntimeModule | null {
  return loadedRuntime
}

export function loadCodeObjectRuntime(): Promise<CodeObjectRuntimeModule> {
  if (loadedRuntime) return Promise.resolve(loadedRuntime)
  runtimePromise ??= import('@/app/code-object/runtime-implementation')
    .then((runtime) => {
      loadedRuntime = runtime
      return runtime
    })
    .catch((error: unknown) => {
      runtimePromise = null
      throw error
    })
  return runtimePromise
}
