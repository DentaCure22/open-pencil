import type {
  SmylrComponentInventoryDefinition,
  SmylrComputedAssetDefinition
} from '@/app/smylr-component-library/computed-catalog'

export type AssetVariantAxis = {
  name: string
  values: string[]
}

export type ComputedAssetVariant = {
  fixtureId: string
  id: string
  kind: 'computed'
  label: string
  props: Record<string, string>
  variantId: string | null
}

export type AssetVariant = ComputedAssetVariant

export type ComputedAsset = SmylrComputedAssetDefinition & {
  description: string
  id: string
  kind: 'computed'
  sourceLibraryKey: 'smylr-computed'
  variantAxes: AssetVariantAxis[]
  variantCount: number
  variantItems: ComputedAssetVariant[]
}

export type InventoryAsset = Omit<SmylrComponentInventoryDefinition, 'variantAxes'> & {
  catalogVariantAxes: string[]
  description: string
  id: string
  kind: 'inventory'
  name: string
  sourceLibraryKey: 'smylr-inventory'
  variantAxes: AssetVariantAxis[]
  variantCount: 0
}

export type InteractiveAsset = ComputedAsset

export type LocalAsset = InteractiveAsset | InventoryAsset
