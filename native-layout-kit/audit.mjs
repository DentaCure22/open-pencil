const input = process.argv[2]
if (!input) throw new Error('Usage: bun audit.mjs <imported-design-document.json>')

const document = await Bun.file(input).json()
const nodes = []

function visit(node, surfaceDepth = 0) {
  const isSurface = node.type === 'element' && node.attrs?.['data-surface'] === 'true'
  const nextDepth = surfaceDepth + (isSurface ? 1 : 0)
  nodes.push({ node, surfaceDepth: nextDepth })
  for (const child of node.children ?? []) visit(child, nextDepth)
}

visit(document)

const elements = nodes.filter(({ node }) => node.type === 'element')
const textNodes = nodes.filter(({ node }) => node.type === 'text')
const images = elements.filter(({ node }) => node.tagName === 'img')
const fontSizes = new Set(
  nodes
    .map(({ node }) => node.computedStyle?.['font-size'])
    .filter(Boolean)
)
const maxSurfaceDepth = Math.max(...nodes.map(({ surfaceDepth }) => surfaceDepth))
const primaryStates = elements.filter(({ node }) => node.attrs?.class?.split(/\s+/).includes('state'))
const capture = images.find(({ node }) => node.attrs?.class === 'capture')
const captureWidth = Number.parseFloat(capture?.node.computedStyle?.width ?? '0')
const mainWidth = 1472
const captureShare = captureWidth / mainWidth

const checks = [
  ['one document root', document.type === 'document'],
  ['real capture embedded', images.some(({ node }) => node.attrs?.src?.startsWith('data:image/'))],
  ['capture is at least 55% of main row', captureShare >= 0.55],
  ['surface depth is at most one', maxSurfaceDepth <= 1],
  ['no more than four text sizes', fontSizes.size <= 4],
  ['exactly three primary states', primaryStates.length === 3],
  ['editable text exists', textNodes.length > 0]
]

const result = {
  passed: checks.every(([, passed]) => passed),
  checks: checks.map(([name, passed]) => ({ name, passed })),
  evidence: {
    elements: elements.length,
    textNodes: textNodes.length,
    imageNodes: images.length,
    fontSizes: [...fontSizes],
    maxSurfaceDepth,
    primaryStates: primaryStates.length,
    captureShare: Number(captureShare.toFixed(3))
  }
}

console.log(JSON.stringify(result, null, 2))
if (!result.passed) process.exit(1)

