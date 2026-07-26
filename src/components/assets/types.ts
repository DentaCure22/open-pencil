import type { SceneNode } from '@open-pencil/scene-graph'

import type {
  SmylrComponentInventoryDefinition,
  SmylrComputedAssetDefinition
} from '@/app/smylr-component-library/computed-catalog'

export type AssetVariantAxis = {
  name: string
  values: string[]
}

export type SceneAssetVariant = {
  componentId: string
  id: string
  kind: 'scene'
  label: string
}

export type ComputedAssetVariant = {
  fixtureId: string
  id: string
  kind: 'computed'
  label: string
  props: Record<string, string>
  variantId: string | null
}

export type AssetVariant = SceneAssetVariant | ComputedAssetVariant

export type SceneAsset = {
  componentId: string | null
  description: string
  docsUrl: string | null
  hasConflicts: boolean
  id: string
  kind: 'scene'
  name: string
  node: SceneNode
  sourceLibraryKey: string | null
  sourcePath: string | null
  variantAxes: AssetVariantAxis[]
  variantCount: number
  variantItems: SceneAssetVariant[]
}

export type ComputedAsset = SmylrComputedAssetDefinition & {
  componentId: null
  description: string
  docsUrl: null
  hasConflicts: false
  id: string
  kind: 'computed'
  sourceLibraryKey: 'smylr-computed'
  variantAxes: AssetVariantAxis[]
  variantCount: number
  variantItems: ComputedAssetVariant[]
}

export type InventoryAsset = Omit<SmylrComponentInventoryDefinition, 'variantAxes'> & {
  catalogVariantAxes: string[]
  componentId: null
  description: string
  docsUrl: null
  hasConflicts: false
  id: string
  kind: 'inventory'
  name: string
  sourceLibraryKey: 'smylr-inventory'
  variantAxes: AssetVariantAxis[]
  variantCount: 0
}

export type InteractiveAsset = SceneAsset | ComputedAsset

export type LocalAsset = InteractiveAsset | InventoryAsset
