import type { Rect } from '@open-pencil/scene-graph'

import {
  parsePlacementDirections,
  type BoardFreePlacementTarget,
  type BoardPlacementDirection,
  type BoardPlacementResult
} from '@/app/automation/bridge/board-tools/placement'
import { mutationRequestSignature } from '@/app/automation/bridge/request-receipts'
import { isUnknownRecord } from '@/app/automation/bridge/target'

import {
  boundedCodeObjectNumber,
  boundedCodeObjectString,
  normalizeCodeObjectMutation,
  plainCodeObjectRecord,
  type CodeObjectMutationIdentity,
  type CodeObjectNextAction,
  type CodeObjectReadback,
  type CodeObjectResultStatus,
  type CodeObjectRuntimeProof,
  type CodeObjectSemanticOwner
} from '../contract'
import {
  assertSafeCodeObjectSource,
  CODE_OBJECT_CONTENT_ROUTE,
  codeObjectSourceHash,
  MAX_CODE_OBJECT_SOURCE_LENGTH
} from '../source'

export const CODE_OBJECT_CREATE_ROUTE = 'upsert_code_object' as const

const DEFAULT_CLEARANCE = 48
const DEFAULT_DIRECTIONS: BoardPlacementDirection[] = ['right', 'below', 'left', 'above']
const MAX_NAME_LENGTH = 120
const MAX_OBJECT_KEY_LENGTH = 160

type CodeObjectCreatePlacement = {
  clearance: number
  preferred_directions: BoardPlacementDirection[]
  target?: BoardFreePlacementTarget
}

export type AutomationCodeObjectCreateArgs = {
  anchor_id?: string
  height: number
  mutation: CodeObjectMutationIdentity
  name: string
  object_key: string
  persist: false
  placement: CodeObjectCreatePlacement
  props: Record<string, unknown>
  source: string
  state: Record<string, unknown>
  width: number
  zoom: false
}

export type CodeObjectExpectedReadback = {
  bounds: Rect
  contentHash: string
  name: string
  objectKey: string
  ownerId: string
  sourceHash: string
}

export type CodeObjectCreateIntent = {
  contentHash: string
  inputDigest: string
  requestId: string
  route: typeof CODE_OBJECT_CREATE_ROUTE
  sourceHash: string
  taskId?: string
  traceId?: string
}

type CodeObjectCreateComponent = {
  name: string
  object_key: string
  props: Record<string, unknown>
  source_hash: string
  source_length: number
  state: Record<string, unknown>
}

type CodeObjectCreateExpected = {
  content_hash: string
  object_key: string
  owner_id: string
  source_hash: string
}

export type CodeObjectCreateReadback = CodeObjectReadback<
  CodeObjectCreateComponent,
  CodeObjectCreateExpected
>

export type AutomationCodeObjectCreateResult = {
  next_action?: CodeObjectNextAction
  owner_id: string
  placement?: BoardPlacementResult
  proof?: CodeObjectRuntimeProof
  readback: { code_object: CodeObjectCreateReadback }
  receipt: Record<string, unknown>
  semantic_owner: CodeObjectSemanticOwner
  status: CodeObjectResultStatus<'applied' | 'not_applied' | 'replayed'>
}

export function normalizeCodeObjectCreateArgs(
  rawArgs: AutomationCodeObjectCreateArgs
): AutomationCodeObjectCreateArgs {
  if (!isUnknownRecord(rawArgs)) throw new Error('Code Object create arguments must be an object.')
  const mutation = normalizeCodeObjectMutation(rawArgs.mutation, 'create')
  if (!isUnknownRecord(rawArgs.placement)) {
    throw new Error('Code Object create requires a normalized placement object.')
  }
  if (rawArgs.zoom !== false || rawArgs.persist !== false) {
    throw new Error(
      'Code Object create requires zoom:false and persist:false; the facade owns presentation and persistence.'
    )
  }
  const anchorId =
    rawArgs.anchor_id === undefined
      ? undefined
      : boundedCodeObjectString(rawArgs.anchor_id, 'anchor_id', 240)
  const placementTarget = normalizePlacementTarget(rawArgs.placement.target)
  if (Boolean(anchorId) === Boolean(placementTarget)) {
    throw new Error('Code Object create requires exactly one of anchor_id or placement.target.')
  }
  return {
    ...(anchorId ? { anchor_id: anchorId } : {}),
    height: boundedCodeObjectNumber(rawArgs.height, 'height', 160, 1_200),
    mutation,
    name: boundedCodeObjectString(rawArgs.name, 'name', MAX_NAME_LENGTH),
    object_key: boundedCodeObjectString(rawArgs.object_key, 'object_key', MAX_OBJECT_KEY_LENGTH),
    persist: false,
    placement: {
      clearance: boundedCodeObjectNumber(
        rawArgs.placement.clearance ?? DEFAULT_CLEARANCE,
        'placement.clearance',
        0,
        512
      ),
      preferred_directions: parsePlacementDirections(
        rawArgs.placement.preferred_directions ?? DEFAULT_DIRECTIONS
      ),
      ...(placementTarget ? { target: placementTarget } : {})
    },
    props: plainCodeObjectRecord(rawArgs.props, 'props'),
    source: boundedCodeObjectString(rawArgs.source, 'source', MAX_CODE_OBJECT_SOURCE_LENGTH),
    state: plainCodeObjectRecord(rawArgs.state, 'state'),
    width: boundedCodeObjectNumber(rawArgs.width, 'width', 240, 1_600),
    zoom: false
  }
}

function placementCoordinate(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new TypeError(`placement.target.${field} must be a finite number.`)
  }
  return value
}

function normalizePlacementTarget(value: unknown): BoardFreePlacementTarget | undefined {
  if (value === undefined) return undefined
  if (!isUnknownRecord(value)) throw new Error('placement.target must be an object.')
  if (value.kind === 'auto') {
    if (Object.keys(value).some((key) => key !== 'kind')) {
      throw new Error('placement.target auto contains unsupported fields.')
    }
    return { kind: 'auto' }
  }
  if (value.kind === 'relative') {
    if (Object.keys(value).some((key) => !['kind', 'object_id'].includes(key))) {
      throw new Error('placement.target relative contains unsupported fields.')
    }
    if (typeof value.object_id !== 'string' || !value.object_id.trim()) {
      throw new Error('placement.target.object_id must be a non-empty string.')
    }
    return { kind: 'relative', objectId: value.object_id.trim() }
  }
  const x = placementCoordinate(value.x, 'x')
  const y = placementCoordinate(value.y, 'y')
  if (value.kind === 'point') {
    if (Object.keys(value).some((key) => !['kind', 'x', 'y'].includes(key))) {
      throw new Error('placement.target point contains unsupported fields.')
    }
    return { kind: 'point', x, y }
  }
  if (value.kind === 'region') {
    if (Object.keys(value).some((key) => !['height', 'kind', 'width', 'x', 'y'].includes(key))) {
      throw new Error('placement.target region contains unsupported fields.')
    }
    const width = placementCoordinate(value.width, 'width')
    const height = placementCoordinate(value.height, 'height')
    if (width <= 0 || height <= 0) {
      throw new Error('placement.target region width and height must be positive.')
    }
    return { height, kind: 'region', width, x, y }
  }
  throw new Error('placement.target.kind must be auto, point, relative, or region.')
}

export function assertSafeCodeObjectCreateSource(source: string): void {
  assertSafeCodeObjectSource(source)
}

export { CODE_OBJECT_CONTENT_ROUTE, codeObjectSourceHash }

export async function createCodeObjectIntent(
  args: AutomationCodeObjectCreateArgs
): Promise<CodeObjectCreateIntent> {
  const taskId = args.mutation.task_id
  const traceId = args.mutation.trace_id
  const contentInput = {
    name: args.name,
    object_key: args.object_key,
    props: args.props,
    source: args.source,
    state: args.state
  }
  const [contentHash, inputDigest, sourceHash] = await Promise.all([
    mutationRequestSignature(CODE_OBJECT_CONTENT_ROUTE, contentInput),
    mutationRequestSignature(CODE_OBJECT_CREATE_ROUTE, {
      ...(args.anchor_id ? { anchor_id: args.anchor_id } : {}),
      artifact: { height: args.height, ...contentInput, width: args.width },
      placement: args.placement,
      ...(taskId ? { task_id: taskId } : {}),
      ...(traceId ? { trace_id: traceId } : {})
    }),
    codeObjectSourceHash(args.source)
  ])
  return {
    contentHash,
    inputDigest,
    requestId: args.mutation.request_id,
    route: CODE_OBJECT_CREATE_ROUTE,
    sourceHash,
    ...(taskId ? { taskId } : {}),
    ...(traceId ? { traceId } : {})
  }
}
