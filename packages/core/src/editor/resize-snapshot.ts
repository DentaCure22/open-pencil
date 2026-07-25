import { cloneVectorNetwork, type SceneNode } from '@open-pencil/scene-graph'
import { copyEffects, copyStrokes, copyStyleRuns } from '@open-pencil/scene-graph/copy'

export type ResizeSnapshot = Pick<
  SceneNode,
  | 'x'
  | 'y'
  | 'width'
  | 'height'
  | 'vectorNetwork'
  | 'fontSize'
  | 'lineHeight'
  | 'letterSpacing'
  | 'styleRuns'
  | 'strokes'
  | 'effects'
  | 'cornerRadius'
  | 'topLeftRadius'
  | 'topRightRadius'
  | 'bottomRightRadius'
  | 'bottomLeftRadius'
  | 'dashPattern'
  | 'borderTopWeight'
  | 'borderRightWeight'
  | 'borderBottomWeight'
  | 'borderLeftWeight'
  | 'textDecorationThickness'
  | 'textUnderlineOffset'
>

export function createResizeSnapshot(node: SceneNode): ResizeSnapshot {
  return {
    x: node.x,
    y: node.y,
    width: node.width,
    height: node.height,
    vectorNetwork: node.vectorNetwork ? cloneVectorNetwork(node.vectorNetwork) : null,
    fontSize: node.fontSize,
    lineHeight: node.lineHeight,
    letterSpacing: node.letterSpacing,
    styleRuns: copyStyleRuns(node.styleRuns),
    strokes: copyStrokes(node.strokes),
    effects: copyEffects(node.effects),
    cornerRadius: node.cornerRadius,
    topLeftRadius: node.topLeftRadius,
    topRightRadius: node.topRightRadius,
    bottomRightRadius: node.bottomRightRadius,
    bottomLeftRadius: node.bottomLeftRadius,
    dashPattern: [...node.dashPattern],
    borderTopWeight: node.borderTopWeight,
    borderRightWeight: node.borderRightWeight,
    borderBottomWeight: node.borderBottomWeight,
    borderLeftWeight: node.borderLeftWeight,
    textDecorationThickness: node.textDecorationThickness,
    textUnderlineOffset: node.textUnderlineOffset
  }
}
