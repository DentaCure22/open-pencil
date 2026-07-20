import type { CadFileClassification, CadSourceFormat } from './types'

export const MAX_DXF_SOURCE_BYTES = 8 * 1024 * 1024

export const CAD_ADAPTER_STAGES = [
  'Retain exact source bytes, identity, and download access for every recognized CAD format.',
  'Render bounded ASCII DXF as a read-only 2D reference while preserving omitted-entity counts.',
  'Add a pinned CAD kernel only after STEP, IGES, and BREP fixtures prove units, assemblies, topology, and deterministic tessellation.'
] as const

const CAD_EXTENSIONS = new Map<string, CadSourceFormat>([
  ['brep', 'brep'],
  ['dwg', 'dwg'],
  ['dxf', 'dxf'],
  ['iges', 'iges'],
  ['igs', 'iges'],
  ['step', 'step'],
  ['stp', 'step']
])

const CAD_MIME_TYPES = new Map<string, CadSourceFormat>([
  ['application/dxf', 'dxf'],
  ['application/step', 'step'],
  ['image/vnd.dwg', 'dwg'],
  ['image/vnd.dxf', 'dxf'],
  ['model/iges', 'iges'],
  ['model/step', 'step'],
  ['model/vnd.opencascade.brep', 'brep']
])

function extension(fileName: string): string {
  return fileName.match(/\.([^.]+)$/)?.[1]?.toLowerCase() ?? ''
}

function fallbackReason(format: CadSourceFormat, oversize = false): string {
  if (format === 'dxf' && oversize) {
    return `The read-only DXF viewer accepts at most ${MAX_DXF_SOURCE_BYTES} bytes; exact source bytes remain available.`
  }
  if (format === 'dwg') {
    return 'DWG is proprietary and has no verified local parser in this build; exact source bytes remain available.'
  }
  return `${format.toUpperCase()} needs a pinned CAD kernel plus unit and topology fixtures; exact source bytes remain available.`
}

export function classifyCadFile(file: Pick<File, 'name' | 'size' | 'type'>): CadFileClassification {
  const format =
    CAD_EXTENSIONS.get(extension(file.name || '')) ??
    CAD_MIME_TYPES.get(file.type.trim().toLowerCase())
  if (!format) return null
  if (format === 'dxf' && file.size <= MAX_DXF_SOURCE_BYTES) {
    return {
      disposition: 'cad-viewer',
      format,
      kind: 'cad-drawing',
      label: 'Read-only DXF drawing',
      reason:
        'Render bounded 2D entities locally while retaining the exact source for download and future adapters.'
    }
  }
  return {
    disposition: 'generic-source',
    fidelity: {
      editable: false,
      topology: 'unverified',
      units: format === 'dxf' ? 'retained-only' : 'unverified'
    },
    format,
    kind: 'engineering-cad',
    label: `${format.toUpperCase()} engineering CAD source`,
    reason: fallbackReason(format, format === 'dxf')
  }
}

export function cadFallbackDescription(format: string): string | null {
  const normalized = format.toLowerCase()
  const cadFormat = CAD_EXTENSIONS.get(normalized)
  if (!cadFormat) return null
  return fallbackReason(cadFormat, cadFormat === 'dxf')
}
