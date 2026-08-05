export type LocalWorkspaceAuthorityHeadSynchronizerOptions = {
  canResumeWriting(): boolean
  canSynchronize(): boolean
  canWrite(): boolean
  currentSceneVersion(): number
  persist(): Promise<boolean>
  restore(): Promise<boolean>
  setWritable(writable: boolean): void
  startTracking(): void
  stopTracking(): void
}

export function createLocalWorkspaceAuthorityHeadSynchronizer(
  options: LocalWorkspaceAuthorityHeadSynchronizerOptions
) {
  let inFlight: Promise<boolean> | null = null
  let persistedSceneVersion: number | null = null

  function acknowledge(sceneVersion = options.currentSceneVersion()) {
    persistedSceneVersion = sceneVersion
  }

  function synchronize(localChangesAlreadyPreserved = false): Promise<boolean> {
    if (!options.canSynchronize()) return Promise.resolve(false)
    if (inFlight) return inFlight

    inFlight = (async () => {
      if (
        !localChangesAlreadyPreserved &&
        options.canWrite() &&
        persistedSceneVersion !== options.currentSceneVersion()
      ) {
        await options.persist()
      }

      options.stopTracking()
      const restored = await options.restore()
      if (!restored) {
        options.setWritable(false)
        return false
      }

      acknowledge()
      const writable = options.canResumeWriting()
      options.setWritable(writable)
      if (writable) options.startTracking()
      return true
    })().finally(() => {
      inFlight = null
    })
    return inFlight
  }

  return { acknowledge, synchronize }
}
