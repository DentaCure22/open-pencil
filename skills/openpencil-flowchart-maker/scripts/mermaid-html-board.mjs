#!/usr/bin/env node

import { createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { extname, resolve } from 'node:path'

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

function escapeHTML(value) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
}

function mimeType(extension) {
  if (extension === '.png') return 'image/png'
  if (extension === '.jpg' || extension === '.jpeg') return 'image/jpeg'
  if (extension === '.webp') return 'image/webp'
  return null
}

function renderedMarkup(path, bytes) {
  const extension = extname(path).toLowerCase()
  if (extension === '.svg') {
    const svg = bytes.toString('utf8').trim()
    if (!svg.startsWith('<svg') && !svg.startsWith('<?xml')) {
      throw new Error('Rendered SVG does not begin with <svg or an XML declaration')
    }
    return `<div class="diagram" data-render-format="svg">${svg}</div>`
  }

  const mime = mimeType(extension)
  if (!mime) throw new Error('Supported render formats: svg, png, jpg, jpeg, webp')
  return `<div class="diagram" data-render-format="${extension.slice(1)}"><img src="data:${mime};base64,${bytes.toString('base64')}" alt=""></div>`
}

function safeMetadata(metadata) {
  return JSON.stringify(metadata).replaceAll('<', '\\u003c')
}

const values = parseArguments(process.argv.slice(2))
const sourcePath = resolve(required(values, 'source'))
const renderPath = resolve(required(values, 'render'))
const outputPath = resolve(required(values, 'output'))
const source = await readFile(sourcePath, 'utf8')
const render = await readFile(renderPath)
const sourceHash = createHash('sha256').update(source).digest('hex')
const title = values.get('title') ?? 'Mermaid diagram'
const artifactId = values.get('artifact-id') ?? `mermaid-${sourceHash.slice(0, 12)}`
const diagramType = values.get('diagram-type') ?? source.trimStart().split(/\s+/u)[0] ?? 'unknown'
const renderer = values.get('renderer') ?? '@mermaid-js/mermaid-cli'
const renderFormat = extname(renderPath).slice(1).toLowerCase()
const metadata = {
  artifactId,
  diagramType,
  editingModel: 'mermaid-source',
  kind: 'mermaid-diagram',
  renderFormat,
  renderer,
  source,
  sourceHash,
  title
}

const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHTML(title)}</title>
  <style>
    :root { color-scheme: light; font-family: Inter, ui-sans-serif, system-ui, sans-serif; }
    * { box-sizing: border-box; }
    html, body { min-height: 100%; margin: 0; }
    body { background: #f7f7f5; color: #191919; }
    main { width: 100%; min-height: 100vh; padding: clamp(24px, 4vw, 56px); }
    header { display: flex; align-items: baseline; justify-content: space-between; gap: 24px; margin-bottom: 24px; }
    h1 { margin: 0; font-size: clamp(20px, 2vw, 30px); line-height: 1.15; letter-spacing: -0.025em; }
    .status { color: #6b6b68; font-size: 12px; white-space: nowrap; }
    .diagram { display: grid; min-height: calc(100vh - 150px); place-items: center; overflow: auto; }
    .diagram > svg, .diagram > img { display: block; max-width: 100%; max-height: calc(100vh - 150px); }
    @media (max-width: 600px) {
      main { padding: 22px 18px; }
      header { align-items: flex-start; flex-direction: column; gap: 6px; margin-bottom: 16px; }
      .diagram { min-height: calc(100vh - 126px); }
      .diagram > svg, .diagram > img { max-height: calc(100vh - 126px); }
    }
  </style>
</head>
<body>
  <main data-openpencil-width="1440" data-openpencil-height="900" data-artifact-id="${escapeHTML(artifactId)}">
    <header>
      <h1>${escapeHTML(title)}</h1>
      <span class="status">Mermaid source-editable</span>
    </header>
    ${renderedMarkup(renderPath, render)}
  </main>
  <script type="application/vnd.openpencil.mermaid+json" data-openpencil-artifact>${safeMetadata(metadata)}</script>
</body>
</html>
`

await writeFile(outputPath, html)
process.stdout.write(`${outputPath}\n${sourceHash}\n`)
