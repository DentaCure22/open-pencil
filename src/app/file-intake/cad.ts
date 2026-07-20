import { classifyCadFile, placeCadDrawingFiles } from '@/app/cad'

import type { BoardFileIntakeAdapter } from './registry'

export const cadFileIntakeAdapter: BoardFileIntakeAdapter = {
  id: 'cad-drawing',
  matches: (file) => classifyCadFile(file)?.disposition === 'cad-viewer',
  placeFiles: placeCadDrawingFiles
}
