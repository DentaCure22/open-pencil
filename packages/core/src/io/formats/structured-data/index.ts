import type { IOFormatAdapter } from '#core/io/types'

import { csvToSceneGraph } from './csv'
import { jsonToSceneGraph } from './json'
import type { CSVRowsParser } from './types'

function lowerExtension(name: string): string {
  const match = /\.([^.]+)$/.exec(name.toLowerCase())
  return match?.[1] ?? ''
}

function matchesNamedExtension(
  fileName: string,
  extension: string,
  mimeType: string | undefined,
  namelessMimeTypes: string[]
): boolean {
  const namedExtension = lowerExtension(fileName)
  if (namedExtension) return namedExtension === extension
  return mimeType !== undefined && namelessMimeTypes.includes(mimeType)
}

/** Keep JSON matching filename-first so named `.pen` documents are never claimed by MIME alone. */
export const jsonFormat: IOFormatAdapter = {
  id: 'json',
  label: 'JSON / JSON Schema',
  role: 'interchange-document',
  category: 'document',
  extensions: ['json'],
  mimeTypes: ['application/json', 'application/schema+json'],
  support: {
    readDocument: true
  },
  matchesFile(fileName, mimeType) {
    return matchesNamedExtension(fileName, 'json', mimeType, [
      'application/json',
      'application/schema+json'
    ])
  },
  async readDocument(input) {
    const source = new TextDecoder('utf-8', { ignoreBOM: true }).decode(input.data)
    return {
      graph: jsonToSceneGraph(source, {
        fileName: input.name,
        mimeType: input.mimeType
      }),
      sourceFormat: 'json'
    }
  }
}

/** Keep the projection parser-agnostic by supplying the CSV parser at the registry boundary. */
export function createCSVFormat(parseRows: CSVRowsParser): IOFormatAdapter {
  return {
    id: 'csv',
    label: 'CSV',
    role: 'interchange-document',
    category: 'document',
    extensions: ['csv'],
    mimeTypes: ['text/csv', 'application/csv'],
    support: {
      readDocument: true
    },
    matchesFile(fileName, mimeType) {
      return matchesNamedExtension(fileName, 'csv', mimeType, ['text/csv', 'application/csv'])
    },
    async readDocument(input) {
      const source = new TextDecoder('utf-8', { ignoreBOM: true }).decode(input.data)
      return {
        graph: csvToSceneGraph(source, parseRows, {
          fileName: input.name,
          mimeType: input.mimeType
        }),
        sourceFormat: 'csv'
      }
    }
  }
}

export { csvToSceneGraph } from './csv'
export { jsonToSceneGraph, looksLikeJSONSchema } from './json'
export { readStructuredDataNode } from './metadata'
export type {
  CSVRow,
  CSVRowsParser,
  JSONPrimitive,
  JSONValue,
  JSONValueType,
  StructuredDataImportOptions,
  StructuredDataNodeKind,
  StructuredDataNodeMetadata
} from './types'
