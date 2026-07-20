import type { SceneNode } from '@open-pencil/scene-graph'

import type {
  SmylrComputedAssetDefinition,
  SmylrComputedAssetVariant
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

export type ComputedAssetVariant = SmylrComputedAssetVariant & {
  fixtureId: string
  kind: 'computed'
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

export type LocalAsset = SceneAsset | ComputedAsset
