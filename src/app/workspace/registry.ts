import { WorkspaceDomainError } from './errors'
import { createKnowledgeWorkspace } from './factories'
import { applyWorkspaceMutation } from './mutation'
import type { WorkspaceMutationEnvelope } from './operations'
import { reconcileHydratedRuntimeTruth } from './runtime-truth'
import { deserializeWorkspace, serializeWorkspace } from './serialization'
import type { KnowledgeWorkspace, WorkspaceMutationOutcome } from './types'

export type ResolveKnowledgeWorkspaceInput = {
  createdBy?: string
  documentId: string
  name?: string
  pageId: string
}

type SerializedWorkspaceRegistry = {
  schemaVersion: 1
  workspaces: KnowledgeWorkspace[]
}

function workspaceKey(documentId: string, pageId: string): string {
  return `${encodeURIComponent(documentId)}::${encodeURIComponent(pageId)}`
}

export class WorkspaceRegistry {
  private readonly workspaces = new Map<string, KnowledgeWorkspace>()

  clear(): void {
    this.workspaces.clear()
  }

  get(documentId: string, pageId: string): KnowledgeWorkspace | null {
    return this.workspaces.get(workspaceKey(documentId, pageId)) ?? null
  }

  list(): KnowledgeWorkspace[] {
    return [...this.workspaces.values()]
  }

  resolve(input: ResolveKnowledgeWorkspaceInput): KnowledgeWorkspace {
    const existing = this.get(input.documentId, input.pageId)
    if (existing) return existing
    const workspace = createKnowledgeWorkspace({
      createdBy: input.createdBy,
      documentId: input.documentId,
      name: input.name ?? 'OpenPencil Knowledge Workspace',
      pageId: input.pageId
    })
    this.replace(workspace)
    return workspace
  }

  replace(workspace: KnowledgeWorkspace): void {
    this.workspaces.set(workspaceKey(workspace.documentId, workspace.pageId), workspace)
  }

  mutate(
    documentId: string,
    pageId: string,
    envelope: WorkspaceMutationEnvelope
  ): WorkspaceMutationOutcome {
    const workspace = this.get(documentId, pageId)
    if (!workspace) {
      throw new WorkspaceDomainError(
        'not_found',
        `knowledge workspace for document ${documentId}, page ${pageId}`
      )
    }
    const claimsSharedRuntime = envelope.operations.some(
      (operation) => operation.type === 'set-runtime-owner' && operation.blockId !== null
    )
    if (claimsSharedRuntime) {
      const otherOwner = this.list().find(
        (candidate) => candidate.id !== workspace.id && candidate.activeRuntimeBlockId
      )
      if (otherOwner) {
        throw new WorkspaceDomainError(
          'validation_failed',
          `shared live runtime is already owned by ${otherOwner.activeRuntimeBlockId}; release it before assigning another owner`
        )
      }
    }
    const outcome = applyWorkspaceMutation(workspace, envelope)
    if (!envelope.dryRun) this.replace(outcome.workspace)
    return outcome
  }

  serialize(): string {
    const bundle: SerializedWorkspaceRegistry = {
      schemaVersion: 1,
      workspaces: this.list().map((workspace) =>
        deserializeWorkspace(serializeWorkspace(workspace))
      )
    }
    return JSON.stringify(bundle)
  }

  hydrate(serialized: string): void {
    let parsed: unknown
    try {
      parsed = JSON.parse(serialized)
    } catch {
      throw new WorkspaceDomainError('validation_failed', 'workspace registry is not valid JSON')
    }
    if (!parsed || typeof parsed !== 'object' || !('workspaces' in parsed)) {
      throw new WorkspaceDomainError('validation_failed', 'workspace registry payload is invalid')
    }
    const workspaces = (parsed as { workspaces?: unknown }).workspaces
    if (!Array.isArray(workspaces)) {
      throw new WorkspaceDomainError(
        'validation_failed',
        'workspace registry workspaces must be an array'
      )
    }
    const hydrated = workspaces.map((workspace) =>
      reconcileHydratedRuntimeTruth(deserializeWorkspace(JSON.stringify(workspace)))
    )
    this.clear()
    hydrated.forEach((workspace) => this.replace(workspace))
  }
}

export const workspaceRegistry = new WorkspaceRegistry()

export function resolveKnowledgeWorkspace(
  input: ResolveKnowledgeWorkspaceInput
): KnowledgeWorkspace {
  return workspaceRegistry.resolve(input)
}

export function getKnowledgeWorkspace(
  documentId: string,
  pageId: string
): KnowledgeWorkspace | null {
  return workspaceRegistry.get(documentId, pageId)
}

export function replaceKnowledgeWorkspace(workspace: KnowledgeWorkspace): void {
  workspaceRegistry.replace(workspace)
}

export function mutateKnowledgeWorkspace(
  documentId: string,
  pageId: string,
  envelope: WorkspaceMutationEnvelope
): WorkspaceMutationOutcome {
  return workspaceRegistry.mutate(documentId, pageId, envelope)
}

export function serializeActiveKnowledgeWorkspaces(): string {
  return workspaceRegistry.serialize()
}

export function hydrateActiveKnowledgeWorkspaces(serialized: string): void {
  workspaceRegistry.hydrate(serialized)
}
