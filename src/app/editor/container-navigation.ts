import type { Editor } from '@open-pencil/core/editor'
import type { SceneNode } from '@open-pencil/scene-graph'

import { codeObjectDocument } from '@/app/code-object/model'
import {
  SPATIAL_DIRECTION_VECTORS,
  type SpatialNavigationDirection
} from '@/app/editor/spatial-navigation'

export type ContainerNavigationDirection = SpatialNavigationDirection

export type ContainerNavigationState = {
  activeContainerId: string
  activeContainerName: string
  depth: number
}

export type ContainerNavigation = {
  dispose: () => void
  enterSelectedContainer: () => boolean
  exit: () => boolean
  getState: () => ContainerNavigationState | null
  navigateInDirection: (direction: ContainerNavigationDirection) => boolean
  subscribe: (listener: () => void) => () => void
}

type ContainerNavigationSession = {
  originEnteredContainerId: string | null
  originSelection: string[]
  pageId: string
  path: string[]
}

type ContainerCandidate = {
  id: string
  name: string
  primary: number
  perpendicular: number
}

function navigableContainerChildren(editor: Editor, containerId: string): SceneNode[] {
  return editor.graph
    .getChildren(containerId)
    .filter(
      (node) =>
        node.visible &&
        !node.internalOnly &&
        node.type !== 'CANVAS' &&
        editor.graph.isContainer(node.id) &&
        !codeObjectDocument(node)
    )
}

function topLeftContainer(editor: Editor, containers: SceneNode[]): SceneNode | null {
  const sorted = [...containers].sort((first, second) => {
    const firstPosition = editor.graph.getAbsolutePosition(first.id)
    const secondPosition = editor.graph.getAbsolutePosition(second.id)
    return (
      firstPosition.y - secondPosition.y ||
      firstPosition.x - secondPosition.x ||
      first.name.localeCompare(second.name) ||
      first.id.localeCompare(second.id)
    )
  })
  return sorted[0] ?? null
}

function directionalContainer(
  editor: Editor,
  current: SceneNode,
  containers: SceneNode[],
  direction: ContainerNavigationDirection
): SceneNode | null {
  const currentPosition = editor.graph.getAbsolutePosition(current.id)
  const currentCenter = {
    x: currentPosition.x + current.width / 2,
    y: currentPosition.y + current.height / 2
  }
  const vector = SPATIAL_DIRECTION_VECTORS[direction]
  const candidates: ContainerCandidate[] = []

  for (const container of containers) {
    if (container.id === current.id) continue
    const position = editor.graph.getAbsolutePosition(container.id)
    const dx = position.x + container.width / 2 - currentCenter.x
    const dy = position.y + container.height / 2 - currentCenter.y
    const primary = dx * vector.x + dy * vector.y
    if (primary <= 0) continue
    candidates.push({
      id: container.id,
      name: container.name,
      perpendicular: Math.abs(dx * vector.y - dy * vector.x),
      primary
    })
  }

  candidates.sort(
    (first, second) =>
      first.perpendicular / first.primary - second.perpendicular / second.primary ||
      first.primary - second.primary ||
      first.perpendicular - second.perpendicular ||
      first.name.localeCompare(second.name) ||
      first.id.localeCompare(second.id)
  )
  const target = candidates[0]
  return target ? (editor.graph.getNode(target.id) ?? null) : null
}

export function createContainerNavigation(editor: Editor): ContainerNavigation {
  const listeners = new Set<() => void>()
  let session: ContainerNavigationSession | null = null

  function notify(): void {
    for (const listener of listeners) listener()
  }

  function clear(): void {
    if (!session) return
    session = null
    notify()
  }

  function subscribe(listener: () => void): () => void {
    listeners.add(listener)
    return () => {
      listeners.delete(listener)
    }
  }

  function getState(): ContainerNavigationState | null {
    const activeContainerId = session?.path.at(-1)
    if (!session || !activeContainerId) return null
    const active = editor.graph.getNode(activeContainerId)
    if (!active) return null
    return {
      activeContainerId,
      activeContainerName: active.name,
      depth: session.path.length
    }
  }

  function selectInitialChild(containerId: string): void {
    const child = topLeftContainer(editor, navigableContainerChildren(editor, containerId))
    editor.select(child ? [child.id] : [containerId])
  }

  function enterSelectedContainer(): boolean {
    if (editor.state.selectedIds.size !== 1) return false
    const selectedId = editor.state.selectedIds.values().next().value
    const selected = typeof selectedId === 'string' ? editor.graph.getNode(selectedId) : undefined
    if (
      !selected ||
      selected.type === 'CANVAS' ||
      !editor.graph.isContainer(selected.id) ||
      codeObjectDocument(selected)
    ) {
      return false
    }

    if (!session) {
      session = {
        originEnteredContainerId: editor.state.enteredContainerId,
        originSelection: [...editor.state.selectedIds],
        pageId: editor.state.currentPageId,
        path: [selected.id]
      }
    } else {
      const activeContainerId = session.path.at(-1)
      if (selected.parentId !== activeContainerId || session.path.includes(selected.id))
        return false
      session.path.push(selected.id)
    }

    editor.enterContainer(selected.id)
    selectInitialChild(selected.id)
    notify()
    return true
  }

  function navigateInDirection(direction: ContainerNavigationDirection): boolean {
    const activeContainerId = session?.path.at(-1)
    if (!session || !activeContainerId) return false
    const containers = navigableContainerChildren(editor, activeContainerId)
    if (containers.length === 0) return true
    const selectedId =
      editor.state.selectedIds.size === 1
        ? editor.state.selectedIds.values().next().value
        : undefined
    const current =
      typeof selectedId === 'string'
        ? containers.find((container) => container.id === selectedId)
        : undefined
    const target = current
      ? directionalContainer(editor, current, containers, direction)
      : topLeftContainer(editor, containers)
    if (target) editor.select([target.id])
    return true
  }

  function exit(): boolean {
    if (!session) return false
    if (session.path.length > 1) {
      const exitedId = session.path.pop()
      const activeContainerId = session.path.at(-1)
      if (!exitedId || !activeContainerId) return false
      editor.enterContainer(activeContainerId)
      editor.select([exitedId])
      notify()
      return true
    }

    const origin = session
    session = null
    editor.state.enteredContainerId =
      origin.originEnteredContainerId && editor.graph.getNode(origin.originEnteredContainerId)
        ? origin.originEnteredContainerId
        : null
    editor.select(origin.originSelection.filter((id) => editor.graph.getNode(id)))
    notify()
    return true
  }

  function validateSession(): void {
    if (!session) return
    if (
      session.pageId !== editor.state.currentPageId ||
      session.path.some((id) => !editor.graph.getNode(id))
    ) {
      clear()
    }
  }

  const unsubscribes = [
    editor.onEditorEvent('graph:replaced', clear),
    editor.onEditorEvent('page:changed', clear),
    editor.onEditorEvent('node:deleted', validateSession),
    editor.onEditorEvent('node:reparented', validateSession)
  ]

  function dispose(): void {
    for (const unsubscribe of unsubscribes) unsubscribe()
    listeners.clear()
    session = null
  }

  return {
    dispose,
    enterSelectedContainer,
    exit,
    getState,
    navigateInDirection,
    subscribe
  }
}
