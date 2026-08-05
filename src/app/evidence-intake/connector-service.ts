import { ConnectorRequestError } from '@/app/connectors'
import type {
  ConnectorEvidenceRequest,
  OpenPencilConnector,
  ConnectorRegistry,
  ConnectorTransportEvidence
} from '@/app/connectors'
import {
  WorkspaceDomainError,
  type EvidenceManifestItem,
  type EvidenceProviderFailureCode,
  type EvidenceProviderRun
} from '@/app/workspace'

import { evidenceIdPart, redactedEvidenceItem, uniqueEvidenceScopes } from './manifest'
import { collectEvidence } from './service'
import type { CollectEvidenceInput, EvidenceIntakeResult } from './types'

export type CollectEvidenceWithConnectorsInput = CollectEvidenceInput & {
  connectorRequests: ConnectorEvidenceRequest[]
  connectorRegistry: ConnectorRegistry
}

function connectorFailure(error: unknown): {
  attemptCount: number
  errorCode: EvidenceProviderFailureCode
  providerRequestId?: string
  responseStatus?: number
} {
  if (error instanceof ConnectorRequestError) {
    return {
      attemptCount: error.attemptCount,
      errorCode: error.code,
      providerRequestId: error.providerRequestId,
      responseStatus: error.responseStatus
    }
  }
  return { attemptCount: 1, errorCode: 'unknown' }
}

function connectorEvidenceReader(connector: OpenPencilConnector) {
  return connector.readEvidence?.bind(connector)
}

export async function collectEvidenceWithConnectors(
  input: CollectEvidenceWithConnectorsInput
): Promise<EvidenceIntakeResult> {
  const local = collectEvidence(input)
  const retrievedAt = input.now ?? new Date().toISOString()
  const connectorIds = input.connectorRequests.map((request) => request.id)
  if (
    new Set(connectorIds).size !== connectorIds.length ||
    connectorIds.some((id) => input.requests.some((request) => request.id === id))
  ) {
    throw new WorkspaceDomainError(
      'validation_failed',
      'local and connector evidence requests must have unique ids'
    )
  }
  const items = [...local.items]
  const providerRuns = [...local.receipt.providerRuns]
  for (const request of input.connectorRequests) {
    const connector = input.connectorRegistry.require(request.connectorId)
    const descriptor = connector.descriptor
    const requestedScopes = uniqueEvidenceScopes([
      ...descriptor.evidenceReadScopes,
      ...(request.requiredScopes ?? [])
    ])
    const grantedScopes = requestedScopes.filter((scope) => input.grant.scopes.includes(scope))
    const providerRunId = `evidence-provider-run_${evidenceIdPart(input.collectionId)}-${evidenceIdPart(request.id)}`
    const missingScope = grantedScopes.length !== requestedScopes.length
    const readEvidence = connectorEvidenceReader(connector)
    const unsupported = !descriptor.capabilities.evidenceRead || !readEvidence
    if (missingScope || unsupported) {
      const item = redactedEvidenceItem({
        id: request.id,
        providerRunId,
        requestedScopes,
        retrievedAt
      })
      items.push(item)
      providerRuns.push({
        access: 'redacted',
        attemptCount: 0,
        capabilities: {
          capturedContentRead: false,
          externalWrites: false,
          liveRuntimeRead: false,
          networkAccess: descriptor.capabilities.networkAccess,
          sourceWrites: false,
          workspaceMetadataRead: false
        },
        completedAt: retrievedAt,
        errorCode: missingScope ? 'scope-denied' : 'not-supported',
        freshness: 'unknown',
        grantedScopes,
        id: providerRunId,
        providerId: descriptor.id,
        providerKind: 'connector',
        requestedScopes,
        requestId: request.id,
        sourceRef: item.sourceRef,
        status: missingScope ? 'redacted' : 'unavailable',
        truthScope: 'derived'
      })
      continue
    }
    let item: EvidenceManifestItem
    let status: EvidenceProviderRun['status'] = 'collected'
    let transport: ConnectorTransportEvidence | undefined
    let errorCode: EvidenceProviderFailureCode | undefined
    let failureAttemptCount: number | undefined
    let failureProviderRequestId: string | undefined
    let failureResponseStatus: number | undefined
    try {
      const result = await readEvidence({ grantedScopes, now: retrievedAt, request })
      transport = result.transport
      item = {
        access: 'allowed',
        facts: structuredClone(result.facts),
        freshness: result.freshness,
        id: request.id,
        observedAt: result.observedAt,
        permissionScopes: requestedScopes,
        providerRunId,
        retrievedAt,
        sourceRef: result.sourceRef,
        staleAt: result.staleAt,
        summary: result.summary,
        title: result.title,
        truthScope: result.truthScope
      }
    } catch (error) {
      item = redactedEvidenceItem({
        id: request.id,
        providerRunId,
        requestedScopes,
        retrievedAt
      })
      status = 'unavailable'
      const failure = connectorFailure(error)
      errorCode = failure.errorCode
      failureAttemptCount = failure.attemptCount
      failureProviderRequestId = failure.providerRequestId
      failureResponseStatus = failure.responseStatus
    }
    items.push(item)
    providerRuns.push({
      access: item.access,
      attemptCount: transport?.attemptCount ?? failureAttemptCount ?? 1,
      capabilities: {
        capturedContentRead: false,
        externalWrites: false,
        liveRuntimeRead: false,
        networkAccess: descriptor.capabilities.networkAccess,
        sourceWrites: false,
        workspaceMetadataRead: false
      },
      completedAt: retrievedAt,
      errorCode,
      freshness: item.freshness,
      grantedScopes,
      id: providerRunId,
      providerId: descriptor.id,
      providerKind: 'connector',
      providerRequestId: transport?.providerRequestId ?? failureProviderRequestId,
      requestedScopes,
      requestId: request.id,
      responseStatus: transport?.responseStatus ?? failureResponseStatus,
      sourceRef: item.sourceRef,
      status,
      truthScope: item.truthScope
    })
  }
  return {
    items,
    receipt: { ...local.receipt, providerRuns },
    status: providerRuns.every((run) => run.status === 'collected') ? 'ready' : 'partial'
  }
}
