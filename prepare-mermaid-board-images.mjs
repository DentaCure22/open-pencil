import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const sharp = require('/Users/omar/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/sharp')

const dir = '/Users/omar/Documents/Open Pencil/artifacts/mermaid-gallery'
const targets = {
  'edit-flow': [764, 1592],
  'agent-sequence': [1588, 1592],
  'edit-state': [764, 1592],
  'workspace-er': [1424, 1592],
  'type-mindmap': [1790, 1592],
  'rollout-gantt': [3312, 476],
  'design-radar': [1608, 930],
  'type-treemap': [1608, 930]
}

for (const [name, [width, height]] of Object.entries(targets)) {
  await sharp(`${dir}/${name}.png`)
    .flatten({ background: '#FFFFFF' })
    .resize({
      width,
      height,
      fit: 'contain',
      background: '#FFFFFF',
      kernel: 'lanczos3'
    })
    .png()
    .toFile(`${dir}/${name}-board.png`)
}

process.stdout.write(`Prepared ${Object.keys(targets).length} board-safe Mermaid images\n`)
