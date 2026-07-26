import {
  BaseEdge,
  EdgeLabelRenderer,
  useViewport,
  type EdgeProps,
  type Position
} from '@xyflow/react'

import { objectGraphArrowRotation, objectGraphEdgeGeometry } from '@/app/object-graph/edge-geometry'
import type { ObjectGraphPortAnchor } from '@/app/object-graph/projection'
import { OBJECT_GRAPH_KIND_COLORS, type ObjectGraphReactEdge } from '@/app/object-graph/react-flow'

const EDGE_HIT_WIDTH = 28
const MIN_VISIBLE_STROKE_WIDTH = 1.5
const ARROW_LENGTH = 18
const ARROW_HALF_WIDTH = 6

function normalForPosition(position: Position): ObjectGraphPortAnchor['normal'] {
  if (position === 'top') return { x: 0, y: -1 }
  if (position === 'right') return { x: 1, y: 0 }
  if (position === 'bottom') return { x: 0, y: 1 }
  return { x: -1, y: 0 }
}

export function OpenPencilObjectGraphEdge({
  data,
  id,
  selected,
  sourcePosition,
  sourceX,
  sourceY,
  style,
  targetPosition,
  targetX,
  targetY
}: EdgeProps<ObjectGraphReactEdge>) {
  const { zoom } = useViewport()
  const sourceAnchor = data?.sourceAnchor ?? {
    normal: normalForPosition(sourcePosition),
    point: { x: sourceX, y: sourceY }
  }
  const targetAnchor = data?.targetAnchor ?? {
    normal: normalForPosition(targetPosition),
    point: { x: targetX, y: targetY }
  }
  const geometry = objectGraphEdgeGeometry(sourceAnchor, targetAnchor)
  const kind = data?.kind ?? 'visual'
  const label = data?.label ?? kind
  const color = OBJECT_GRAPH_KIND_COLORS[kind]
  const arrowRotation = objectGraphArrowRotation(targetAnchor)
  const visualScale = data?.visualScale ?? 1
  let baseStrokeWidth = kind === 'visual' ? 2 : 2.5
  if (selected) baseStrokeWidth = 3.5
  const visibleStrokeWidth = Math.max(
    MIN_VISIBLE_STROKE_WIDTH,
    baseStrokeWidth * zoom * visualScale
  )

  return (
    <>
      <BaseEdge
        id={id}
        interactionWidth={0}
        path={geometry.path}
        style={{
          ...style,
          filter: selected
            ? `drop-shadow(0 0 7px ${color})`
            : 'drop-shadow(0 2px 3px rgb(0 0 0 / 0.55))',
          strokeLinecap: 'round',
          strokeWidth: visibleStrokeWidth,
          vectorEffect: 'non-scaling-stroke'
        }}
      />
      <path
        className="react-flow__edge-interaction"
        d={geometry.path}
        fill="none"
        stroke="transparent"
        strokeWidth={EDGE_HIT_WIDTH}
        vectorEffect="non-scaling-stroke"
      />
      <g
        aria-hidden="true"
        className="openpencil-object-graph-arrow"
        data-object-scale={visualScale}
        pointerEvents="none"
        transform={[
          `translate(${targetAnchor.point.x} ${targetAnchor.point.y})`,
          `rotate(${arrowRotation})`,
          `scale(${visualScale})`
        ].join(' ')}
      >
        <path
          d={`M 0 0 L ${-ARROW_LENGTH} ${-ARROW_HALF_WIDTH} L ${-ARROW_LENGTH} ${ARROW_HALF_WIDTH} Z`}
          fill={color}
        />
      </g>
      <EdgeLabelRenderer>
        <div
          className={[
            'nodrag nopan pointer-events-auto absolute flex items-center gap-1.5 rounded-full border bg-[#121419]/95 px-2 py-1 shadow-xl backdrop-blur-xl',
            selected ? 'border-white/30 text-white' : 'border-white/10 text-slate-300'
          ].join(' ')}
          data-object-scale={visualScale}
          data-test-id={`react-flow-edge-label-${id}`}
          style={{
            transform: [
              'translate(-50%, -50%)',
              `translate(${geometry.label.x}px, ${geometry.label.y}px)`,
              `scale(${visualScale})`
            ].join(' ')
          }}
        >
          <span className="size-1.5 rounded-full" style={{ background: color }} />
          <span className="max-w-32 truncate text-[9px] font-bold capitalize">{label}</span>
          {selected ? (
            <button
              aria-label={`Delete ${kind} connection`}
              className="ml-0.5 flex size-4 items-center justify-center rounded-full bg-white/8 text-[10px] leading-none text-slate-300 hover:bg-rose-400/20 hover:text-rose-200"
              data-test-id={`react-flow-edge-delete-${id}`}
              type="button"
              onClick={() => data?.onDisconnect?.(id)}
            >
              ×
            </button>
          ) : null}
        </div>
      </EdgeLabelRenderer>
    </>
  )
}
