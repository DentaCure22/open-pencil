import type { SceneGraph, SceneNode } from '@open-pencil/scene-graph'

export type SmylrComputedAssetDefinition = {
  fixtureId: string
  frameHeight: number
  frameWidth: number
  name: string
  repository: 'Smylr-Elite'
  sourcePath: string
  symbol: string
}

export const SMYLR_COMPUTED_ASSET_RENDERER_VERSION = '5'

/**
 * First live batch. Each entry points at a real Smylr source component mounted
 * by the app renderer. The dimensions only size its lightweight canvas frame;
 * OpenPencil never reconstructs the component itself.
 */
export const SMYLR_COMPUTED_ASSETS: readonly SmylrComputedAssetDefinition[] = [
  {
    fixtureId: 'badge',
    frameHeight: 220,
    frameWidth: 360,
    name: 'Badge',
    repository: 'Smylr-Elite',
    sourcePath: 'src/components/ui/badge.tsx',
    symbol: 'Badge',
  },
  {
    fixtureId: 'button',
    frameHeight: 240,
    frameWidth: 400,
    name: 'Button',
    repository: 'Smylr-Elite',
    sourcePath: 'src/components/ui/button.tsx',
    symbol: 'Button',
  },
  {
    fixtureId: 'card',
    frameHeight: 420,
    frameWidth: 620,
    name: 'Card',
    repository: 'Smylr-Elite',
    sourcePath: 'src/components/ui/card.tsx',
    symbol: 'Card',
  },
  {
    fixtureId: 'checkbox',
    frameHeight: 220,
    frameWidth: 380,
    name: 'Checkbox',
    repository: 'Smylr-Elite',
    sourcePath: 'src/components/ui/checkbox.tsx',
    symbol: 'Checkbox',
  },
  {
    fixtureId: 'select',
    frameHeight: 280,
    frameWidth: 520,
    name: 'Select',
    repository: 'Smylr-Elite',
    sourcePath: 'src/components/ui/select.tsx',
    symbol: 'Select',
  },
  {
    fixtureId: 'separator',
    frameHeight: 220,
    frameWidth: 560,
    name: 'Separator',
    repository: 'Smylr-Elite',
    sourcePath: 'src/components/ui/separator.tsx',
    symbol: 'Separator',
  },
  {
    fixtureId: 'switch',
    frameHeight: 220,
    frameWidth: 380,
    name: 'Switch',
    repository: 'Smylr-Elite',
    sourcePath: 'src/components/ui/switch.tsx',
    symbol: 'Switch',
  },
  {
    fixtureId: 'table',
    frameHeight: 520,
    frameWidth: 960,
    name: 'Table',
    repository: 'Smylr-Elite',
    sourcePath: 'src/components/ui/table.tsx',
    symbol: 'Table',
  },
]

function pluginValue(node: SceneNode, key: string) {
  return node.pluginData.find(
    (entry) => entry.pluginId === 'smylr-production' && entry.key === key
  )?.value
}

function containsStaleComputedAsset(
  graph: SceneGraph,
  node: SceneNode
): boolean {
  const kind = pluginValue(node, 'kind')
  if (
    (kind === 'smylr-component-page' || kind === 'smylr-live-component-page') &&
    pluginValue(node, 'rendererVersion') !==
      SMYLR_COMPUTED_ASSET_RENDERER_VERSION
  ) {
    return true
  }
  if (
    node.sourceLibraryKey === 'smylr-computed' &&
    pluginValue(node, 'rendererVersion') !==
      SMYLR_COMPUTED_ASSET_RENDERER_VERSION
  ) {
    return true
  }
  return graph
    .getChildren(node.id)
    .some((child) => containsStaleComputedAsset(graph, child))
}

/** Refresh old reconstructed or live pages whenever the renderer contract changes. */
export function removeStaleComputedComponentPages(graph: SceneGraph) {
  const pages = graph
    .getPages()
    .filter((page) => containsStaleComputedAsset(graph, page))
  for (const page of pages) graph.deleteNode(page.id)
  return pages.length
}

function containsDesignedPlaceholder(
  graph: SceneGraph,
  node: SceneNode
): boolean {
  if (node.sourceLibraryKey === 'smylr-native') return true
  return graph
    .getChildren(node.id)
    .some((child) => containsDesignedPlaceholder(graph, child))
}

/** Remove only the hand-drawn placeholder pages from the abandoned first attempt. */
export function removeDesignedComponentPlaceholders(graph: SceneGraph) {
  const pages = graph
    .getPages()
    .filter((page) => containsDesignedPlaceholder(graph, page))
  for (const page of pages) graph.deleteNode(page.id)
  return pages.length
}
