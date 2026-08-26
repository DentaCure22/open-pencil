import type { SceneNode } from '@open-pencil/scene-graph'

import { applyLayoutOverrides, applySizeOverrides } from './props-overrides-layout'
import {
  applyShapeAndEffectOverrides,
  applyTextOverrides,
  applyVisualOverrides,
  normalizeStyleProps
} from './props-overrides-style'

export { applySizeOverrides } from './props-overrides-layout'

export function propsToOverrides(
  props: Record<string, unknown>,
  isText: boolean,
  parentLayout: SceneNode['layoutMode']
): Partial<SceneNode> {
  const normalizedProps = normalizeStyleProps(props)
  const overrides: Partial<SceneNode> = {}

  if (normalizedProps.name) overrides.name = normalizedProps.name as string

  const { w, h } = applySizeOverrides(normalizedProps, overrides, parentLayout)
  applyVisualOverrides(normalizedProps, overrides)
  applyLayoutOverrides(normalizedProps, overrides, w, h, isText, parentLayout)
  if (isText) applyTextOverrides(normalizedProps, overrides, parentLayout)
  applyShapeAndEffectOverrides(normalizedProps, overrides)

  return overrides
}
