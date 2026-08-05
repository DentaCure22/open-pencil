import { BezierEdge, type EdgeProps } from '@xyflow/react'

import type { ObjectGraphReactEdge } from '@/app/object-graph/react-flow'

export function OpenPencilObjectGraphEdge(props: EdgeProps<ObjectGraphReactEdge>) {
  return <BezierEdge {...props} />
}
