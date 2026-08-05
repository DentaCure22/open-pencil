import type { SceneNode } from '@open-pencil/scene-graph'
import type { MoveSnapInput } from '@open-pencil/vue'

export const CODE_OBJECT_DRAG_THRESHOLD_PX = 4

export type CodeObjectInteractionMode = 'design' | 'interact'
export type CodeObjectInteractionModes = Record<string, CodeObjectInteractionMode>

export type CodeObjectInteractionModeReconciliation = {
  deactivatedFrameIds: string[]
  modes: CodeObjectInteractionModes
}

export type CodeObjectDesignGesture = {
  frameId: string
  phase: 'dragging' | 'pending'
  pointerId: number
  startClientX: number
  startClientY: number
  startX: number
  startY: number
}

export type CodeObjectDesignGestureMove = {
  dx: number
  dy: number
  gesture: CodeObjectDesignGesture
}

export type CodeObjectMoveDrag = CodeObjectDesignGesture & {
  snapInput: MoveSnapInput
}

export function createCodeObjectDesignGesture(input: {
  frameId: string
  pointerId: number
  startClientX: number
  startClientY: number
  startX: number
  startY: number
}): CodeObjectDesignGesture {
  return { ...input, phase: 'pending' }
}

export function createCodeObjectMoveDrag(input: {
  frame: SceneNode
  pageId: string
  pointerId: number
  startClientX: number
  startClientY: number
}): CodeObjectMoveDrag {
  const { frame, pageId, ...pointer } = input
  return {
    ...createCodeObjectDesignGesture({
      ...pointer,
      frameId: frame.id,
      startX: frame.x,
      startY: frame.y
    }),
    snapInput: {
      movingIds: new Set([frame.id]),
      originals: new Map([
        [
          frame.id,
          {
            parentId: frame.parentId ?? pageId,
            x: frame.x,
            y: frame.y
          }
        ]
      ])
    }
  }
}

export function moveCodeObjectDesignGesture(
  gesture: CodeObjectDesignGesture,
  clientX: number,
  clientY: number
): CodeObjectDesignGestureMove {
  const dx = clientX - gesture.startClientX
  const dy = clientY - gesture.startClientY
  const phase =
    gesture.phase === 'dragging' || Math.hypot(dx, dy) >= CODE_OBJECT_DRAG_THRESHOLD_PX
      ? 'dragging'
      : 'pending'
  return {
    dx,
    dy,
    gesture: phase === gesture.phase ? gesture : { ...gesture, phase }
  }
}

export function codeObjectDesignGestureDragged(gesture: CodeObjectDesignGesture): boolean {
  return gesture.phase === 'dragging'
}

export function reconcileCodeObjectInteractionModes(
  modes: CodeObjectInteractionModes,
  selectedFrameId: string | null
): CodeObjectInteractionModeReconciliation {
  let reconciledModes = modes
  const deactivatedFrameIds: string[] = []

  for (const [frameId, mode] of Object.entries(modes)) {
    if (mode !== 'interact' || frameId === selectedFrameId) continue
    if (reconciledModes === modes) reconciledModes = { ...modes }
    reconciledModes[frameId] = 'design'
    deactivatedFrameIds.push(frameId)
  }

  return { deactivatedFrameIds, modes: reconciledModes }
}
