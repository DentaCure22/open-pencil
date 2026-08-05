import { Handle, useUpdateNodeInternals, type NodeProps } from '@xyflow/react'
import { useEffect } from 'react'

import type { ObjectGraphReactNode } from '@/app/object-graph/react-flow'

export function OpenPencilObjectGraphNode({ data, id }: NodeProps<ObjectGraphReactNode>) {
  const updateNodeInternals = useUpdateNodeInternals()
  useEffect(() => {
    updateNodeInternals(id)
  }, [data.ports, id, updateNodeInternals])

  return (
    <div
      className="group size-full"
      data-object-name={data.name}
      data-test-id={`react-flow-node-${id}`}
    >
      {Object.values(data.ports).map((port) => {
        const endpoint = data.endpoint?.handleId === port.handleId ? data.endpoint : undefined
        const style = {
          bottom: 'auto',
          left: port.x,
          right: 'auto',
          top: port.y,
          transform: 'translate(-50%, -50%)'
        }
        return (
          <Handle
            className={[
              'openpencil-object-graph-handle dark:border-secondary dark:bg-secondary h-[11px] w-[11px] rounded-full border border-slate-300 bg-slate-100 transition',
              port.legacy ? '' : 'openpencil-object-graph-handle-named',
              port.legacy && Object.keys(data.ports).length > 4
                ? 'openpencil-object-graph-handle-legacy'
                : '',
              data.showHandles ? 'openpencil-object-graph-handle-active' : '',
              endpoint ? 'openpencil-object-graph-endpoint' : ''
            ].join(' ')}
            aria-label={port.label}
            id={port.handleId}
            isConnectable
            key={port.handleId}
            position={port.position}
            style={style}
            type={port.direction === 'input' ? 'target' : 'source'}
            data-test-id={endpoint ? `react-flow-endpoint-${endpoint.role}-${id}` : undefined}
          />
        )
      })}
    </div>
  )
}
