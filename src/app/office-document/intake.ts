import { placeSourceObjectFiles } from '@/app/source-object/intake'

import type { BoardFileIntakeAdapter } from '../file-intake/registry'
import { isOfficeDocumentFile } from './source'

export const OFFICE_DOCUMENT_SIZE = { height: 500, width: 720 }

export const officeDocumentFileIntakeAdapter: BoardFileIntakeAdapter = {
  id: 'office-document',
  matches: isOfficeDocumentFile,
  placeFiles: (editor, files, cx, cy) =>
    placeSourceObjectFiles(editor, files, cx, cy, {
      label: files.length === 1 ? 'Place Office document' : 'Place Office documents',
      size: OFFICE_DOCUMENT_SIZE
    })
}
