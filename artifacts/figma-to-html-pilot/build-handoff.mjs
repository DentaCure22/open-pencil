#!/usr/bin/env node

import { createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { basename, resolve } from 'node:path'

const MODES = new Set(['absolute-fidelity', 'component-aware-responsive'])

function parseArguments(argv) {
  const values = new Map()
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index]
    if (!key?.startsWith('--')) throw new Error(`Unexpected argument: ${key ?? ''}`)
    const value = argv[index + 1]
    if (!value || value.startsWith('--')) throw new Error(`Missing value for ${key}`)
    values.set(key.slice(2), value)
    index += 1
  }
  return values
}

function required(values, key) {
  const value = values.get(key)
  if (!value) throw new Error(`Missing required --${key}`)
  return value
}

function dimension(values, key) {
  const value = Number(required(values, key))
  if (!Number.isInteger(value) || value < 240 || value > 3840) {
    throw new Error(`--${key} must be an integer between 240 and 3840`)
  }
  return value
}

function safeMetadata(value) {
  return JSON.stringify(value).replaceAll('<', '\\u003c')
}

function contentHash(value) {
  return createHash('sha256').update(value).digest('hex')
}

function parseFigmaNodeURL(value) {
  const url = new URL(value)
  if (url.hostname !== 'figma.com' && !url.hostname.endsWith('.figma.com')) {
    throw new Error('--figma-url must point to figma.com')
  }
  const segments = url.pathname.split('/').filter(Boolean)
  if (!['design', 'file'].includes(segments[0]) || !segments[1]) {
    throw new Error('--figma-url must be a Figma Design file URL')
  }
  const branchIndex = segments.indexOf('branch')
  const fileKey = branchIndex !== -1 ? segments[branchIndex + 1] : segments[1]
  const rawNodeId = url.searchParams.get('node-id')
  if (!fileKey || !rawNodeId || !/^\d+[-:]\d+$/.test(rawNodeId)) {
    throw new Error('--figma-url must include a concrete node-id')
  }
  const nodeId = rawNodeId.replace('-', ':')
  return { fileKey, nodeId, source: url.toString() }
}

function setAttribute(tag, name, value) {
  const attribute = `${name}="${value}"`
  const pattern = new RegExp(`\\s${name}=(?:"[^"]*"|'[^']*')`, 'i')
  if (pattern.test(tag)) return tag.replace(pattern, ` ${attribute}`)
  return tag.replace(/>$/, ` ${attribute}>`)
}

function annotateRoot(html, metadata, mode, width, height) {
  const mainPattern = /<main\b[^>]*>/i
  const bodyPattern = /<body\b[^>]*>/i
  const target = html.match(mainPattern)?.[0] ?? html.match(bodyPattern)?.[0]
  if (!target) throw new Error('Input HTML must include a <main> or <body> element')

  let annotated = target
  annotated = setAttribute(annotated, 'data-openpencil-width', String(width))
  annotated = setAttribute(annotated, 'data-openpencil-height', String(height))
  annotated = setAttribute(annotated, 'data-openpencil-component', 'FigmaExport')
  annotated = setAttribute(annotated, 'data-openpencil-variant', mode)
  annotated = setAttribute(annotated, 'data-artifact-id', metadata.artifactId)
  return html.replace(target, annotated)
}

function injectMetadata(html, metadata) {
  const withoutPrevious = html.replace(
    /<script\b[^>]*\bdata-openpencil-artifact(?:\s*=\s*["'][^"']*["'])?[^>]*>[\s\S]*?<\/script\s*>/gi,
    ''
  )
  const script = `<script type="application/vnd.openpencil.figma+json" data-openpencil-artifact>${safeMetadata(metadata)}</script>`
  if (/<\/body>/i.test(withoutPrevious)) {
    return withoutPrevious.replace(/<\/body>/i, `${script}</body>`)
  }
  return `${withoutPrevious}\n${script}\n`
}

const values = parseArguments(process.argv.slice(2))
const inputPath = resolve(required(values, 'input-html'))
const outputPath = resolve(required(values, 'output'))
const mode = required(values, 'mode')
if (!MODES.has(mode)) throw new Error(`Unsupported --mode: ${mode}`)

const width = dimension(values, 'width')
const height = dimension(values, 'height')
const inputHTML = await readFile(inputPath, 'utf8')
const snapshotPath = values.get('source-snapshot')
const snapshot = snapshotPath ? await readFile(resolve(snapshotPath)) : Buffer.from(inputHTML)
const figmaURL = values.get('figma-url')
const sourceFile = values.get('source-file')
if (Boolean(figmaURL) === Boolean(sourceFile)) {
  throw new Error('Provide exactly one of --figma-url or --source-file')
}

const source = figmaURL
  ? parseFigmaNodeURL(figmaURL)
  : {
      fileKey: 'local-fixture',
      nodeId: '0:0',
      source: values.get('source-label') ?? basename(required(values, 'source-file'))
    }
const artifactId =
  values.get('artifact-id') ??
  `figma-${source.fileKey}-${source.nodeId.replace(':', '-')}`.replace(/[^a-z0-9-]+/gi, '-')
const metadata = {
  artifactId,
  diagramType: figmaURL ? 'figma-node' : 'fig-fixture',
  editingModel:
    mode === 'absolute-fidelity'
      ? 'figma-source-absolute-export'
      : 'responsive-html-with-component-receipt',
  kind: 'figma-to-html-board',
  renderFormat: mode === 'absolute-fidelity' ? 'html-absolute' : 'html-responsive',
  renderer:
    values.get('renderer') ??
    (mode === 'absolute-fidelity' ? '@open-pencil/dom-css' : 'figma-mcp/get_design_context'),
  source: source.source,
  sourceHash: contentHash(snapshot),
  title: values.get('title') ?? 'Figma HTML pilot'
}

const annotated = annotateRoot(inputHTML, metadata, mode, width, height)
await writeFile(outputPath, injectMetadata(annotated, metadata))
process.stdout.write(
  `${JSON.stringify({ artifactId, fileKey: source.fileKey, mode, nodeId: source.nodeId, outputPath, sourceHash: metadata.sourceHash, viewport: { height, width } }, null, 2)}\n`
)
