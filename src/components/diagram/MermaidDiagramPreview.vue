<script setup lang="ts">
import { computed, type CSSProperties } from 'vue'

import type { Fill, SceneNode, Stroke, VectorNetwork } from '@open-pencil/scene-graph'
import type { MermaidSceneNodeSpec, MermaidSceneSpec } from '@open-pencil/core/diagram'
import { colorToCSSCompact } from '@open-pencil/core/color'
import { vectorNetworkToSVGPaths } from '@open-pencil/core/io/formats/svg'

const { diagram } = defineProps<{ diagram: MermaidSceneSpec }>()

interface PreviewGradient {
  id: string
  paint: Fill
  startX: number
  startY: number
  endX: number
  endY: number
}

function gradientId(node: MermaidSceneNodeSpec, kind: 'fill' | 'stroke'): string {
  return `mermaid-${kind}-${node.key.replaceAll(/[^a-zA-Z0-9_-]/g, '-')}`
}

function previewGradient(
  node: MermaidSceneNodeSpec,
  kind: 'fill' | 'stroke',
  paint: Fill | undefined
): PreviewGradient | null {
  const transform = paint?.gradientTransform
  if (!paint?.type.startsWith('GRADIENT') || !paint.gradientStops || !transform) return null
  return {
    id: gradientId(node, kind),
    paint,
    startX: transform.m00 + transform.m02,
    startY: transform.m10 + transform.m12,
    endX: transform.m02,
    endY: transform.m12
  }
}

const gradients = computed(() =>
  diagram.nodes.flatMap((node) => {
    const fill = previewGradient(node, 'fill', node.props.fills?.[0])
    const stroke = previewGradient(node, 'stroke', node.props.strokes?.[0]?.paint)
    return [fill, stroke].filter((gradient): gradient is PreviewGradient => gradient !== null)
  })
)

function fillColor(fill: Fill | undefined, node?: MermaidSceneNodeSpec): string {
  if (!fill?.visible) return 'none'
  if (node && fill.type.startsWith('GRADIENT')) return `url(#${gradientId(node, 'fill')})`
  return colorToCSSCompact(fill.color)
}

function strokeColor(stroke: Stroke | undefined, node?: MermaidSceneNodeSpec): string {
  if (!stroke?.visible) return 'none'
  if (node && stroke.paint?.type.startsWith('GRADIENT')) {
    return `url(#${gradientId(node, 'stroke')})`
  }
  return colorToCSSCompact(stroke.color)
}

function dashArray(stroke: Stroke | undefined): string | undefined {
  return stroke?.dashPattern?.length ? stroke.dashPattern.join(' ') : undefined
}

function vectorPath(network: VectorNetwork | null | undefined): string {
  return network ? vectorNetworkToSVGPaths(network).join(' ') : ''
}

function isClosedVector(node: MermaidSceneNodeSpec): boolean {
  return Boolean(node.props.vectorNetwork?.regions.length)
}

function textStyle(node: MermaidSceneNodeSpec): CSSProperties {
  const align: Record<SceneNode['textAlignHorizontal'], CSSProperties['textAlign']> = {
    LEFT: 'left',
    CENTER: 'center',
    RIGHT: 'right',
    JUSTIFIED: 'justify'
  }
  const justify: Record<SceneNode['textAlignVertical'], CSSProperties['justifyContent']> = {
    TOP: 'flex-start',
    CENTER: 'center',
    BOTTOM: 'flex-end'
  }
  return {
    alignItems: 'stretch',
    color: fillColor(node.props.fills?.[0]),
    display: 'flex',
    fontFamily: 'Inter, ui-sans-serif, system-ui, sans-serif',
    fontSize: `${node.props.fontSize ?? 14}px`,
    fontWeight: node.props.fontWeight ?? 400,
    height: '100%',
    justifyContent: justify[node.props.textAlignVertical ?? 'TOP'],
    lineHeight: `${node.props.lineHeight ?? (node.props.fontSize ?? 14) * 1.25}px`,
    overflow: 'hidden',
    textAlign: align[node.props.textAlignHorizontal ?? 'LEFT'],
    whiteSpace: 'pre-wrap',
    width: '100%'
  }
}

function nodeStyle(node: MermaidSceneNodeSpec): CSSProperties {
  const mode = node.props.blendMode
  return mode && mode !== 'NORMAL' && mode !== 'PASS_THROUGH'
    ? { mixBlendMode: mode.toLowerCase().replaceAll('_', '-') as CSSProperties['mixBlendMode'] }
    : {}
}

function strokeLineCap(stroke: Stroke | undefined): 'butt' | 'round' | 'square' {
  if (stroke?.cap === 'ROUND') return 'round'
  if (stroke?.cap === 'SQUARE') return 'square'
  return 'butt'
}

function strokeLineJoin(stroke: Stroke | undefined): 'bevel' | 'miter' | 'round' {
  if (stroke?.join === 'ROUND') return 'round'
  if (stroke?.join === 'BEVEL') return 'bevel'
  return 'miter'
}
</script>

<template>
  <svg
    data-test-id="mermaid-preview"
    class="size-full isolate"
    :viewBox="`0 0 ${Math.max(1, diagram.width)} ${Math.max(1, diagram.height)}`"
    preserveAspectRatio="xMidYMid meet"
    role="img"
    aria-label="Mermaid diagram preview"
  >
    <defs>
      <template v-for="gradient in gradients" :key="gradient.id">
        <linearGradient
          v-if="gradient.paint.type === 'GRADIENT_LINEAR'"
          :id="gradient.id"
          gradientUnits="objectBoundingBox"
          :x1="gradient.startX"
          :y1="gradient.startY"
          :x2="gradient.endX"
          :y2="gradient.endY"
        >
          <stop
            v-for="stop in gradient.paint.gradientStops"
            :key="stop.position"
            :offset="stop.position"
            :stop-color="colorToCSSCompact(stop.color)"
          />
        </linearGradient>
        <radialGradient
          v-else
          :id="gradient.id"
          gradientUnits="objectBoundingBox"
          cx="0.5"
          cy="0.5"
          r="0.5"
        >
          <stop
            v-for="stop in gradient.paint.gradientStops"
            :key="stop.position"
            :offset="stop.position"
            :stop-color="colorToCSSCompact(stop.color)"
          />
        </radialGradient>
      </template>
    </defs>
    <g
      v-for="node in diagram.nodes"
      :key="node.key"
      :transform="`translate(${node.props.x ?? 0} ${node.props.y ?? 0})`"
      :style="nodeStyle(node)"
    >
      <rect
        v-if="node.type === 'RECTANGLE'"
        x="0"
        y="0"
        :width="node.props.width"
        :height="node.props.height"
        :rx="node.props.cornerRadius"
        :fill="fillColor(node.props.fills?.[0], node)"
        :fill-opacity="node.props.fills?.[0]?.opacity"
        :stroke="strokeColor(node.props.strokes?.[0], node)"
        :stroke-width="node.props.strokes?.[0]?.weight"
        :stroke-opacity="node.props.strokes?.[0]?.opacity"
        :stroke-dasharray="dashArray(node.props.strokes?.[0])"
      />
      <ellipse
        v-else-if="node.type === 'ELLIPSE'"
        :cx="(node.props.width ?? 0) / 2"
        :cy="(node.props.height ?? 0) / 2"
        :rx="(node.props.width ?? 0) / 2"
        :ry="(node.props.height ?? 0) / 2"
        :fill="fillColor(node.props.fills?.[0], node)"
        :fill-opacity="node.props.fills?.[0]?.opacity"
        :stroke="strokeColor(node.props.strokes?.[0], node)"
        :stroke-width="node.props.strokes?.[0]?.weight"
        :stroke-opacity="node.props.strokes?.[0]?.opacity"
        :stroke-dasharray="dashArray(node.props.strokes?.[0])"
      />
      <path
        v-else-if="node.type === 'VECTOR'"
        :d="vectorPath(node.props.vectorNetwork)"
        :fill="isClosedVector(node) ? fillColor(node.props.fills?.[0], node) : 'none'"
        :fill-opacity="node.props.fills?.[0]?.opacity"
        :stroke="strokeColor(node.props.strokes?.[0], node)"
        :stroke-width="node.props.strokes?.[0]?.weight"
        :stroke-opacity="node.props.strokes?.[0]?.opacity"
        :stroke-dasharray="dashArray(node.props.strokes?.[0])"
        :stroke-linecap="strokeLineCap(node.props.strokes?.[0])"
        :stroke-linejoin="strokeLineJoin(node.props.strokes?.[0])"
      />
      <foreignObject
        v-else-if="node.type === 'TEXT'"
        x="0"
        y="0"
        :width="node.props.width"
        :height="node.props.height"
      >
        <div xmlns="http://www.w3.org/1999/xhtml" :style="textStyle(node)">
          {{ node.props.text }}
        </div>
      </foreignObject>
    </g>
  </svg>
</template>
