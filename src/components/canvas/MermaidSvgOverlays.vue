<script setup lang="ts">
import { computed, shallowRef, watch } from 'vue'

import { isMermaidDiagramContainer, type MermaidAppearance } from '@open-pencil/core/diagram'
import type { SceneNode } from '@open-pencil/scene-graph'

import { renderMermaidSvgInBrowser } from '@/app/diagram/mermaid/render'
import { useEditorStore } from '@/app/editor/active-store'
import { useSceneNodeOverlayStyle } from '@/app/editor/presentation'
import { useAppTheme } from '@/app/shell/theme'

type MermaidSvgItem = {
  appearance: MermaidAppearance
  node: SceneNode
  source: string
}

type MermaidSvgRendering = {
  error: string
  key: string
  svg: string
}

const store = useEditorStore()
const { resolvedTheme } = useAppTheme()
const overlayStyle = useSceneNodeOverlayStyle(store)
const renderings = shallowRef<Record<string, MermaidSvgRendering>>({})

function pluginValue(node: SceneNode, key: string): string | null {
  return (
    node.pluginData.find((entry) => entry.pluginId === 'open-pencil' && entry.key === key)?.value ??
    null
  )
}

const items = computed<MermaidSvgItem[]>(() => {
  void store.state.sceneVersion
  void store.state.currentPageId
  const theme = resolvedTheme.value
  return Array.from(store.graph.getDescendants(store.state.currentPageId)).flatMap((node) => {
    if (node.type !== 'FRAME' || !node.visible || !isMermaidDiagramContainer(node)) return []
    const source = pluginValue(node, 'mermaid/source')
    if (!source) return []
    const requestedAppearance = pluginValue(node, 'mermaid/appearance')
    return [
      {
        appearance:
          requestedAppearance === 'light' || requestedAppearance === 'dark'
            ? requestedAppearance
            : theme,
        node,
        source
      }
    ]
  })
})

watch(
  items,
  (nextItems) => {
    const next: Record<string, MermaidSvgRendering> = {}
    for (const item of nextItems) {
      const key = `${item.appearance}\n${item.source}`
      const current = renderings.value[item.node.id]
      if (current?.key === key) {
        next[item.node.id] = current
        continue
      }
      next[item.node.id] = { error: '', key, svg: '' }
      void renderMermaidSvgInBrowser(item.source, item.appearance)
        .then((diagram) => {
          if (renderings.value[item.node.id]?.key !== key) return undefined
          renderings.value = {
            ...renderings.value,
            [item.node.id]: { error: '', key, svg: diagram.svg ?? '' }
          }
          return undefined
        })
        .catch((error: unknown) => {
          if (renderings.value[item.node.id]?.key !== key) return undefined
          renderings.value = {
            ...renderings.value,
            [item.node.id]: {
              error: error instanceof Error ? error.message : String(error),
              key,
              svg: ''
            }
          }
          return undefined
        })
    }
    renderings.value = next
  },
  { immediate: true }
)
</script>

<template>
  <div class="pointer-events-none absolute inset-0 z-[4] overflow-hidden">
    <article
      v-for="item in items"
      :key="item.node.id"
      :data-mermaid-svg-node-id="item.node.id"
      :style="overlayStyle(item.node)"
      class="absolute top-0 left-0 overflow-hidden [&>svg]:size-full"
      data-test-id="mermaid-svg-object"
      v-html="renderings[item.node.id]?.svg"
    />
    <p
      v-for="item in items.filter((candidate) => renderings[candidate.node.id]?.error)"
      :key="`${item.node.id}:error`"
      :style="overlayStyle(item.node)"
      class="absolute top-0 left-0 flex items-center justify-center overflow-hidden rounded-lg bg-red-950/90 p-4 text-center text-xs text-red-100"
    >
      {{ renderings[item.node.id]?.error }}
    </p>
  </div>
</template>
