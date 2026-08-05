import { isPdfFile, placePdfFiles } from '@/app/pdf-intake/intake'

import type { BoardFileIntakeAdapter } from './registry'

export const pdfFileIntakeAdapter: BoardFileIntakeAdapter = {
  id: 'pdf-code-object',
  matches: isPdfFile,
  placeFiles: placePdfFiles
}
