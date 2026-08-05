export { constrainToAspectRatio } from '#vue/shared/input/resize/rect'
export { tryStartResize } from '#vue/shared/input/resize/start'
import { createResizeSnapshot, type Editor, type ResizeSnapshot } from '@open-pencil/core/editor'
import { computeLayout } from '@open-pencil/core/layout'
import { cloneVectorNetwork, type SceneNode } from '@open-pencil/scene-graph'

import { calculateResizeRect } from '#vue/shared/input/resize/rect'
import { scaleVectorNetworkForResize } from '#vue/shared/input/resize/vector'
import type { DragResize } from '#vue/shared/input/types'

function resizeChanges(d: DragResize, cx: number, cy: number, constrain: boolean) {
  const { origRect } = d
  const newRect = calculateResizeRect(
    d.handle,
    origRect,
    cx - d.startX,
    cy - d.startY,
    constrain || d.proportional
  )

  const changes: Partial<SceneNode> = { ...newRect }

  const resizedVectorNetwork = scaleVectorNetworkForResize(
    d.origVectorNetwork,
    origRect.width,
    origRect.height,
    newRect.width,
    newRect.height
  )
  if (resizedVectorNetwork) changes.vectorNetwork = resizedVectorNetwork
  return { changes, newRect }
}

function scaleNullable(value: number | null, scale: number): number | null {
  return value === null ? null : value * scale
}

function scaledChildSnapshot(
  original: ResizeSnapshot,
  scaleX: number,
  scaleY: number
): ResizeSnapshot {
  const visualScale = (Math.abs(scaleX) + Math.abs(scaleY)) / 2
  const width = Math.round(Math.max(1, original.width * scaleX))
  const height = Math.round(Math.max(1, original.height * scaleY))
  const vectorNetwork = scaleVectorNetworkForResize(
    original.vectorNetwork,
    original.width,
    original.height,
    width,
    height
  )

  return {
    ...original,
    x: Math.round(original.x * scaleX),
    y: Math.round(original.y * scaleY),
    width,
    height,
    vectorNetwork:
      vectorNetwork ?? (original.vectorNetwork ? cloneVectorNetwork(original.vectorNetwork) : null),
    fontSize: original.fontSize * visualScale,
    lineHeight: scaleNullable(original.lineHeight, visualScale),
    letterSpacing: original.letterSpacing * visualScale,
    styleRuns: original.styleRuns.map((run) => ({
      ...run,
      style: {
        ...run.style,
        fontSize: run.style.fontSize === undefined ? undefined : run.style.fontSize * visualScale,
        lineHeight:
          run.style.lineHeight === undefined
            ? undefined
            : scaleNullable(run.style.lineHeight, visualScale),
        letterSpacing:
          run.style.letterSpacing === undefined ? undefined : run.style.letterSpacing * visualScale,
        textDecorationThickness:
          run.style.textDecorationThickness === undefined
            ? undefined
            : scaleNullable(run.style.textDecorationThickness, visualScale),
        textUnderlineOffset:
          run.style.textUnderlineOffset === undefined
            ? undefined
            : scaleNullable(run.style.textUnderlineOffset, visualScale)
      }
    })),
    strokes: original.strokes.map((stroke) => ({
      ...stroke,
      weight: stroke.weight * visualScale,
      dashPattern: stroke.dashPattern?.map((value) => value * visualScale)
    })),
    effects: original.effects.map((effect) => ({
      ...effect,
      offset: { x: effect.offset.x * scaleX, y: effect.offset.y * scaleY },
      radius: effect.radius * visualScale,
      spread: effect.spread * visualScale
    })),
    cornerRadius: original.cornerRadius * visualScale,
    topLeftRadius: original.topLeftRadius * visualScale,
    topRightRadius: original.topRightRadius * visualScale,
    bottomRightRadius: original.bottomRightRadius * visualScale,
    bottomLeftRadius: original.bottomLeftRadius * visualScale,
    dashPattern: original.dashPattern.map((value) => value * visualScale),
    borderTopWeight: original.borderTopWeight * visualScale,
    borderRightWeight: original.borderRightWeight * visualScale,
    borderBottomWeight: original.borderBottomWeight * visualScale,
    borderLeftWeight: original.borderLeftWeight * visualScale,
    textDecorationThickness: scaleNullable(original.textDecorationThickness, visualScale),
    textUnderlineOffset: scaleNullable(original.textUnderlineOffset, visualScale)
  }
}

export function applyResize(
  d: DragResize,
  cx: number,
  cy: number,
  constrain: boolean,
  editor: Editor
) {
  const { changes, newRect } = resizeChanges(d, cx, cy, constrain)
  editor.graph.updateNodePreview(d.nodeId, changes)

  if (d.origChildren && d.origRect.width > 0 && d.origRect.height > 0) {
    const sx = newRect.width / d.origRect.width
    const sy = newRect.height / d.origRect.height
    for (const [childId, orig] of d.origChildren) {
      const childChanges: Partial<SceneNode> = scaledChildSnapshot(orig, sx, sy)
      editor.graph.updateNodePreview(childId, childChanges)
      editor.renderer?.invalidateVectorPath(childId)
    }
  }

  const node = editor.graph.getNode(d.nodeId)
  if (node?.layoutMode !== 'NONE') {
    editor.graph.runPreviewUpdates(() => computeLayout(editor.graph, d.nodeId))
  }
  editor.requestRepaint()
}

export function commitResizePreview(d: DragResize, editor: Editor) {
  const node = editor.graph.getNode(d.nodeId)
  if (!node) return
  const finalChanges: Partial<SceneNode> = {
    x: node.x,
    y: node.y,
    width: node.width,
    height: node.height
  }
  if (node.vectorNetwork) finalChanges.vectorNetwork = node.vectorNetwork

  if (d.origChildren) {
    const finalChildren = new Map<string, Partial<SceneNode>>()
    for (const [childId] of d.origChildren) {
      const child = editor.graph.getNode(childId)
      if (!child) continue
      finalChildren.set(childId, createResizeSnapshot(child))
    }
    editor.graph.updateNodePreview(d.nodeId, d.origRect)
    for (const [childId, orig] of d.origChildren) {
      editor.graph.updateNodePreview(childId, orig)
    }
    editor.updateNode(d.nodeId, finalChanges)
    for (const [childId, final] of finalChildren) {
      editor.updateNode(childId, final)
    }
    editor.commitGroupResize(d.nodeId, d.origRect, d.origChildren)
    editor.requestRepaint()
  } else {
    editor.graph.updateNodePreview(d.nodeId, d.origRect)
    editor.updateNode(d.nodeId, finalChanges)
    editor.commitResize(d.nodeId, {
      ...d.origRect,
      ...(d.origVectorNetwork || node.vectorNetwork ? { vectorNetwork: d.origVectorNetwork } : {})
    })
  }
}
