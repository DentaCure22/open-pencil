import type { ContentSourceMetadata } from '@open-pencil/core/io'

export type SpatialAssetFormat = 'glb' | 'gltf'
export type CadSourceFormat = 'brep' | 'dwg' | 'dxf' | 'iges' | 'step'
export type DeferredMeshFormat = 'obj' | 'stl'

export type SpatialCameraState = {
  position: [number, number, number]
  target: [number, number, number]
}

export type SpatialMediaSource = {
  assetHash: string
  camera: SpatialCameraState | null
  fileName: string
  format: SpatialAssetFormat
  homeCamera: SpatialCameraState | null
  metadata: ContentSourceMetadata
  previewHash: string | null
}

export type SpatialViewerClassification = {
  disposition: 'spatial-viewer'
  format: SpatialAssetFormat
  kind: 'mesh-asset'
  label: string
}

export type ThreeExperienceClassification = {
  disposition: 'three-experience-adapter'
  format: 'three-html' | 'three-js' | 'three-json'
  kind: 'three-experience'
  label: string
  reason: string
}

export type CadSourceClassification = {
  disposition: 'generic-source'
  format: CadSourceFormat
  kind: 'engineering-cad'
  label: string
  reason: string
  fidelity: {
    editable: false
    topology: 'unverified'
    units: 'unverified'
  }
}

export type DeferredMeshClassification = {
  disposition: 'generic-source'
  format: DeferredMeshFormat
  kind: 'mesh-source'
  label: string
  reason: string
}

export type RejectedSpatialClassification = {
  disposition: 'reject'
  kind: 'oversize'
  label: string
  reason: string
}

export type UnknownSpatialClassification = {
  disposition: 'not-spatial'
  kind: 'unknown'
  label: string
}

export type SpatialFileClassification =
  | CadSourceClassification
  | DeferredMeshClassification
  | RejectedSpatialClassification
  | SpatialViewerClassification
  | ThreeExperienceClassification
  | UnknownSpatialClassification

export type SpatialPlacementFallback = {
  classification: Exclude<SpatialFileClassification, SpatialViewerClassification>
  file: File
}

export type SpatialPlacementResult = {
  fallbacks: SpatialPlacementFallback[]
  placedIds: string[]
}

export type SpatialRuntimeStats = {
  animations: number
  geometries: number
  materials: number
  triangles: number
}

export type ThreeExperiencePermission = {
  execution: 'explicit-user-start'
  hostAccess: 'opaque-origin'
  network: 'none'
  sourceCode: 'sandboxed'
}

export type ThreeExperienceMetadata = {
  permission: ThreeExperiencePermission
  runtimeIntegrity: string
  runtimeUrl: string
  sourceId: string
  sourceRevision: number
  sourceHash: string
}
