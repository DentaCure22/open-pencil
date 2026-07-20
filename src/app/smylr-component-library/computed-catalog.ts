import type { SceneGraph, SceneNode } from '@open-pencil/scene-graph'

import rendererCatalogJson from './renderer-catalog.generated.json'

export type SmylrComputedAssetVariant = {
  id: string
  label: string
  props: Record<string, string>
}

export type SmylrComputedAssetDefinition = {
  fixtureId: string
  frameHeight: number
  frameWidth: number
  interactionHeight: number
  inventoryLayer: string
  inventoryStoryStatus: 'covered'
  inventoryStoryTitle: string
  inventoryVariantAxes: string[]
  name: string
  overlayHeight: number
  overlayWidth: number
  repository: 'Smylr-Elite'
  selector: string
  sourcePath: string
  symbol: string
  variants: SmylrComputedAssetVariant[]
}

type RendererCatalog = {
  fixtures: Array<{
    fixtureId: string
    frameHeight: number
    frameWidth: number
    interactionHeight: number
    inventory: {
      layer: string
      storyStatus: 'covered'
      storyTitle: string
      variantAxes: string[]
    }
    name: string
    overlayHeight: number
    overlayWidth: number
    repository: 'Smylr-Elite'
    selector: string
    sourcePath: string
    symbol: string
    variants: SmylrComputedAssetVariant[]
  }>
  rendererVersion: string
  schemaVersion: 1
}

function normalizeRendererCatalog(input: typeof rendererCatalogJson): RendererCatalog {
  if (input.schemaVersion !== 1) throw new Error('Unsupported Smylr renderer catalog schema')

  return {
    fixtures: input.fixtures.map((fixture) => {
      if (fixture.repository !== 'Smylr-Elite' || fixture.inventory.storyStatus !== 'covered') {
        throw new Error(`Invalid Smylr renderer catalog fixture: ${fixture.fixtureId}`)
      }
      return {
        ...fixture,
        inventory: {
          ...fixture.inventory,
          storyStatus: 'covered'
        },
        repository: 'Smylr-Elite',
        variants: fixture.variants.map((variant) => {
          const props: Record<string, string> = {}
          for (const [name, value] of Object.entries(variant.props)) {
            if (typeof value === 'string') props[name] = value
          }
          return { ...variant, props }
        })
      }
    }),
    rendererVersion: input.rendererVersion,
    schemaVersion: 1
  }
}

const rendererCatalog = normalizeRendererCatalog(rendererCatalogJson)

export const SMYLR_COMPUTED_ASSET_RENDERER_VERSION = rendererCatalog.rendererVersion

/**
 * Generated intersection of the Smylr Component Atlas inventory and the
 * explicitly renderable OpenPencil fixture profiles. OpenPencil never treats a
 * merely discovered source export as a live fixture and never reconstructs the
 * component itself.
 */
export const SMYLR_COMPUTED_ASSETS: readonly SmylrComputedAssetDefinition[] =
  rendererCatalog.fixtures.map((fixture) => ({
    fixtureId: fixture.fixtureId,
    frameHeight: fixture.frameHeight,
    frameWidth: fixture.frameWidth,
    interactionHeight: fixture.interactionHeight,
    inventoryLayer: fixture.inventory.layer,
    inventoryStoryStatus: fixture.inventory.storyStatus,
    inventoryStoryTitle: fixture.inventory.storyTitle,
    inventoryVariantAxes: fixture.inventory.variantAxes,
    name: fixture.name,
    overlayHeight: fixture.overlayHeight,
    overlayWidth: fixture.overlayWidth,
    repository: fixture.repository,
    selector: fixture.selector,
    sourcePath: fixture.sourcePath,
    symbol: fixture.symbol,
    variants: fixture.variants
  }))

function pluginValue(node: SceneNode, key: string) {
  return node.pluginData.find((entry) => entry.pluginId === 'smylr-production' && entry.key === key)
    ?.value
}

function containsStaleComputedAsset(graph: SceneGraph, node: SceneNode): boolean {
  const kind = pluginValue(node, 'kind')
  if (
    (kind === 'smylr-component-page' || kind === 'smylr-live-component-page') &&
    pluginValue(node, 'rendererVersion') !== SMYLR_COMPUTED_ASSET_RENDERER_VERSION
  ) {
    return true
  }
  if (
    node.sourceLibraryKey === 'smylr-computed' &&
    pluginValue(node, 'rendererVersion') !== SMYLR_COMPUTED_ASSET_RENDERER_VERSION
  ) {
    return true
  }
  return graph.getChildren(node.id).some((child) => containsStaleComputedAsset(graph, child))
}

/** Refresh old reconstructed or live pages whenever the renderer contract changes. */
export function removeStaleComputedComponentPages(graph: SceneGraph) {
  const pages = graph.getPages().filter((page) => containsStaleComputedAsset(graph, page))
  for (const page of pages) graph.deleteNode(page.id)
  return pages.length
}

function containsDesignedPlaceholder(graph: SceneGraph, node: SceneNode): boolean {
  if (node.sourceLibraryKey === 'smylr-native') return true
  return graph.getChildren(node.id).some((child) => containsDesignedPlaceholder(graph, child))
}

/** Remove only the hand-drawn placeholder pages from the abandoned first attempt. */
export function removeDesignedComponentPlaceholders(graph: SceneGraph) {
  const pages = graph.getPages().filter((page) => containsDesignedPlaceholder(graph, page))
  for (const page of pages) graph.deleteNode(page.id)
  return pages.length
}
