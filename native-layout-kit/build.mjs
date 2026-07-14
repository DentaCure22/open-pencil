import { mkdir } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'

const workspace = resolve(import.meta.dir, '..')
const templatePath = resolve(import.meta.dir, 'flow-review.html')
const capturePath = resolve(workspace, 'artifacts/design-director/real-dental-chart.png')
const outputPath = resolve(workspace, 'artifacts/native-layout-kit/flow-review.inline.html')

const [template, capture] = await Promise.all([
  Bun.file(templatePath).text(),
  Bun.file(capturePath).arrayBuffer()
])

const dataURL = `data:image/jpeg;base64,${Buffer.from(capture).toString('base64')}`
const output = template.replace('__REAL_PRODUCT_CAPTURE__', dataURL)

if (output === template) throw new Error('Capture placeholder was not found')

await mkdir(dirname(outputPath), { recursive: true })
await Bun.write(outputPath, output)

console.log(outputPath)

