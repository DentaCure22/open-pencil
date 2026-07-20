import { XMLParser } from 'fast-xml-parser'
import { strFromU8 } from 'fflate'

import { OfficePreviewError, type OfficeArchive } from './archive'

export type XmlRecord = Record<string, unknown>
export type OrderedXmlNode = Record<string, unknown>

const ARRAY_TAGS = new Set([
  'Relationship',
  'c',
  'p',
  'r',
  'row',
  'sheet',
  'si',
  'sldId',
  'sp',
  't'
])

const parser = new XMLParser({
  attributeNamePrefix: '',
  ignoreAttributes: false,
  isArray: (tagName, _path, _isLeafNode, isAttribute) => !isAttribute && ARRAY_TAGS.has(tagName),
  maxNestedTags: 80,
  parseAttributeValue: false,
  parseTagValue: false,
  processEntities: { maxTotalExpansions: 2_000 },
  removeNSPrefix: true,
  trimValues: false
})

const orderedParser = new XMLParser({
  attributeNamePrefix: '',
  ignoreAttributes: false,
  maxNestedTags: 80,
  parseAttributeValue: false,
  parseTagValue: false,
  preserveOrder: true,
  processEntities: { maxTotalExpansions: 2_000 },
  removeNSPrefix: true,
  trimValues: false
})

export function asRecord(value: unknown): XmlRecord | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as XmlRecord)
    : null
}

export function records(value: unknown): XmlRecord[] {
  if (Array.isArray(value)) {
    return value.flatMap((item) => {
      const record = asRecord(item)
      return record ? [record] : []
    })
  }
  const record = asRecord(value)
  return record ? [record] : []
}

export function child(value: unknown, key: string): XmlRecord | null {
  const record = asRecord(value)
  return record ? asRecord(record[key]) : null
}

export function children(value: unknown, key: string): XmlRecord[] {
  const record = asRecord(value)
  return record ? records(record[key]) : []
}

export function stringValue(value: unknown): string {
  if (typeof value === 'string' || typeof value === 'number') return String(value)
  const record = asRecord(value)
  return record ? stringValue(record['#text']) : ''
}

export function attribute(value: unknown, key: string): string {
  const record = asRecord(value)
  return record ? stringValue(record[key]).trim() : ''
}

export type XmlEntryVisitor = (name: string, value: unknown) => boolean | undefined

export function visitXmlEntries(value: unknown, visitor: XmlEntryVisitor): boolean {
  if (Array.isArray(value)) {
    for (const item of value) {
      if (!visitXmlEntries(item, visitor)) return false
    }
    return true
  }

  const record = asRecord(value)
  if (!record) return true
  for (const [name, item] of Object.entries(record)) {
    if (visitor(name, item) === false) return false
    if (name !== ':@' && name !== '#text' && !visitXmlEntries(item, visitor)) return false
  }
  return true
}

export function findRecords(value: unknown, key: string, limit = 1_000): XmlRecord[] {
  const result: XmlRecord[] = []
  visitXmlEntries(value, (name, item) => {
    if (name === key) result.push(...records(item).slice(0, limit - result.length))
    return result.length < limit
  })
  return result
}

export function collectText(value: unknown, tagName = 't', limit = 20_000): string {
  const parts: string[] = []
  let length = 0
  const visit = (candidate: unknown, currentKey = '') => {
    if (length >= limit) return
    if (Array.isArray(candidate)) {
      for (const item of candidate) visit(item, currentKey)
      return
    }
    const record = asRecord(candidate)
    if (!record) {
      if (currentKey !== tagName) return
      const text = stringValue(candidate)
      parts.push(text)
      length += text.length
      return
    }
    if (currentKey === tagName) {
      const text = stringValue(record)
      parts.push(text)
      length += text.length
      return
    }
    for (const [name, item] of Object.entries(record)) visit(item, name)
  }
  visit(value)
  return parts.join('').slice(0, limit)
}

export function parseXml(bytes: Uint8Array): XmlRecord {
  try {
    const parsed: unknown = parser.parse(strFromU8(bytes))
    const result = asRecord(parsed)
    if (!result) throw new Error('XML root is missing')
    return result
  } catch {
    throw new OfficePreviewError('invalid-package', 'An Office XML part could not be parsed.')
  }
}

export function parseOrderedXml(bytes: Uint8Array): OrderedXmlNode[] {
  try {
    const parsed: unknown = orderedParser.parse(strFromU8(bytes))
    if (!Array.isArray(parsed)) throw new Error('Ordered XML root is missing')
    return parsed.flatMap((item) => {
      const record = asRecord(item)
      return record ? [record] : []
    })
  } catch {
    throw new OfficePreviewError('invalid-package', 'An Office XML part could not be parsed.')
  }
}

export function packageXml(archive: OfficeArchive, path: string): XmlRecord
export function packageXml(archive: OfficeArchive, path: string, required: false): XmlRecord | null
export function packageXml(
  archive: OfficeArchive,
  path: string,
  required = true
): XmlRecord | null {
  const bytes = archive[path]
  if (!bytes) {
    if (!required) return null
    throw new OfficePreviewError('unsupported-document', `Required Office part is missing: ${path}`)
  }
  return parseXml(bytes)
}

export function packageOrderedXml(archive: OfficeArchive, path: string): OrderedXmlNode[] {
  const bytes = archive[path]
  if (!bytes) {
    throw new OfficePreviewError('unsupported-document', `Required Office part is missing: ${path}`)
  }
  return parseOrderedXml(bytes)
}

export function relationshipPath(baseDirectory: string, target: string): string | null {
  if (!target || /^[a-z]+:/i.test(target)) return null
  const segments = target.startsWith('/') ? [] : baseDirectory.split('/').filter(Boolean)
  for (const segment of target.replace(/^\//, '').split('/')) {
    if (!segment || segment === '.') continue
    if (segment === '..') {
      if (segments.length === 0) return null
      segments.pop()
      continue
    }
    segments.push(segment)
  }
  return segments.join('/')
}
