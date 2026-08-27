import type { getAbsolutePositionFull } from './coordinate'
import type { Vector } from './primitives'

export const OBJECT_GRAPH_PLUGIN_ID = 'openpencil-object-graph'
export const OBJECT_GRAPH_SCHEMA_VERSION = 1 as const

export type ObjectGraphConnectionKind = 'action' | 'data' | 'visual'
export type ObjectGraphPortDirection = 'both' | 'input' | 'output'
export type ObjectGraphPortSide = 'auto' | 'bottom' | 'left' | 'right' | 'top'
export type ObjectGraphPermission = 'target.action.execute' | 'target.data.write'

export const OBJECT_GRAPH_PORT_SIDES = ['top', 'right', 'bottom', 'left'] as const

export type ObjectGraphFixedPortSide = Exclude<ObjectGraphPortSide, 'auto'>

export type ObjectGraphPortAnchor = {
  normal: Vector
  point: Vector
}

export type ObjectGraphPortDefinition = {
  direction: ObjectGraphPortDirection
  id: string
  kinds: ObjectGraphConnectionKind[]
  label: string
  offset: number
  side: ObjectGraphFixedPortSide
}

export type ObjectGraphNamedPortProjection = ObjectGraphPortAnchor & {
  definition: ObjectGraphPortDefinition
}

export type ObjectGraphNodeProjection = {
  bounds: ReturnType<typeof getAbsolutePositionFull>
  corners: [Vector, Vector, Vector, Vector]
  namedPorts: Record<string, ObjectGraphNamedPortProjection>
  ports: Record<ObjectGraphFixedPortSide, ObjectGraphPortAnchor>
}

export type ResolvedObjectGraphPortSides = {
  source: ObjectGraphFixedPortSide
  target: ObjectGraphFixedPortSide
}

export type ResolvedObjectGraphPort = {
  anchor: ObjectGraphPortAnchor
  id?: string
  side: ObjectGraphFixedPortSide
}

export type ResolvedObjectGraphPorts = {
  source: ResolvedObjectGraphPort
  target: ResolvedObjectGraphPort
}

export type ObjectGraphAction =
  | { type: 'hide' }
  | { opacity: number; type: 'set-opacity' }
  | { type: 'show' }
  | { type: 'toggle-opacity' }

export type ObjectGraphSignal =
  | { kind: 'action'; action: ObjectGraphAction }
  | { kind: 'data'; value: unknown }

export interface ObjectGraphInputEnvelope {
  connectionId: string
  sourceNodeId: string
  value: unknown
}

export interface ObjectGraphConnection {
  automatic: boolean
  id: string
  kind: ObjectGraphConnectionKind
  label: string
  permissions: ObjectGraphPermission[]
  schemaVersion: typeof OBJECT_GRAPH_SCHEMA_VERSION
  sourceNodeId: string
  sourcePort: ObjectGraphPortSide
  sourcePortId?: string
  targetNodeId: string
  targetPort: ObjectGraphPortSide
  targetPortId?: string
}
