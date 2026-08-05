import { isOfficeFile, placeOfficeFiles } from '@/app/office-intake/intake'
import { placeSourceObjectFiles } from '@/app/source-object/intake'

import type { BoardFileIntakeAdapter } from './registry'

export const officeFileIntakeAdapter: BoardFileIntakeAdapter = {
  id: 'office',
  matches: isOfficeFile,
  async placeFiles(editor, files, cx, cy) {
    const result = await placeOfficeFiles(editor, files, cx, cy)
    const fallbackIds = await placeSourceObjectFiles(editor, result.fallbackFiles, cx, cy)
    return [...result.placedIds, ...fallbackIds]
  }
}
