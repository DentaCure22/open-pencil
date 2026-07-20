import { applyWorkspaceMutation } from './mutation'
import type { WorkspaceMutationEnvelope } from './operations'
import { reconcileHydratedRuntimeTruth } from './runtime-truth'
import { deserializeWorkspace, serializeWorkspace } from './serialization'
import type { KnowledgeWorkspace, WorkspaceMutationOutcome } from './types'

export interface WorkspacePersistence {
  load(workspaceId: string): Promise<string | null>
  remove(workspaceId: string): Promise<void>
  save(workspaceId: string, serialized: string): Promise<void>
}

export class MemoryWorkspacePersistence implements WorkspacePersistence {
  readonly values = new Map<string, string>()

  async load(workspaceId: string): Promise<string | null> {
    return this.values.get(workspaceId) ?? null
  }

  async remove(workspaceId: string): Promise<void> {
    this.values.delete(workspaceId)
  }

  async save(workspaceId: string, serialized: string): Promise<void> {
    this.values.set(workspaceId, serialized)
  }
}

export type WorkspaceStorage = {
  getItem(key: string): string | null
  removeItem(key: string): void
  setItem(key: string, value: string): void
}

export type LocalStorageWorkspacePersistenceOptions = {
  keyPrefix?: string
  maxBytes?: number
  storage?: WorkspaceStorage
}

const DEFAULT_KEY_PREFIX = 'openpencil-knowledge-workspace/v1/'
const DEFAULT_MAX_BYTES = 2_000_000

export class LocalStorageWorkspacePersistence implements WorkspacePersistence {
  private readonly keyPrefix: string
  private readonly maxBytes: number
  private readonly storage?: WorkspaceStorage

  constructor(options: LocalStorageWorkspacePersistenceOptions = {}) {
    this.keyPrefix = options.keyPrefix ?? DEFAULT_KEY_PREFIX
    this.maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES
    this.storage = options.storage
  }

  isAvailable(): boolean {
    return Boolean(this.storage)
  }

  async load(workspaceId: string): Promise<string | null> {
    return this.storage?.getItem(this.storageKey(workspaceId)) ?? null
  }

  async remove(workspaceId: string): Promise<void> {
    this.storage?.removeItem(this.storageKey(workspaceId))
  }

  async save(workspaceId: string, serialized: string): Promise<void> {
    if (!this.storage) {
      throw new Error('workspace_persistence_unavailable: localStorage is not available')
    }
    const bytes = new TextEncoder().encode(serialized).byteLength
    if (bytes > this.maxBytes) {
      throw new Error(
        `workspace_persistence_limit: ${bytes} bytes exceeds the ${this.maxBytes} byte localStorage guard`
      )
    }
    try {
      this.storage.setItem(this.storageKey(workspaceId), serialized)
    } catch (error) {
      throw new Error('workspace_persistence_failed: localStorage rejected the workspace', {
        cause: error
      })
    }
  }

  private storageKey(workspaceId: string): string {
    return `${this.keyPrefix}${workspaceId}`
  }
}

export class WorkspaceRepository {
  constructor(private readonly persistence: WorkspacePersistence) {}

  async load(workspaceId: string): Promise<KnowledgeWorkspace | null> {
    const serialized = await this.persistence.load(workspaceId)
    return serialized ? reconcileHydratedRuntimeTruth(deserializeWorkspace(serialized)) : null
  }

  async mutate(
    workspaceId: string,
    envelope: WorkspaceMutationEnvelope
  ): Promise<WorkspaceMutationOutcome> {
    const workspace = await this.load(workspaceId)
    if (!workspace) throw new Error(`workspace_not_found: ${workspaceId}`)
    const outcome = applyWorkspaceMutation(workspace, envelope)
    if (!envelope.dryRun) await this.save(outcome.workspace)
    return outcome
  }

  async remove(workspaceId: string): Promise<void> {
    await this.persistence.remove(workspaceId)
  }

  async save(workspace: KnowledgeWorkspace): Promise<void> {
    await this.persistence.save(workspace.id, serializeWorkspace(workspace))
  }
}
