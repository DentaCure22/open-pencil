import type { ContentSourceMetadata } from '@open-pencil/core/io'
import type { Vector } from '@open-pencil/scene-graph/primitives'

export type CadSourceFormat = 'brep' | 'dwg' | 'dxf' | 'iges' | 'step'

export type CadDrawingClassification = {
  disposition: 'cad-viewer'
  format: 'dxf'
  kind: 'cad-drawing'
  label: string
  reason: string
}

export type CadFallbackClassification = {
  disposition: 'generic-source'
  format: CadSourceFormat
  kind: 'engineering-cad'
  label: string
  reason: string
  fidelity: {
    editable: false
    topology: 'unverified'
    units: 'retained-only' | 'unverified'
  }
}

export type CadFileClassification = CadDrawingClassification | CadFallbackClassification | null

export type CadDrawingSource = {
  assetHash: string
  fileName: string
  format: 'dxf'
  metadata: ContentSourceMetadata
}

export type CadPoint = Vector

export type CadDrawingBounds = {
  height: number
  maxX: number
  maxY: number
  minX: number
  minY: number
  width: number
}

export type CadDrawingPath = {
  closed: boolean
  color: string
  layer: string
  points: CadPoint[]
}

export type CadDrawingText = {
  color: string
  content: string
  height: number
  layer: string
  rotation: number
  x: number
  y: number
}

export type CadDrawing = {
  bounds: CadDrawingBounds
  entityCount: number
  layerCount: number
  omittedEntityCount: number
  paths: CadDrawingPath[]
  renderedEntityCount: number
  texts: CadDrawingText[]
  units: string
}
