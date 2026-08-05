import { type ComputedRef, type InjectionKey, type Ref, inject, provide } from 'vue'

import type { Editor } from '@open-pencil/core/editor'
import type { SceneNode } from '@open-pencil/scene-graph'

export interface LayerNode {
  id: string
  name: string
  type: string
  layoutMode: string
  visible: boolean
  locked: boolean
  /** Virtual rows (e.g. internal DOM) — not scene-graph nodes. */
  virtual?: boolean
  children?: LayerNode[]
}

/**
 * Optional host bridge: inject host-owned layers into the design layer tree
 * without a second layers UI.
 */
export type LayerTreeHostBridge = {
  /** Extra host-owned rows under a scene node. */
  getVirtualChildren?: (node: SceneNode) => LayerNode[] | undefined
  /**
   * Optional full outline for a scene parent's children (design boards/sections).
   * When provided, replaces the default recursive child walk for that parent.
   */
  getSceneChildren?: (parent: SceneNode) => LayerNode[] | undefined
  /** True when id is a virtual layer row. */
  isVirtualId?: (id: string) => boolean
  /** Select a virtual layer (host owns the selection model). */
  selectVirtual?: (id: string) => void
  /** Virtual ids that should appear selected in the tree. */
  virtualSelectedIds?: ComputedRef<Set<string>> | Ref<Set<string>>
  /** Bump when virtual children change so the tree rebuilds. */
  version?: ComputedRef<number> | Ref<number>
  /**
   * Ids that should be expanded by default when the tree (re)builds —
   * e.g. primary internal regions so designers don't open every wrapper.
   */
  defaultExpandedIds?: ComputedRef<string[]> | Ref<string[]>
}

export const LAYER_TREE_HOST_BRIDGE_KEY: InjectionKey<LayerTreeHostBridge> =
  Symbol('layer-tree-host-bridge')

export interface LayerDragInstruction {
  type: 'reorder-above' | 'reorder-below' | 'make-child'
}

export interface LayerTreeContext {
  editor: Editor
  items: Ref<LayerNode[]>
  expanded: Ref<string[]>
  treeVersion: Ref<number>
  selectedIds: ComputedRef<Set<string>>
  indentPerLevel: number
  draggingId: Ref<string | null>
  instruction: Ref<LayerDragInstruction | null>
  instructionTargetId: Ref<string | null>
  setupDrag: (
    el: Ref<HTMLElement | null>,
    item: () => { id: string; level: number; hasChildren: boolean; parentId: string | null }
  ) => void
  select: (id: string, additive: boolean) => void
  toggleExpand: (id: string) => void
  toggleVisibility: (id: string) => void
  toggleLock: (id: string) => void
  rename: (id: string, name: string) => void
  setRowRef: (id: string, el: HTMLElement | null) => void
}

export const LAYER_TREE_KEY: InjectionKey<LayerTreeContext> = Symbol('layer-tree')

export function provideLayerTree(ctx: LayerTreeContext) {
  provide(LAYER_TREE_KEY, ctx)
}

export function useLayerTree(): LayerTreeContext {
  const ctx = inject(LAYER_TREE_KEY)
  if (!ctx) throw new Error('[open-pencil] useLayerTree() called outside <LayerTreeRoot>')
  return ctx
}

export function useLayerTreeHostBridge(): LayerTreeHostBridge | null {
  return inject(LAYER_TREE_HOST_BRIDGE_KEY, null)
}
