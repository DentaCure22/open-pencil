import { mkdir, readFile, writeFile } from 'node:fs/promises'

import { Client } from '/Users/omar/Documents/Documents - Omar’s MacBook Pro/Codex/Smylr-Elite/archive/agent-tooling/open-pencil-base/node_modules/.bun/@modelcontextprotocol+sdk@1.28.0/node_modules/@modelcontextprotocol/sdk/dist/esm/client/index.js'
import { StreamableHTTPClientTransport } from '/Users/omar/Documents/Documents - Omar’s MacBook Pro/Codex/Smylr-Elite/archive/agent-tooling/open-pencil-base/node_modules/.bun/@modelcontextprotocol+sdk@1.28.0/node_modules/@modelcontextprotocol/sdk/dist/esm/client/streamableHttp.js'

const artifactDir = '/Users/omar/Documents/Open Pencil/artifacts/design-director'
const capturePath = `${artifactDir}/real-dental-chart.png`
const outputPath = `${artifactDir}/real-product-review-v1.png`
const rootName = 'Design Review / Real Dental Chart'
const pageName = 'Page 1'

const client = new Client({ name: 'openpencil-real-product-review', version: '1.0.0' })
const transport = new StreamableHTTPClientTransport(new URL('http://127.0.0.1:7600/mcp'), {
  requestInit: { headers: { Authorization: 'Bearer codex-canvas-demo' } }
})

await client.connect(transport)

let automationTarget = {}

async function call(name, args = {}) {
  const result = await client.callTool({
    name,
    arguments: name === 'list_documents' ? args : { ...automationTarget, ...args }
  })
  if (result.isError) throw new Error(result.content?.[0]?.text ?? `${name} failed`)
  const text = result.content?.find((item) => item.type === 'text')?.text
  const parsed = text ? JSON.parse(text) : result
  if (parsed?.error) throw new Error(`${name}: ${parsed.error}`)
  return parsed
}

const C = {
  canvas: '#0D1016',
  shell: '#151A23',
  shell2: '#1B2230',
  shell3: '#242C3B',
  line: '#30394A',
  ink: '#F8FAFC',
  text: '#C8D0DD',
  muted: '#8792A3',
  paper: '#F5F3EE',
  paperInk: '#1A1D24',
  paperText: '#4E5663',
  paperLine: '#D8D5CE',
  blue: '#77A7FF',
  blueDeep: '#2E6DE6',
  green: '#70D6A7',
  amber: '#F5BE73'
}

const marker = (number, top, left) => `<Frame name="Annotation ${number}" position="absolute" top={${top}} left={${left}} w={38} h={38} bg="${C.blueDeep}" rounded={19} stroke="#DCE8FF" strokeWidth={2} shadow="0 5 14 #0D101699" overflow="hidden"><Text w={38} h={38} textAutoResize="none" textAlign="center" textAlignVertical="center" size={12} weight="bold" color="#FFFFFF">${number}</Text></Frame>`

const callout = (number, kicker, title, body) => `<Frame w="fill" h={126} flex="col" gap={8}>
  <Frame w="fill" h={24} flex="row" gap={10} items="center"><Frame w={24} h={24} bg="${C.blueDeep}" rounded={12} overflow="hidden"><Text w={24} h={24} textAutoResize="none" textAlign="center" textAlignVertical="center" size={10} weight="bold" color="#FFFFFF">${number}</Text></Frame><Text w="fill" h={14} textAutoResize="none" size={10} weight="bold" letterSpacing={1.1} color="${C.paperText}">${kicker}</Text></Frame>
  <Text w="fill" h={42} textAutoResize="height" maxLines={2} size={18} weight="bold" lineHeight={21} color="${C.paperInk}">${title}</Text>
  <Text w="fill" h={36} textAutoResize="height" maxLines={2} size={12} lineHeight={17} color="${C.paperText}">${body}</Text>
</Frame>`

const stage = (number, title, detail, active = false) => `<Frame w="fill" h="fill" flex="row" gap={14} items="center">
  <Frame w={34} h={34} bg="${active ? C.blueDeep : C.shell3}" rounded={17} stroke="${active ? '#A9C6FF' : C.line}" overflow="hidden"><Text w={34} h={34} textAutoResize="none" textAlign="center" textAlignVertical="center" size={10} weight="bold" color="${active ? '#FFFFFF' : C.muted}">${number}</Text></Frame>
  <Frame w="fill" h={36} flex="col" gap={3}><Text w="fill" h={16} textAutoResize="none" size={13} weight="bold" color="${active ? C.ink : C.text}">${title}</Text><Text w="fill" h={13} textAutoResize="none" size={10} color="${C.muted}">${detail}</Text></Frame>
</Frame>`

const board = `<Frame name="${rootName}" w={1800} h={1160} flex="col" gap={26} p={46} bg="${C.canvas}" rounded={28}>
  <Frame name="Review header" w="fill" h={126} flex="row" gap={28} items="start">
    <Frame w="fill" h="fill" flex="col" gap={9}>
      <Frame w="hug" h={24} flex="row" gap={9} items="center"><Frame w={8} h={8} bg="${C.green}" rounded={4}/><Text size={11} weight="bold" letterSpacing={1.5} color="${C.green}">REAL PRODUCT REVIEW · DENTAL CHART</Text></Frame>
      <Text size={42} weight="bold" letterSpacing={-1.2} color="${C.ink}">Make the next clinical step unmistakable.</Text>
      <Text size={14} color="${C.muted}">The production interface is the evidence. The board only guides attention and decisions around it.</Text>
    </Frame>
    <Frame w={286} h={86} flex="col" gap={8} p={16} bg="${C.shell}" rounded={16} stroke="${C.line}">
      <Frame w="fill" h={22} flex="row" gap={8} items="center"><Frame w={10} h={10} bg="${C.blue}" rounded={3}/><Text size={11} weight="bold" color="${C.blue}">CAPTURED FROM /DENTAL-CHART</Text></Frame>
      <Text size={12} color="${C.text}">Production source unchanged</Text>
      <Text size={11} color="${C.muted}">Captured in the live Smylr app</Text>
    </Frame>
  </Frame>

  <Frame name="Evidence and decision" w="fill" h={786} flex="row" gap={28}>
    <Frame name="Primary evidence column" w={1268} h="fill" flex="col" gap={12}>
      <Frame name="Screen shell" w="fill" h={746} flex="col" p={14} bg="${C.shell}" rounded={24} stroke="${C.line}" shadow="0 18 42 #05070A88">
        <Frame name="Product capture stage" w="fill" h="fill" bg="#F3F6FC" rounded={16} overflow="hidden">
          <Rectangle name="Production Capture / Real Dental Chart" position="absolute" top={0} left={0} w={1240} h={718} bg="#F3F6FC"/>
          ${marker('01', 78, 617)}
          ${marker('02', 507, 246)}
          ${marker('03', 507, 1054)}
        </Frame>
      </Frame>
      <Frame w="fill" h={28} flex="row" gap={10} items="center"><Frame w={8} h={8} bg="${C.blue}" rounded={4}/><Text size={11} color="${C.muted}">Saved product capture · annotations are canvas overlays · no source code changed</Text></Frame>
    </Frame>

    <Frame name="Decision rail" w="fill" h="fill" flex="col" gap={12} p={26} bg="${C.paper}" rounded={24} overflow="hidden">
      <Text w="fill" h={14} textAutoResize="none" size={10} weight="bold" letterSpacing={1.4} color="${C.blueDeep}">DESIGN QUESTION</Text>
      <Text w="fill" h={70} textAutoResize="height" maxLines={3} size={26} weight="bold" lineHeight={30} letterSpacing={-0.4} color="${C.paperInk}">Where should the interface guide the clinician next?</Text>
      <Frame w="fill" h={1} bg="${C.paperLine}"/>
      ${callout('01', 'PROTECT THE ANCHOR', 'Keep the odontogram dominant.', 'Preserve its scale, tooth detail, and full-width scan pattern.')}
      <Frame w="fill" h={1} bg="${C.paperLine}"/>
      ${callout('02', 'KEEP THE EVIDENCE', 'History stays in the working view.', 'Keep the procedure trail visible while the clinician chooses or reviews.')}
      <Frame w="fill" h={1} bg="${C.paperLine}"/>
      ${callout('03', 'CREATE THE NEXT MOVE', 'Turn the empty plan into guidance.', 'Put the contextual action inside this panel—not in another card.')}
      <Frame w="fill" h={88} flex="col" gap={5} p={14} bg="#E5EDFF" rounded={14}>
        <Text w="fill" h={13} textAutoResize="none" size={10} weight="bold" color="${C.blueDeep}">PROPOSED EDIT BRANCH</Text>
        <Text w="fill" h={18} textAutoResize="none" size={13} weight="bold" color="${C.paperInk}">Guide inside the real treatment panel.</Text>
        <Text w="fill" h={16} textAutoResize="none" size={11} color="${C.paperText}">Preserve every other product pixel.</Text>
      </Frame>
    </Frame>
  </Frame>

  <Frame name="Flow footer" w="fill" h={130} flex="row" gap={22} p={22} bg="${C.shell}" rounded={20} stroke="${C.line}">
    <Frame w={240} h="fill" flex="col" gap={7}><Text w={220} h={13} textAutoResize="none" size={10} weight="bold" letterSpacing={1.2} color="${C.blue}">SAFE EDIT FLOW</Text><Text w={220} h={22} textAutoResize="none" size={18} weight="bold" color="${C.ink}">One artifact, four states.</Text><Text w={220} h={34} textAutoResize="height" maxLines={2} size={10} lineHeight={15} color="${C.muted}">Only the production capture is real now. Later states inherit its pixels.</Text></Frame>
    <Frame w="fill" h="fill" flex="row" gap={12} items="center">
      ${stage('01', 'Production capture', 'Current live product', true)}
      <Frame w={48} h={1} bg="${C.line}"/>
      ${stage('02', 'Edit branch', 'Localized proposed change')}
      <Frame w={48} h={1} bg="${C.line}"/>
      ${stage('03', 'Review decision', 'Accept, revise, or archive')}
      <Frame w={48} h={1} bg="${C.line}"/>
      ${stage('04', 'Source handoff', 'Explicit patch + verification')}
    </Frame>
  </Frame>
</Frame>`

await mkdir(artifactDir, { recursive: true })
const capture = await readFile(capturePath)

const documents = await call('list_documents')
const activeDocument =
  documents.documents.find((candidate) => candidate.active) ??
  (documents.documents.length === 1 ? documents.documents[0] : undefined)
if (!activeDocument) throw new Error('No unambiguous active OpenPencil document')
automationTarget = {
  document_id: activeDocument.id,
  page_id: activeDocument.current_page_id
}

const pages = await call('list_pages')
const page =
  pages.pages.find((candidate) => candidate.name === pageName) ??
  (await call('create_page', { name: pageName }))
await call('switch_page', { page: page.id })

for (const oldName of [
  'Design Director / 01 Flow Overview',
  'Design Director / 02 Active Charting Focus',
  'Design Director / 03 Versions Review',
  'Design Director / 04 Knowledge Detail'
]) {
  const old = await call('find_nodes', { name: oldName, type: 'FRAME' })
  for (const node of old.nodes.filter((candidate) => candidate.name === oldName)) {
    await call('set_visible', { id: node.id, value: false })
  }
}

const existing = await call('find_nodes', { name: rootName, type: 'FRAME' })
const exact = existing.nodes.filter((candidate) => candidate.name === rootName)
const rendered = await call('render', {
  parent_id: page.id,
  x: 0,
  y: 0,
  ...(exact[0] ? { replace_id: exact[0].id } : {}),
  jsx: board
})
for (const duplicate of exact.slice(1)) await call('set_visible', { id: duplicate.id, value: false })

const renderedTree = await call('get_page_tree', { root_id: rendered.id, depth: 8 })
function findTreeNode(node, name) {
  if (!node) return undefined
  if (node.name === name) return node
  for (const child of node.children ?? []) {
    const match = findTreeNode(child, name)
    if (match) return match
  }
  return undefined
}
const captureNode = findTreeNode(renderedTree.tree, 'Production Capture / Real Dental Chart')
if (!captureNode) throw new Error('Production capture placeholder was not found after render')

await call('set_image_fill', {
  id: captureNode.id,
  image_data: capture.toString('base64'),
  scale_mode: 'FIT'
})

await call('switch_page', { page: page.id })
await call('select_nodes', { ids: [rendered.id] })
await call('viewport_zoom_to_fit', { ids: [rendered.id] })

const exported = await client.callTool({
  name: 'export_image',
  arguments: { ...automationTarget, ids: [rendered.id], format: 'PNG', scale: 1 }
})
if (exported.isError) {
  throw new Error(exported.content?.find((item) => item.type === 'text')?.text ?? 'Export failed')
}
const image = exported.content?.find((item) => item.type === 'image')
const text = exported.content?.find((item) => item.type === 'text')?.text
const metadata = text ? JSON.parse(text) : {}
const base64 = image?.data ?? metadata.base64
if (!base64) throw new Error('Export returned no PNG payload')
await writeFile(outputPath, Buffer.from(base64, 'base64'))

const analysis = {}
for (const name of ['analyze_overlaps', 'analyze_colors', 'analyze_typography', 'analyze_spacing']) {
  analysis[name] = await call(name).catch((error) => ({ error: error.message }))
}

console.log(
  JSON.stringify(
    {
      root: { id: rendered.id, name: rendered.name, warnings: rendered.warnings },
      target: automationTarget,
      captureNode,
      outputPath,
      bytes: Buffer.byteLength(base64, 'base64'),
      analysis
    },
    null,
    2
  )
)

await client.close()
