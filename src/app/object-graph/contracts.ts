import type {
  ObjectGraphConnection,
  ObjectGraphConnectionKind,
  ObjectGraphPortSide,
  ObjectGraphSignal
} from '@open-pencil/scene-graph'

export type ConnectObjectsInput = {
  automatic?: boolean
  kind: ObjectGraphConnectionKind
  label?: string
  sourceNodeId: string
  sourcePort?: ObjectGraphPortSide
  targetNodeId: string
  targetPort?: ObjectGraphPortSide
}

export type ObjectGraphDeliveryStatus = 'applied' | 'denied' | 'noop'

export type ObjectGraphDelivery = {
  connectionId: string
  reason?: 'invalid-payload' | 'permission-denied' | 'target-missing' | 'unsupported-action'
  status: ObjectGraphDeliveryStatus
  targetNodeId: string
}

export type ObjectGraphSignalReceipt = {
  changed: boolean
  deliveries: ObjectGraphDelivery[]
  signal: ObjectGraphSignal
  sourceNodeId: string
}

export type ObjectGraphConnectionSnapshot = {
  connection: ObjectGraphConnection
  incoming: boolean
  nodeId: string
  outgoing: boolean
  peerName: string
}
