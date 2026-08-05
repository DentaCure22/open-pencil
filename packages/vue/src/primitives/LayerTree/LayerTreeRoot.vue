<script setup lang="ts">
import { computed, nextTick, onScopeDispose, ref, watch } from 'vue'
import { TreeRoot } from 'reka-ui'

import { isObjectGraphConnectionNode } from '@open-pencil/scene-graph'

import { useEditor } from '#vue/editor/context'
import { provideLayerTree, useLayerTreeHostBridge } from '#vue/primitives/LayerTree/context'
import { useLayerDrag } from '#vue/primitives/LayerTree/useLayerDrag'

import type { LayerNode } from '#vue/primitives/LayerTree/context'
import type { SceneNode } from '@open-pencil/scene-graph'

const {
  filterText = '',
  indentPerLevel = 16,
  initialExpansionDepth = Number.POSITIVE_INFINITY
} = defineProps<{
  filterText?: string
  indentPerLevel?: number
  initialExpansionDepth?: number
}>()

const emit = defineEmits<{
  select: [id: string, additive: boolean]
  toggleExpand: [id: string]
  toggleVisibility: [id: string]
  toggleLock: [id: string]
  rename: [id: string, name: string]
}>()

const editor = useEditor()
const hostBridge = useLayerTreeHostBridge()

function expandNode(id: string) {
  if (!expanded.value.includes(id)) expanded.value = [...expanded.value, id]
}

const { draggingId, instruction, instructionTargetId, setupItem } = useLayerDrag(
  editor,
  indentPerLevel,
  expandNode
)

function isVirtualId(id: string) {
  return Boolean(hostBridge?.isVirtualId?.(id))
}

function nodeToLayerNode(node: SceneNode): LayerNode {
  return {
    id: node.id,
    name: node.name,
    type: node.type,
    layoutMode: node.layoutMode,
    visible: node.visible,
    locked: node.locked
  }
}

function buildTree(parentId: string): LayerNode[] {
  const parent = editor.graph.getNode(parentId)
  if (!parent) return []

  // Host design outline (boards/sections). Re-attach optional host-owned rows
  // so nothing is lost when an outline leaves scene children empty.
  const outlined = hostBridge?.getSceneChildren?.(parent)
  if (outlined) {
    return outlined.map((row) => {
      const scene = editor.graph.getNode(row.id)
      const virtual = scene ? hostBridge?.getVirtualChildren?.(scene) : undefined
      if (virtual && virtual.length > 0) {
        return { ...row, children: virtual }
      }
      return row
    })
  }

  return parent.childIds
    .map((cid) => editor.graph.getNode(cid))
    .filter(
      (node): node is NonNullable<typeof node> =>
        Boolean(node) && !isObjectGraphConnectionNode(node)
    )
    .map((node) => {
      const virtual = hostBridge?.getVirtualChildren?.(node)
      if (virtual && virtual.length > 0) {
        return { ...nodeToLayerNode(node), children: virtual }
      }
      const designKids = hostBridge?.getSceneChildren?.(node)
      if (designKids) {
        return { ...nodeToLayerNode(node), children: designKids }
      }
      return {
        ...nodeToLayerNode(node),
        children: node.childIds.length > 0 ? buildTree(node.id) : undefined
      }
    })
}

const items = ref(buildTree(editor.state.currentPageId))
const treeVersion = ref(0)
const expanded = ref<string[]>([])
/** Preserve explicit folder choices while keeping the default tree focused. */
const userCollapsed = ref(new Set<string>())
const userExpanded = ref(new Set<string>())
let expansionBeforeFilter: string[] | null = null

// Keep a stable Set instance — returning a new Set every compute can thrash renders.
const selectedIds = computed(() => {
  const scene = editor.state.selectedIds
  const virtual = hostBridge?.virtualSelectedIds?.value
  if (!virtual || virtual.size === 0) return scene
  const next = new Set(scene)
  for (const id of virtual) next.add(id)
  return next
})

function collectExpandableIds(
  nodes: LayerNode[],
  acc: string[] = [],
  depth = 1,
  maxDepth = Number.POSITIVE_INFINITY
): string[] {
  for (const node of nodes) {
    if (node.children && node.children.length > 0) {
      if (depth <= maxDepth) acc.push(node.id)
      collectExpandableIds(node.children, acc, depth + 1, maxDepth)
    }
  }
  return acc
}

/** Open a useful first slice of the tree without flooding the panel. */
function expandDefaultExceptUserClosed() {
  const defaults = collectExpandableIds(items.value, [], 1, initialExpansionDepth)
  const all = new Set([...defaults, ...userExpanded.value])
  expanded.value = [...all].filter((id) => !userCollapsed.value.has(id))
}

function expandAll() {
  const all = collectExpandableIds(items.value)
  expanded.value = all
  if (filterText.trim()) expansionBeforeFilter = all
  userCollapsed.value = new Set()
  userExpanded.value = new Set(all)
}

function collapseAll() {
  const all = collectExpandableIds(items.value)
  expanded.value = []
  if (filterText.trim()) expansionBeforeFilter = []
  userCollapsed.value = new Set(all)
  userExpanded.value = new Set()
}

function filterTree(nodes: LayerNode[], query: string): LayerNode[] {
  if (!query) return nodes
  const filtered: LayerNode[] = []
  for (const node of nodes) {
    const children = node.children ? filterTree(node.children, query) : []
    if (node.name.toLowerCase().includes(query) || children.length > 0) {
      filtered.push({ ...node, children: children.length > 0 ? children : undefined })
    }
  }
  return filtered
}

const visibleItems = computed(() => filterTree(items.value, filterText.trim().toLowerCase()))

watch(
  () => filterText.trim(),
  (query, previousQuery) => {
    if (query) {
      if (!previousQuery) expansionBeforeFilter = [...expanded.value]
      const next = new Set(expanded.value)
      for (const id of collectExpandableIds(visibleItems.value)) next.add(id)
      expanded.value = [...next]
      return
    }
    if (expansionBeforeFilter) {
      expanded.value = expansionBeforeFilter
      expansionBeforeFilter = null
    }
  }
)

function rebuildTree() {
  items.value = buildTree(editor.state.currentPageId)
  treeVersion.value++
  expandDefaultExceptUserClosed()
  if (filterText.trim()) {
    const next = new Set(expanded.value)
    for (const id of collectExpandableIds(visibleItems.value)) next.add(id)
    expanded.value = [...next]
  }
  for (const id of selectedIds.value) expandAncestorsOf(id, items.value, [])
}

// Host-owned layers change without graph events (version is a number fingerprint).
watch(
  () => hostBridge?.version?.value ?? 0,
  (version, prev) => {
    if (version === prev) return
    rebuildTree()
  }
)

// Page change: reset user closed state, open everything fresh.
watch(
  () => editor.state.currentPageId,
  () => {
    userCollapsed.value = new Set()
    userExpanded.value = new Set()
    rebuildTree()
  }
)

/** Keep selection path open even if it was collapsed (selection wins briefly). */
function expandAncestorsOf(targetId: string, nodes: LayerNode[], path: string[]): boolean {
  for (const node of nodes) {
    if (node.id === targetId) {
      if (path.length === 0) return true
      const toExpand = new Set(expanded.value)
      let changed = false
      for (const id of path) {
        if (!toExpand.has(id)) {
          toExpand.add(id)
          changed = true
        }
        // Selection re-opens a path — clear closed flag for those folders
        if (userCollapsed.value.has(id)) {
          const next = new Set(userCollapsed.value)
          next.delete(id)
          userCollapsed.value = next
        }
      }
      if (changed) expanded.value = [...toExpand]
      return true
    }
    if (node.children?.length && expandAncestorsOf(targetId, node.children, [...path, node.id])) {
      return true
    }
  }
  return false
}

watch(
  () => {
    const v = hostBridge?.virtualSelectedIds?.value
    if (!v || v.size === 0) return ''
    return [...v].join(',')
  },
  (key) => {
    if (!key) return
    for (const id of key.split(',')) {
      if (id) expandAncestorsOf(id, items.value, [])
    }
  }
)

// Initial focused expansion
expandDefaultExceptUserClosed()
// Layers can be reopened after an internal DOM selection already exists. Vue's
// selection watcher will not fire for that pre-existing value, so reveal the
// current selection path during the initial tree build as well.
for (const id of selectedIds.value) expandAncestorsOf(id, items.value, [])

function replaceLayerNode(nodes: LayerNode[], replacement: LayerNode): LayerNode[] | null {
  let changed = false
  const next = nodes.map((node) => {
    if (node.id === replacement.id) {
      changed = true
      return { ...replacement, children: node.children }
    }
    if (!node.children) return node
    const children = replaceLayerNode(node.children, replacement)
    if (!children) return node
    changed = true
    return { ...node, children }
  })
  return changed ? next : null
}

function patchLayerNode(id: string, changes: Partial<SceneNode>) {
  if ('childIds' in changes || 'parentId' in changes) {
    rebuildTree()
    return
  }

  if (
    !(
      'name' in changes ||
      'type' in changes ||
      'layoutMode' in changes ||
      'visible' in changes ||
      'locked' in changes
    )
  ) {
    return
  }

  const node = editor.graph.getNode(id)
  if (!node) return
  const next = replaceLayerNode(items.value, nodeToLayerNode(node))
  if (next) items.value = next
}

const unsubscribe = [
  editor.onEditorEvent('graph:replaced', rebuildTree),
  editor.onEditorEvent('page:changed', rebuildTree),
  editor.onEditorEvent('node:created', rebuildTree),
  editor.onEditorEvent('node:deleted', rebuildTree),
  editor.onEditorEvent('node:reparented', rebuildTree),
  editor.onEditorEvent('node:reordered', rebuildTree),
  editor.onEditorEvent('node:updated', patchLayerNode)
]

onScopeDispose(() => {
  for (const stop of unsubscribe) stop()
})

const rowRefs = new Map<string, HTMLElement>()

function setRowRef(id: string, el: HTMLElement | null) {
  if (el) rowRefs.set(id, el)
  else rowRefs.delete(id)
}

watch(
  () => editor.state.selectedIds,
  (ids) => {
    const toExpand = new Set(expanded.value)
    for (const id of ids) {
      let node = editor.graph.getNode(id)
      while (node?.parentId && node.parentId !== editor.state.currentPageId) {
        toExpand.add(node.parentId)
        node = editor.graph.getNode(node.parentId)
      }
    }
    if (toExpand.size > expanded.value.length) expanded.value = [...toExpand]
    nextTick(() => {
      const first = [...ids][0]
      if (first) rowRefs.get(first)?.scrollIntoView({ block: 'nearest' })
    })
  }
)

function syncCanvasScope(nodeId: string) {
  const node = editor.graph.getNode(nodeId)
  if (!node) return
  let parentId = node.parentId
  while (parentId && parentId !== editor.state.currentPageId) {
    if (editor.graph.isContainer(parentId)) {
      editor.enterContainer(parentId)
      return
    }
    const parent = editor.graph.getNode(parentId)
    parentId = parent?.parentId ?? null
  }
  editor.state.enteredContainerId = null
}

function select(id: string, additive: boolean) {
  emit('select', id, additive)
  if (isVirtualId(id)) {
    hostBridge?.selectVirtual?.(id)
    return
  }
  if (additive) {
    editor.select([id], true)
  } else {
    editor.select([id])
    syncCanvasScope(id)
  }
}

function toggleExpand(id: string) {
  emit('toggleExpand', id)
  const isOpen = expanded.value.includes(id)
  if (isOpen) {
    // User closed this section — remember and keep it closed on rebuilds.
    expanded.value = expanded.value.filter((e) => e !== id)
    const next = new Set(userCollapsed.value)
    next.add(id)
    userCollapsed.value = next
    if (userExpanded.value.has(id)) {
      const nextExpanded = new Set(userExpanded.value)
      nextExpanded.delete(id)
      userExpanded.value = nextExpanded
    }
  } else {
    expandNode(id)
    const nextExpanded = new Set(userExpanded.value)
    nextExpanded.add(id)
    userExpanded.value = nextExpanded
    if (userCollapsed.value.has(id)) {
      const next = new Set(userCollapsed.value)
      next.delete(id)
      userCollapsed.value = next
    }
  }
}

function getKey(node: LayerNode) {
  return node.id
}

function getChildren(node: LayerNode) {
  return node.children
}

const actions = {
  collapseAll,
  expandAll,
  select,
  toggleExpand
}

provideLayerTree({
  editor,
  items,
  expanded,
  treeVersion,
  selectedIds,
  indentPerLevel,
  draggingId,
  instruction,
  instructionTargetId,
  setupDrag: setupItem,
  select,
  toggleExpand,
  toggleVisibility: (id: string) => {
    if (isVirtualId(id)) return
    emit('toggleVisibility', id)
    editor.toggleNodeVisibility(id)
  },
  toggleLock: (id: string) => {
    if (isVirtualId(id)) return
    emit('toggleLock', id)
    editor.toggleNodeLock(id)
  },
  rename: (id: string, name: string) => {
    if (isVirtualId(id)) return
    emit('rename', id, name)
    editor.renameNode(id, name)
  },
  setRowRef
})
</script>

<template>
  <TreeRoot
    v-slot="{ flattenItems }"
    as="div"
    class="flex min-h-0 flex-1 flex-col overflow-hidden"
    v-model:expanded="expanded"
    :items="visibleItems"
    :get-key="getKey"
    :get-children="getChildren"
  >
    <slot
      :items="visibleItems"
      :flatten-items="flattenItems"
      :expanded="expanded"
      :tree-version="treeVersion"
      :selected-ids="selectedIds"
      :dragging-id="draggingId"
      :instruction="instruction"
      :instruction-target-id="instructionTargetId"
      :actions="actions"
    />
  </TreeRoot>
</template>
