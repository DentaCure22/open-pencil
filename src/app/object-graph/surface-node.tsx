import { Handle, useUpdateNodeInternals, type NodeProps } from '@xyflow/react'
import { useLayoutEffect, type CSSProperties } from 'react'

import { OBJECT_GRAPH_PORT_SIDES } from '@/app/object-graph/projection'
import { objectGraphHandleId, type ObjectGraphReactNode } from '@/app/object-graph/react-flow'

type ObjectGraphPortStyle = CSSProperties & {
  '--openpencil-object-graph-port-offset-x': string
  '--openpencil-object-graph-port-offset-y': string
}

const PORT_VISUAL_OFFSET = 8

export function OpenPencilObjectGraphNode({ data, id }: NodeProps<ObjectGraphReactNode>) {
  const updateNodeInternals = useUpdateNodeInternals()
  useLayoutEffect(() => {
    updateNodeInternals(id)
  }, [data.ports, id, updateNodeInternals])

  return (
    <div
      className="group size-full"
      data-object-name={data.name}
      data-test-id={`react-flow-node-${id}`}
    >
      {OBJECT_GRAPH_PORT_SIDES.map((side) => {
        const port = data.ports[side]
        const style: ObjectGraphPortStyle = {
          '--openpencil-object-graph-port-offset-x': `${port.normal.x * PORT_VISUAL_OFFSET}px`,
          '--openpencil-object-graph-port-offset-y': `${port.normal.y * PORT_VISUAL_OFFSET}px`,
          bottom: 'auto',
          left: port.x,
          right: 'auto',
          top: port.y,
          transform: 'translate(-50%, -50%) scale(var(--openpencil-object-graph-inverse-zoom))'
        }
        return (
          <Handle
            className={[
              'openpencil-object-graph-handle',
              data.showHandles ? 'openpencil-object-graph-handle-active' : ''
            ].join(' ')}
            id={objectGraphHandleId(side)}
            isConnectable
            key={side}
            position={port.position}
            style={style}
            type="source"
          >
            <span aria-hidden="true" className="openpencil-object-graph-handle-dot" />
          </Handle>
        )
      })}
    </div>
  )
}
