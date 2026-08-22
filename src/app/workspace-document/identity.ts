import type { SceneGraph, SceneNode } from '@open-pencil/scene-graph'

import { readCacheJson, writeCacheJson } from '@/app/cache'
import { refreshLocalWorkspaceAuthorityStatus } from '@/app/workspace-document/local-authority/client'

export const OPENPENCIL_WORKSPACE_DOCUMENT_NAME = 'OpenPencil Workspace'
export const OPENPENCIL_WORKSPACE_PLUGIN_ID = 'openpencil-workspace'
export const OPENPENCIL_WORKSPACE_IDENTITY_KEY = 'identity-v1'

const WORKSPACE_IDENTITY_CACHE_KEY = 'workspace/document-identity-v1'
const PRE_AUTHORITY_WORKSPACE_IDENTITY_CACHE_KEY = 'workspace/pre-authority-identity-v1'
const WORKSPACE_IDENTITY_SCHEMA_VERSION = 1

export type OpenPencilWorkspaceIdentity = {
  documentId: string
  documentName: typeof OPENPENCIL_WORKSPACE_DOCUMENT_NAME
  roomId: string
  schemaVersion: typeof WORKSPACE_IDENTITY_SCHEMA_VERSION
  workspaceId: string
}

export type OpenPencilWorkspaceIdentityStorage = {
  load(): Promise<unknown>
  save(identity: OpenPencilWorkspaceIdentity): Promise<void>
}

const browserWorkspaceIdentityStorage: OpenPencilWorkspaceIdentityStorage = {
  load: () => readCacheJson<unknown>(WORKSPACE_IDENTITY_CACHE_KEY),
  save: (identity) => writeCacheJson(WORKSPACE_IDENTITY_CACHE_KEY, identity)
}

let workspaceIdentityPromise: Promise<OpenPencilWorkspaceIdentity> | null = null
let browserSourceIdentity: OpenPencilWorkspaceIdentity | null = null

function secureId(): string {
  if (typeof crypto === 'undefined' || typeof crypto.randomUUID !== 'function') {
    throw new TypeError(
      'secure_crypto_unavailable: OpenPencil workspace identity requires Web Crypto'
    )
  }
  return crypto.randomUUID()
}

export function createOpenPencilWorkspaceIdentity(
  createId: () => string = secureId
): OpenPencilWorkspaceIdentity {
  return {
    documentId: `document-${createId()}`,
    documentName: OPENPENCIL_WORKSPACE_DOCUMENT_NAME,
    roomId: `workspace-room-${createId()}`,
    schemaVersion: WORKSPACE_IDENTITY_SCHEMA_VERSION,
    workspaceId: `workspace-${createId()}`
  }
}

export function parseOpenPencilWorkspaceIdentity(
  value: unknown
): OpenPencilWorkspaceIdentity | null {
  if (!value || typeof value !== 'object') return null
  const candidate = value as Partial<OpenPencilWorkspaceIdentity>
  if (
    candidate.schemaVersion !== WORKSPACE_IDENTITY_SCHEMA_VERSION ||
    candidate.documentName !== OPENPENCIL_WORKSPACE_DOCUMENT_NAME ||
    typeof candidate.workspaceId !== 'string' ||
    candidate.workspaceId.length === 0 ||
    typeof candidate.documentId !== 'string' ||
    candidate.documentId.length === 0 ||
    typeof candidate.roomId !== 'string' ||
    candidate.roomId.length === 0
  ) {
    return null
  }
  return candidate as OpenPencilWorkspaceIdentity
}

export async function resolveOpenPencilWorkspaceIdentity(
  storage: OpenPencilWorkspaceIdentityStorage = browserWorkspaceIdentityStorage,
  createIdentity: () => OpenPencilWorkspaceIdentity = createOpenPencilWorkspaceIdentity
): Promise<OpenPencilWorkspaceIdentity> {
  const stored = parseOpenPencilWorkspaceIdentity(await storage.load())
  if (stored) return stored
  const created = createIdentity()
  await storage.save(created)
  return created
}

export function loadOpenPencilWorkspaceIdentity(): Promise<OpenPencilWorkspaceIdentity> {
  workspaceIdentityPromise ??= resolveRuntimeOpenPencilWorkspaceIdentity()
  return workspaceIdentityPromise
}

async function resolveRuntimeOpenPencilWorkspaceIdentity(): Promise<OpenPencilWorkspaceIdentity> {
  const stored = parseOpenPencilWorkspaceIdentity(await browserWorkspaceIdentityStorage.load())
  browserSourceIdentity = stored
  const authority = await refreshLocalWorkspaceAuthorityStatus()
  if (!authority) {
    return resolveOpenPencilWorkspaceIdentity(
      browserWorkspaceIdentityStorage,
      createOpenPencilWorkspaceIdentity
    )
  }
  if (stored && stored.workspaceId !== authority.identity.workspaceId) {
    const preserved = parseOpenPencilWorkspaceIdentity(
      await readCacheJson<unknown>(PRE_AUTHORITY_WORKSPACE_IDENTITY_CACHE_KEY)
    )
    if (!preserved) {
      await writeCacheJson(PRE_AUTHORITY_WORKSPACE_IDENTITY_CACHE_KEY, stored)
    }
  }
  await browserWorkspaceIdentityStorage.save(authority.identity)
  return authority.identity
}

export async function loadOpenPencilWorkspaceSourceIdentity(): Promise<OpenPencilWorkspaceIdentity> {
  const identity = await loadOpenPencilWorkspaceIdentity()
  const preserved = parseOpenPencilWorkspaceIdentity(
    await readCacheJson<unknown>(PRE_AUTHORITY_WORKSPACE_IDENTITY_CACHE_KEY)
  )
  return preserved ?? browserSourceIdentity ?? identity
}

const workspaceIdentityByGraph = new WeakMap<
  SceneGraph,
  { identity: OpenPencilWorkspaceIdentity | null; serialized: string | undefined }
>()

export function readOpenPencilWorkspaceIdentity(
  graph: SceneGraph
): OpenPencilWorkspaceIdentity | null {
  const root = graph.getNode(graph.rootId)
  const serialized = root?.pluginData.find(
    (entry) =>
      entry.pluginId === OPENPENCIL_WORKSPACE_PLUGIN_ID &&
      entry.key === OPENPENCIL_WORKSPACE_IDENTITY_KEY
  )?.value
  const cached = workspaceIdentityByGraph.get(graph)
  if (cached && cached.serialized === serialized) return cached.identity
  let identity: OpenPencilWorkspaceIdentity | null = null
  if (serialized) {
    try {
      identity = parseOpenPencilWorkspaceIdentity(JSON.parse(serialized))
    } catch {
      identity = null
    }
  }
  workspaceIdentityByGraph.set(graph, { identity, serialized })
  return identity
}

export function stampOpenPencilWorkspaceIdentity(
  graph: SceneGraph,
  identity: OpenPencilWorkspaceIdentity
): boolean {
  const root = graph.getNode(graph.rootId)
  if (!root) return false
  const serialized = JSON.stringify(identity)
  const current = root.pluginData.find(
    (entry) =>
      entry.pluginId === OPENPENCIL_WORKSPACE_PLUGIN_ID &&
      entry.key === OPENPENCIL_WORKSPACE_IDENTITY_KEY
  )
  if (current?.value === serialized) return false
  graph.updateNode(root.id, {
    pluginData: openPencilWorkspaceIdentityPluginData(root, identity)
  })
  return true
}

export function openPencilWorkspaceIdentityPluginData(
  root: SceneNode,
  identity: OpenPencilWorkspaceIdentity
): SceneNode['pluginData'] {
  return [
    ...root.pluginData.filter(
      (entry) =>
        !(
          entry.pluginId === OPENPENCIL_WORKSPACE_PLUGIN_ID &&
          entry.key === OPENPENCIL_WORKSPACE_IDENTITY_KEY
        )
    ),
    {
      key: OPENPENCIL_WORKSPACE_IDENTITY_KEY,
      pluginId: OPENPENCIL_WORKSPACE_PLUGIN_ID,
      value: JSON.stringify(identity)
    }
  ]
}

export function openPencilWorkspaceId(graph: SceneGraph): string | null {
  return readOpenPencilWorkspaceIdentity(graph)?.workspaceId ?? null
}
