import { isPptxFile, placePptxFiles } from '@/app/presentation-intake/intake'
import { placeSourceObjectFiles } from '@/app/source-object/intake'

import type { BoardFileIntakeAdapter } from './registry'

export const presentationFileIntakeAdapter: BoardFileIntakeAdapter = {
  id: 'presentation',
  matches: isPptxFile,
  async placeFiles(editor, files, cx, cy) {
    const result = await placePptxFiles(editor, files, cx, cy)
    const fallbackIds = await placeSourceObjectFiles(editor, result.fallbackFiles, cx, cy)
    return [...result.placedIds, ...fallbackIds]
  }
}
