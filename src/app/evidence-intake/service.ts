import { codeObjectDocument, isCodeObjectFrame } from '@/app/code-object/model'
import {
  WorkspaceDomainError,
  type EvidenceFreshnessStatus,
  type EvidenceManifestItem,
  type EvidenceProviderCapabilities,
  type EvidenceProviderKind,
  type EvidenceProviderRun,
  type EvidenceTruthScope,
  type WorkspaceObject
} from '@/app/workspace'

import type {
  CapturedEvidenceRequest,
  CollectEvidenceInput,
  EvidenceIntakeResult,
  EvidenceSourceRequest,
  CodeObjectFrameEvidenceRequest
} from './types'

const PROVIDERS: Record<
  EvidenceSourceRequest['kind'],
  {
    capabilities: EvidenceProviderCapabilities
    id: string
    kind: EvidenceProviderKind
    requiredScope: string
  }
> = {
  'captured-input': {
    capabilities: {
      capturedContentRead: true,
      externalWrites: false,
      liveRuntimeRead: false,
      networkAccess: false,
      sourceWrites: false,
      workspaceMetadataRead: false
    },
    id: 'openpencil-captured-input-v1',
    kind: 'captured-input',
    requiredScope: 'captured-content:read'
  },
  'code-object-frame': {
    capabilities: {
      capturedContentRead: false,
      externalWrites: false,
      liveRuntimeRead: false,
      networkAccess: false,
      sourceWrites: false,
      workspaceMetadataRead: false
    },
    id: 'openpencil-code-object-v1',
    kind: 'code-object',
    requiredScope: 'code-object:read'
  },
  'workspace-object': {
    capabilities: {
      capturedContentRead: false,
      externalWrites: false,
      liveRuntimeRead: false,
      networkAccess: false,
      sourceWrites: false,
      workspaceMetadataRead: true
    },
    id: 'openpencil-workspace-object-v1',
    kind: 'workspace-object',
    requiredScope: 'workspace-metadata:read'
  }
}

function stablePart(value: string): string {
  const result = value
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
  if (!result) throw new WorkspaceDomainError('validation_failed', 'evidence id is required')
  return result.slice(0, 100)
}

function unique(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))].sort()
}

function requiredScopes(request: EvidenceSourceRequest): string[] {
  return unique([PROVIDERS[request.kind].requiredScope, ...(request.requiredScopes ?? [])])
}

function grantedScopes(required: string[], grant: CollectEvidenceInput['grant']): string[] {
  const available = new Set(grant.scopes)
  return required.filter((scope) => available.has(scope))
}

function freshnessFor(input: {
  freshness?: EvidenceFreshnessStatus
  observedAt?: string
  staleAt?: string
  now: string
}): EvidenceFreshnessStatus {
  if (input.freshness) return input.freshness
  if (input.staleAt && Date.parse(input.staleAt) <= Date.parse(input.now)) return 'stale'
  return input.observedAt ? 'current' : 'unknown'
}

function redactedItem(input: {
  id: string
  providerRunId: string
  requestedScopes: string[]
  retrievedAt: string
}): EvidenceManifestItem {
  return {
    access: 'redacted',
    facts: {},
    freshness: 'unknown',
    id: input.id,
    permissionScopes: input.requestedScopes,
    providerRunId: input.providerRunId,
    retrievedAt: input.retrievedAt,
    sourceRef: `redacted://${stablePart(input.id)}`,
    summary: '',
    title: 'Evidence unavailable',
    truthScope: 'derived'
  }
}

function collectedRun(input: {
  access: EvidenceProviderRun['access']
  completedAt: string
  freshness: EvidenceFreshnessStatus
  grantedScopes: string[]
  id: string
  request: EvidenceSourceRequest
  requestedScopes: string[]
  sourceRef: string
  status: EvidenceProviderRun['status']
  truthScope: EvidenceTruthScope
}): EvidenceProviderRun {
  const provider = PROVIDERS[input.request.kind]
  return {
    access: input.access,
    capabilities: structuredClone(provider.capabilities),
    completedAt: input.completedAt,
    freshness: input.freshness,
    grantedScopes: input.grantedScopes,
    id: input.id,
    providerId: provider.id,
    providerKind: provider.kind,
    requestedScopes: input.requestedScopes,
    requestId: input.request.id,
    sourceRef: input.sourceRef,
    status: input.status,
    truthScope: input.truthScope
  }
}

function capturedItem(
  request: CapturedEvidenceRequest,
  providerRunId: string,
  retrievedAt: string,
  scopes: string[]
): EvidenceManifestItem {
  const truthScope = request.truthScope ?? 'captured'
  return {
    access: 'allowed',
    facts: structuredClone(request.facts),
    freshness: freshnessFor({
      freshness: request.freshness,
      now: retrievedAt,
      observedAt: request.observedAt,
      staleAt: request.staleAt
    }),
    id: request.id,
    observedAt: request.observedAt,
    permissionScopes: scopes,
    providerRunId,
    retrievedAt,
    sourceRef: request.sourceRef,
    staleAt: request.staleAt,
    summary: request.summary,
    title: request.title,
    truthScope
  }
}

function workspaceObjectSummary(object: WorkspaceObject): string {
  return `Canonical ${object.type} ${object.id} at exact revision ${object.revision}.`
}

function resolveCodeObjectFrameRequest(
  input: CollectEvidenceInput,
  request: CodeObjectFrameEvidenceRequest,
  providerRunId: string,
  scopes: string[],
  retrievedAt: string
): { item: EvidenceManifestItem; status: EvidenceProviderRun['status'] } {
  const frame = input.store.graph.getNode(request.frameId)
  const document = codeObjectDocument(frame)
  if (!frame || !isCodeObjectFrame(frame) || !document) {
    return {
      item: redactedItem({
        id: request.id,
        providerRunId,
        requestedScopes: scopes,
        retrievedAt
      }),
      status: 'unavailable'
    }
  }
  const route = typeof document.props.route === 'string' ? document.props.route : undefined
  const truthScope: EvidenceTruthScope = 'captured'
  const sourceRef = `code-object://${document.definitionId}#frame=${frame.id}`
  return {
    item: {
      access: 'allowed',
      facts: {
        frameId: frame.id,
        component: document.component,
        definitionId: document.definitionId,
        ...(route ? { route } : {}),
        runtime: document.runtime
      },
      freshness: 'current',
      id: request.id,
      observedAt: retrievedAt,
      permissionScopes: scopes,
      providerRunId,
      retrievedAt,
      sourceRef,
      summary:
        'The persisted Code Object contract is available at this exact frame revision. Source and user-entered state are excluded from the evidence item.',
      title: `Code Object · ${document.name}`,
      truthScope
    },
    status: 'collected'
  }
}

function resolveAllowedRequest(
  input: CollectEvidenceInput,
  request: EvidenceSourceRequest,
  providerRunId: string,
  scopes: string[],
  retrievedAt: string
): { item: EvidenceManifestItem; status: EvidenceProviderRun['status'] } {
  if (request.kind === 'captured-input') {
    return {
      item: capturedItem(request, providerRunId, retrievedAt, scopes),
      status: 'collected'
    }
  }
  if (request.kind === 'workspace-object') {
    const object = input.workspace?.objects[request.objectId]
    if (!object || object.revision !== request.revision || !object.permissions.canView) {
      return {
        item: redactedItem({
          id: request.id,
          providerRunId,
          requestedScopes: scopes,
          retrievedAt
        }),
        status: object && !object.permissions.canView ? 'redacted' : 'unavailable'
      }
    }
    return {
      item: {
        access: 'allowed',
        facts: {
          objectId: object.id,
          objectType: object.type,
          revision: object.revision,
          tags: object.tags
        },
        freshness: 'current',
        id: request.id,
        observedAt: object.updatedAt,
        permissionScopes: scopes,
        providerRunId,
        retrievedAt,
        sourceObject: { objectId: object.id, revision: object.revision },
        sourceRef: `workspace://${object.workspaceId}/${object.id}@${object.revision}`,
        summary: workspaceObjectSummary(object),
        title: `Workspace ${object.type}`,
        truthScope: 'captured'
      },
      status: 'collected'
    }
  }
  return resolveCodeObjectFrameRequest(input, request, providerRunId, scopes, retrievedAt)
}

export function collectEvidence(input: CollectEvidenceInput): EvidenceIntakeResult {
  const retrievedAt = input.now ?? new Date().toISOString()
  if (new Set(input.requests.map((request) => request.id)).size !== input.requests.length) {
    throw new WorkspaceDomainError(
      'validation_failed',
      'evidence source requests must have unique ids'
    )
  }
  const items: EvidenceManifestItem[] = []
  const providerRuns: EvidenceProviderRun[] = []
  for (const request of input.requests) {
    const requested = requiredScopes(request)
    const granted = grantedScopes(requested, input.grant)
    const providerRunId = `evidence-provider-run_${stablePart(input.collectionId)}-${stablePart(request.id)}`
    if (granted.length !== requested.length) {
      const item = redactedItem({
        id: request.id,
        providerRunId,
        requestedScopes: requested,
        retrievedAt
      })
      items.push(item)
      providerRuns.push(
        collectedRun({
          access: 'redacted',
          completedAt: retrievedAt,
          freshness: item.freshness,
          grantedScopes: granted,
          id: providerRunId,
          request,
          requestedScopes: requested,
          sourceRef: item.sourceRef,
          status: 'redacted',
          truthScope: item.truthScope
        })
      )
      continue
    }
    const resolved = resolveAllowedRequest(input, request, providerRunId, requested, retrievedAt)
    items.push(resolved.item)
    providerRuns.push(
      collectedRun({
        access: resolved.item.access,
        completedAt: retrievedAt,
        freshness: resolved.item.freshness,
        grantedScopes: granted,
        id: providerRunId,
        request,
        requestedScopes: requested,
        sourceRef: resolved.item.sourceRef,
        status: resolved.status,
        truthScope: resolved.item.truthScope
      })
    )
  }
  const receipt = {
    actorId: input.grant.actorId,
    completedAt: retrievedAt,
    grantedScopes: unique(input.grant.scopes),
    id: `evidence-collection_${stablePart(input.collectionId)}`,
    providerRuns,
    requestedAt: input.grant.issuedAt
  }
  return {
    items,
    receipt,
    status: providerRuns.every((run) => run.status === 'collected') ? 'ready' : 'partial'
  }
}
