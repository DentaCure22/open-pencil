import {
  MERMAID_DIAGRAM_REVISION,
  MERMAID_PARSER,
  type MermaidBinaryFile,
  type MermaidDiagram,
  type MermaidParser,
  type MermaidSkeletonElement
} from './types'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function isSkeletonElement(value: unknown): value is MermaidSkeletonElement {
  return isRecord(value) && typeof value.type === 'string'
}

interface ParsedDefinition {
  elements: MermaidSkeletonElement[]
  files: Record<string, MermaidBinaryFile>
}

function binaryFiles(value: unknown): Record<string, MermaidBinaryFile> {
  if (!isRecord(value)) return {}
  const files: Record<string, MermaidBinaryFile> = {}
  for (const [key, file] of Object.entries(value)) {
    if (!isRecord(file) || typeof file.dataURL !== 'string' || typeof file.mimeType !== 'string') {
      continue
    }
    files[key] = {
      id: typeof file.id === 'string' ? file.id : key,
      mimeType: file.mimeType,
      dataURL: file.dataURL
    }
  }
  return files
}

function parsedDefinition(value: unknown): ParsedDefinition {
  if (!isRecord(value) || !Array.isArray(value.elements)) {
    throw new Error('The Mermaid parser returned no diagram elements.')
  }

  return {
    elements: value.elements.filter(isSkeletonElement),
    files: binaryFiles(value.files)
  }
}

async function parseDefinition(source: string, parser: MermaidParser): Promise<ParsedDefinition> {
  return parsedDefinition(await parser(source))
}

export async function parseMermaidDiagram(
  source: string,
  parser: MermaidParser
): Promise<MermaidDiagram> {
  const definition = source.trim()
  if (!definition) throw new Error('Paste a Mermaid definition first.')

  let parsed: ParsedDefinition
  try {
    parsed = await parseDefinition(definition, parser)
  } catch (error) {
    const originalError = error
    if (!definition.includes('"')) throw error

    try {
      parsed = await parseDefinition(definition.replaceAll('"', "'"), parser)
    } catch {
      throw originalError
    }
  }

  for (const element of parsed.elements) {
    if (element.type === 'image' && (!element.fileId || !parsed.files[element.fileId])) {
      throw new Error('The Mermaid renderer returned an image without its visual data.')
    }
  }

  if (parsed.elements.length === 0) {
    throw new Error('The Mermaid definition produced an empty diagram.')
  }

  return {
    source: definition,
    revision: MERMAID_DIAGRAM_REVISION,
    parser: MERMAID_PARSER,
    elements: parsed.elements,
    files: parsed.files
  }
}
