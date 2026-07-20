import { placeSourceObjectFiles } from '@/app/source-object/intake'
import {
  claimSpatialMediaFiles,
  classifySpatialFile,
  placeSpatialMediaFiles
} from '@/app/spatial-media'

import type { BoardFileIntakeAdapter } from './registry'

export const spatialMediaFileIntakeAdapter: BoardFileIntakeAdapter = {
  claimFiles: (files) =>
    claimSpatialMediaFiles(
      files,
      (file) => classifySpatialFile(file).disposition === 'spatial-viewer'
    ),
  id: 'spatial-media',
  matches: (file) => classifySpatialFile(file).disposition === 'spatial-viewer',
  async placeFiles(editor, files, cx, cy) {
    try {
      const result = await placeSpatialMediaFiles(editor, files, cx, cy)
      const fallbackIds = await placeSourceObjectFiles(
        editor,
        result.fallbacks.map(({ file }) => file),
        cx,
        cy
      )
      return [...result.placedIds, ...fallbackIds]
    } catch {
      return placeSourceObjectFiles(editor, files, cx, cy)
    }
  }
}
