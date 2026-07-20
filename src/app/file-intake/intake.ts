import type { Editor } from '@open-pencil/core/editor'

import { placeMediaEvidenceFiles } from '@/app/media-evidence/intake'
import { placeSourceObjectFiles, SOURCE_OBJECT_SIZE } from '@/app/source-object/intake'

import { cadFileIntakeAdapter } from './cad'
import { classifyBoardFile } from './classify'
import { boardFileIntakeRegistry, type BoardFileIntakeAdapter } from './registry'
import { spatialMediaFileIntakeAdapter } from './spatial-media'

const unregisterCadFileIntake = boardFileIntakeRegistry.register(cadFileIntakeAdapter)
const unregisterSpatialMediaIntake = boardFileIntakeRegistry.register(spatialMediaFileIntakeAdapter)

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    unregisterCadFileIntake()
    unregisterSpatialMediaIntake()
  })
}

export type FileIntakeResult = {
  ids: string[]
  mediaIds: string[]
  sourceObjectIds: string[]
  specializedIds: string[]
}

function sourceObjectCenterY(editor: Editor, mediaIds: string[], fallbackY: number): number {
  if (mediaIds.length === 0) return fallbackY
  const bottom = Math.max(
    ...mediaIds.map((id) => {
      const bounds = editor.graph.getAbsoluteBounds(id)
      return bounds.y + bounds.height
    })
  )
  return bottom + 32 + SOURCE_OBJECT_SIZE.height / 2
}

export async function placeFileIntakeFiles(
  editor: Editor,
  files: File[],
  cx: number,
  cy: number
): Promise<FileIntakeResult> {
  const mediaFiles: File[] = []
  const sourceFiles: File[] = []
  const specializedFiles = new Map<BoardFileIntakeAdapter, File[]>()
  for (const file of files) {
    const classification = classifyBoardFile(file)
    if (classification.kind === 'media') {
      mediaFiles.push(file)
      continue
    }
    if (classification.kind === 'specialized') {
      const adapter = boardFileIntakeRegistry.find(file)
      if (adapter) {
        const bucket = specializedFiles.get(adapter) ?? []
        bucket.push(file)
        specializedFiles.set(adapter, bucket)
        continue
      }
    }
    sourceFiles.push(file)
  }

  const specializedIds: string[] = []
  for (const [adapter, adapterFiles] of specializedFiles) {
    specializedIds.push(...(await adapter.placeFiles(editor, adapterFiles, cx, cy)))
  }
  const mediaIds = await placeMediaEvidenceFiles(editor, mediaFiles, cx, cy)
  const sourceObjectIds = await placeSourceObjectFiles(
    editor,
    sourceFiles,
    cx,
    sourceObjectCenterY(editor, mediaIds, cy)
  )
  return {
    ids: [...specializedIds, ...mediaIds, ...sourceObjectIds],
    mediaIds,
    sourceObjectIds,
    specializedIds
  }
}
