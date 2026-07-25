import type { SceneGraph, SceneNode } from '@open-pencil/scene-graph'

import rendererCatalogJson from './renderer-catalog.generated.json'

export type SmylrComputedAssetVariant = {
  id: string
  label: string
  props: Record<string, string>
}

export type SmylrComponentInventoryLayer = 'feature' | 'layout' | 'primitive' | 'shared'

export type SmylrComponentStoryStatus = 'covered' | 'needs-fixture' | 'story-ready'

export type SmylrSourceOnlyAuditClassification =
  | 'direct-fixture'
  | 'local-adapter'
  | 'browser-only'
  | 'runtime-or-service'
  | 'nonvisual-component-export'
  | 'needs-production-boundary'

export type SmylrSourceOnlyAuditPriority = 'high' | 'medium' | 'low'

export type SmylrSourceOnlyAuditAction =
  | 'fixture-candidate'
  | 'retain-source-only'
  | 'remove-from-assets'

export type SmylrSourceOnlyAudit = {
  assetAction: SmylrSourceOnlyAuditAction
  assetActionReason: string
  classification: SmylrSourceOnlyAuditClassification
  priority: SmylrSourceOnlyAuditPriority
  reason: string
  recommendedFixtureId: string | null
  recommendedVariantAxes: Record<string, string[]> | null
}

export type SmylrComponentInventoryDefinition = {
  componentNames: string[]
  feature: string | null
  importPath: string
  layer: SmylrComponentInventoryLayer
  openPencilAudit: SmylrSourceOnlyAudit | null
  recommendedStoryRoot: string
  sourcePath: string
  stateTargets: string[]
  storyStatus: SmylrComponentStoryStatus
  storyTitles: string[]
  variantAxes: string[]
}

export type SmylrComputedAssetDefinition = {
  fixtureId: string
  frameHeight: number
  frameWidth: number
  interactionHeight: number
  inventoryLayer: SmylrComponentInventoryLayer
  inventoryStoryStatus: SmylrComponentStoryStatus
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
  components: SmylrComponentInventoryDefinition[]
  fixtures: Array<{
    fixtureId: string
    frameHeight: number
    frameWidth: number
    interactionHeight: number
    inventory: {
      layer: SmylrComponentInventoryLayer
      storyStatus: SmylrComponentStoryStatus
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

function isInventoryLayer(value: string): value is SmylrComponentInventoryLayer {
  return ['feature', 'layout', 'primitive', 'shared'].includes(value)
}

function isStoryStatus(value: string): value is SmylrComponentStoryStatus {
  return ['covered', 'needs-fixture', 'story-ready'].includes(value)
}

function isAuditClassification(value: string): value is SmylrSourceOnlyAuditClassification {
  return [
    'direct-fixture',
    'local-adapter',
    'browser-only',
    'runtime-or-service',
    'nonvisual-component-export',
    'needs-production-boundary'
  ].includes(value)
}

function isAuditPriority(value: string): value is SmylrSourceOnlyAuditPriority {
  return ['high', 'medium', 'low'].includes(value)
}

function isAuditAction(value: string): value is SmylrSourceOnlyAuditAction {
  return ['fixture-candidate', 'retain-source-only', 'remove-from-assets'].includes(value)
}

function normalizeAudit(
  audit: (typeof rendererCatalogJson.components)[number]['openPencilAudit'],
  sourcePath: string
): SmylrSourceOnlyAudit | null {
  if (audit === null) return null
  if (
    !isAuditClassification(audit.classification) ||
    !isAuditPriority(audit.priority) ||
    !isAuditAction(audit.assetAction) ||
    audit.reason.length === 0 ||
    audit.assetActionReason.length === 0
  ) {
    throw new Error(`Invalid OpenPencil source-only audit: ${sourcePath}`)
  }
  const recommendedVariantAxes = audit.recommendedVariantAxes
    ? Object.fromEntries(
        Object.entries(audit.recommendedVariantAxes).map(([name, values]) => [name, [...values]])
      )
    : null
  return {
    ...audit,
    assetAction: audit.assetAction,
    classification: audit.classification,
    priority: audit.priority,
    recommendedVariantAxes
  }
}

function normalizeRendererCatalog(input: typeof rendererCatalogJson): RendererCatalog {
  if (input.schemaVersion !== 1) throw new Error('Unsupported Smylr renderer catalog schema')

  return {
    components: input.components.map((component) => {
      if (!isInventoryLayer(component.layer) || !isStoryStatus(component.storyStatus)) {
        throw new Error(`Invalid Smylr component inventory entry: ${component.sourcePath}`)
      }
      return {
        ...component,
        layer: component.layer,
        openPencilAudit: normalizeAudit(component.openPencilAudit, component.sourcePath),
        storyStatus: component.storyStatus
      }
    }),
    fixtures: input.fixtures.map((fixture) => {
      const inventoryLayer = fixture.inventory.layer
      if (
        fixture.repository !== 'Smylr-Elite' ||
        !isStoryStatus(fixture.inventory.storyStatus) ||
        !isInventoryLayer(inventoryLayer)
      ) {
        throw new Error(`Invalid Smylr renderer catalog fixture: ${fixture.fixtureId}`)
      }
      return {
        ...fixture,
        inventory: {
          ...fixture.inventory,
          layer: inventoryLayer,
          storyStatus: fixture.inventory.storyStatus
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

/** All source-backed Smylr component modules, including entries awaiting a live fixture. */
export const SMYLR_COMPONENT_INVENTORY: readonly SmylrComponentInventoryDefinition[] =
  rendererCatalog.components

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
