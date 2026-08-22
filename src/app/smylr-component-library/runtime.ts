import type { SceneNode } from '@open-pencil/scene-graph'

import { codeObjectDocument, isCodeObjectFrame } from '@/app/code-object/model'

const PLUGIN_ID = 'smylr-production'
export const SMYLR_COMPONENT_CODE_OBJECT_KIND = 'smylr-component-code-object'
export const SMYLR_COMPONENT_SURFACE_INSET = 12

type SmylrComponentSurfaceDimensions = {
  frameHeight: number
  interactionHeight: number
  overlayHeight: number
}

export type SmylrComponentViewport = {
  height: number
  interactionHeight: number
  inset: number
  width: number
}

function pluginValue(node: SceneNode, key: string): string | undefined {
  return node.pluginData.find((entry) => entry.pluginId === PLUGIN_ID && entry.key === key)?.value
}

function positiveNumber(value: string | undefined): number | null {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null
}

export function smylrComponentSurfaceHeight(
  dimensions: SmylrComponentSurfaceDimensions,
  inset = SMYLR_COMPONENT_SURFACE_INSET
) {
  return dimensions.interactionHeight > dimensions.overlayHeight
    ? Math.max(
        dimensions.frameHeight,
        dimensions.overlayHeight + dimensions.interactionHeight + inset * 2
      )
    : dimensions.frameHeight
}

export function isSmylrComponentCodeObject(node: SceneNode | null | undefined) {
  return Boolean(
    isCodeObjectFrame(node) &&
    node &&
    pluginValue(node, 'componentKind') === SMYLR_COMPONENT_CODE_OBJECT_KIND &&
    codeObjectDocument(node)?.component === 'smylr-production-app'
  )
}

export function smylrComponentDisplayName(node: SceneNode) {
  const componentName = pluginValue(node, 'componentName') ?? node.name.split(' / ')[0]
  const variantLabel = pluginValue(node, 'variantLabel')
  return variantLabel ? `${componentName} · ${variantLabel}` : componentName
}

export function smylrComponentViewport(
  node: SceneNode | null | undefined
): SmylrComponentViewport | null {
  if (!node || !isSmylrComponentCodeObject(node)) return null
  const inset = positiveNumber(pluginValue(node, 'surfaceInset')) ?? SMYLR_COMPONENT_SURFACE_INSET
  const overlayWidth = positiveNumber(pluginValue(node, 'overlayWidth'))
  const overlayHeight = positiveNumber(pluginValue(node, 'overlayHeight'))
  const frameWidth = positiveNumber(pluginValue(node, 'frameWidth'))
  const frameHeight = positiveNumber(pluginValue(node, 'frameHeight'))
  const interactionHeight = positiveNumber(pluginValue(node, 'interactionHeight'))
  if (!overlayWidth || !overlayHeight || !frameWidth || !frameHeight || !interactionHeight) {
    return null
  }
  const surfaceHeight = smylrComponentSurfaceHeight(
    { frameHeight, interactionHeight, overlayHeight },
    inset
  )
  return {
    height: surfaceHeight,
    inset,
    interactionHeight: surfaceHeight,
    width: frameWidth
  }
}

export function smylrComponentRuntimeHeight(node: SceneNode, interactionEnabled: boolean): number {
  const viewport = smylrComponentViewport(node)
  return interactionEnabled && viewport
    ? Math.max(node.height, viewport.interactionHeight)
    : node.height
}
