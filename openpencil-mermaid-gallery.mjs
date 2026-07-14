import { mkdir, readFile, writeFile } from 'node:fs/promises'

const artifactDir = '/Users/omar/Documents/Open Pencil/artifacts/mermaid-gallery'
const pageName = 'Diagram Studio'
const useCurrentPage = process.argv.includes('--current-page')
const roots = [
  { name: 'Mermaid Studio / 01 Type Catalog', x: 0, y: 0 },
  { name: 'Mermaid Studio / 02 Flow Examples', x: 1950, y: 0 },
  { name: 'Mermaid Studio / 03 Models', x: 0, y: 1250 },
  { name: 'Mermaid Studio / 04 Planning + Analysis', x: 1950, y: 1250 }
]

const health = await fetch('http://127.0.0.1:7600/health').then((response) => {
  if (!response.ok) throw new Error(`OpenPencil MCP health failed: HTTP ${response.status}`)
  return response.json()
})
if (health.status !== 'ok' || !health.token) {
  throw new Error('OpenPencil MCP is running without an attached document token')
}

let target = {}

async function call(name, args = {}) {
  const request =
    name === 'list_documents'
      ? { command: 'list_documents', args: {} }
      : { command: 'tool', args: { ...target, name, args } }
  const response = await fetch('http://127.0.0.1:7600/rpc', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${health.token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(request)
  })
  const payload = await response.json().catch(() => ({ error: `HTTP ${response.status}` }))
  if (!response.ok || payload.ok === false) {
    throw new Error(`${name}: ${payload.error ?? `HTTP ${response.status}`}`)
  }
  return payload.result ?? payload
}

const C = {
  canvas: '#E9E9E5',
  paper: '#FFFFFF',
  paper2: '#F7F7F4',
  line: '#D7D8D3',
  ink: '#1B1D21',
  text: '#4D535D',
  muted: '#7A818C',
  blue: '#2F6FED',
  blueSoft: '#E9F0FF',
  green: '#147A50',
  greenSoft: '#E6F5EE',
  amber: '#C27C16',
  amberSoft: '#FFF4D6',
  violet: '#7056C8'
}

function header(eyebrow, title, meta) {
  return `<Frame w="fill" h={92} flex="row" gap={24} items="center">
    <Frame w="fill" h="fill" flex="col" gap={8} justify="center">
      <Text w="fill" h={13} textAutoResize="none" size={9} weight="bold" letterSpacing={1.2} color="${C.blue}">${eyebrow}</Text>
      <Text w="fill" h={42} textAutoResize="none" size={32} weight="bold" letterSpacing={-0.6} color="${C.ink}">${title}</Text>
    </Frame>
    <Frame w={260} h={36} flex="row" gap={8} items="center" justify="end">
      <Frame w={7} h={7} bg="${C.green}" rounded={4}/>
      <Text w={210} h={14} textAutoResize="none" textAlign="right" size={10} weight="bold" color="${C.text}">${meta}</Text>
    </Frame>
  </Frame>`
}

function catalogColumn(title, items, color) {
  return `<Frame w="fill" h="fill" flex="col" gap={16} p={24}>
    <Frame w="fill" h={28} flex="row" items="center">
      <Text w="fill" h={20} textAutoResize="none" size={15} weight="bold" color="${C.ink}">${title}</Text>
      <Text w={28} h={18} textAutoResize="none" textAlign="right" size={11} weight="bold" color="${C.muted}">${items.length}</Text>
    </Frame>
    <Frame w="fill" h={2} bg="${color}"/>
    ${items
      .map(
        (item) => `<Frame w="fill" h={34} flex="row" gap={8} items="center">
      <Frame w={6} h={6} bg="${color}" rounded={3}/>
      <Text w="fill" h={18} textAutoResize="none" size={12} color="${C.ink}">${item}</Text>
    </Frame>`
      )
      .join('\n')}
  </Frame>`
}

function diagramLabel(type, mode = 'RENDERED') {
  return `<Frame w="fill" h={28} flex="row" items="center">
    <Text w="fill" h={16} textAutoResize="none" size={11} weight="bold" letterSpacing={0.8} color="${C.ink}">${type}</Text>
    <Text w={90} h={14} textAutoResize="none" textAlign="right" size={9} weight="bold" color="${C.blue}">${mode}</Text>
  </Frame>`
}

const catalogBoard = `<Frame name="${roots[0].name}" w={1800} h={1100} flex="col" gap={24} p={48} bg="${C.canvas}">
  ${header('SOURCE-BACKED DIAGRAMS', 'Mermaid on OpenPencil', 'MERMAID 11.16.0')}
  <Frame name="All Mermaid families" w="fill" h={820} flex="row" bg="${C.paper}" rounded={12} stroke="${C.line}" overflow="hidden">
    ${catalogColumn('Flows', ['Flowchart', 'Swimlanes', 'Sequence', 'State', 'User journey', 'Event modeling', 'ZenUML'], C.blue)}
    <Frame w={1} h="fill" bg="${C.line}"/>
    ${catalogColumn('Systems', ['Class', 'Entity relationship', 'Requirement', 'C4', 'Block', 'Packet', 'Architecture', 'TreeView'], C.green)}
    <Frame w={1} h="fill" bg="${C.line}"/>
    ${catalogColumn('Planning', ['Gantt', 'Timeline', 'Kanban', 'Git graph'], C.amber)}
    <Frame w={1} h="fill" bg="${C.line}"/>
    ${catalogColumn('Data', ['Pie', 'Quadrant', 'Sankey', 'XY chart', 'Radar', 'Treemap'], C.violet)}
    <Frame w={1} h="fill" bg="${C.line}"/>
    ${catalogColumn('Thinking', ['Mindmap', 'Venn', 'Ishikawa', 'Wardley', 'Cynefin'], '#A862C7')}
  </Frame>
  <Frame w="fill" h={48} flex="row" gap={32} items="center">
    <Frame w={7} h={7} bg="${C.green}" rounded={4}/><Text w={190} h={15} textAutoResize="none" size={10} color="${C.text}">Source kept as .mmd</Text>
    <Frame w={7} h={7} bg="${C.blue}" rounded={4}/><Text w={250} h={15} textAutoResize="none" size={10} color="${C.text}">All 30 render through official CLI</Text>
    <Frame w={7} h={7} bg="${C.amber}" rounded={4}/><Text w="fill" h={15} textAutoResize="none" size={10} color="${C.text}">Native conversion stays a separate, explicit editability step</Text>
  </Frame>
</Frame>`

const flowBoard = `<Frame name="${roots[1].name}" w={1800} h={1100} flex="col" gap={24} p={48} bg="${C.canvas}">
  ${header('BEHAVIOR OVER TIME', 'Flows', '3 VALIDATED EXAMPLES')}
  <Frame name="Flow examples" w="fill" h="fill" flex="row" bg="${C.paper}" rounded={12} stroke="${C.line}" overflow="hidden">
    <Frame w={430} h="fill" flex="col" gap={16} p={24}>
      ${diagramLabel('FLOWCHART')}
      <Rectangle name="Mermaid / Flowchart" w="fill" h="fill" bg="${C.paper}"/>
    </Frame>
    <Frame w={1} h="fill" bg="${C.line}"/>
    <Frame w="fill" h="fill" flex="col" gap={16} p={24}>
      ${diagramLabel('SEQUENCE')}
      <Rectangle name="Mermaid / Sequence" w="fill" h="fill" bg="${C.paper}"/>
    </Frame>
    <Frame w={1} h="fill" bg="${C.line}"/>
    <Frame w={430} h="fill" flex="col" gap={16} p={24}>
      ${diagramLabel('STATE')}
      <Rectangle name="Mermaid / State" w="fill" h="fill" bg="${C.paper}"/>
    </Frame>
  </Frame>
</Frame>`

const modelsBoard = `<Frame name="${roots[2].name}" w={1800} h={1100} flex="col" gap={24} p={48} bg="${C.canvas}">
  ${header('STRUCTURE + CONCEPTS', 'Models', '2 VALIDATED EXAMPLES')}
  <Frame name="Model examples" w="fill" h="fill" flex="row" bg="${C.paper}" rounded={12} stroke="${C.line}" overflow="hidden">
    <Frame w={760} h="fill" flex="col" gap={16} p={24}>
      ${diagramLabel('ENTITY RELATIONSHIP')}
      <Rectangle name="Mermaid / ER" w="fill" h="fill" bg="${C.paper}"/>
    </Frame>
    <Frame w={1} h="fill" bg="${C.line}"/>
    <Frame w="fill" h="fill" flex="col" gap={16} p={24}>
      ${diagramLabel('MINDMAP')}
      <Rectangle name="Mermaid / Mindmap" w="fill" h="fill" bg="${C.paper}"/>
    </Frame>
  </Frame>
</Frame>`

const planningBoard = `<Frame name="${roots[3].name}" w={1800} h={1100} flex="col" gap={24} p={48} bg="${C.canvas}">
  ${header('TIME + COMPARISON', 'Planning and analysis', '3 VALIDATED EXAMPLES')}
  <Frame name="Planning examples" w="fill" h="fill" flex="col" bg="${C.paper}" rounded={12} stroke="${C.line}" overflow="hidden">
    <Frame w="fill" h={330} flex="col" gap={16} p={24}>
      ${diagramLabel('GANTT')}
      <Rectangle name="Mermaid / Gantt" w="fill" h="fill" bg="${C.paper}"/>
    </Frame>
    <Frame w="fill" h={1} bg="${C.line}"/>
    <Frame w="fill" h="fill" flex="row">
      <Frame w="fill" h="fill" flex="col" gap={16} p={24}>
        ${diagramLabel('RADAR')}
        <Rectangle name="Mermaid / Radar" w="fill" h="fill" bg="${C.paper}"/>
      </Frame>
      <Frame w={1} h="fill" bg="${C.line}"/>
      <Frame w="fill" h="fill" flex="col" gap={16} p={24}>
        ${diagramLabel('TREEMAP')}
        <Rectangle name="Mermaid / Treemap" w="fill" h="fill" bg="${C.paper}"/>
      </Frame>
    </Frame>
  </Frame>
</Frame>`

const boards = [catalogBoard, flowBoard, modelsBoard, planningBoard]
const imageMap = {
  'Mermaid / Flowchart': 'edit-flow-board.png',
  'Mermaid / Sequence': 'agent-sequence-board.png',
  'Mermaid / State': 'edit-state-board.png',
  'Mermaid / ER': 'workspace-er-board.png',
  'Mermaid / Mindmap': 'type-mindmap-board.png',
  'Mermaid / Gantt': 'rollout-gantt-board.png',
  'Mermaid / Radar': 'design-radar-board.png',
  'Mermaid / Treemap': 'type-treemap-board.png'
}

function findTreeNode(node, name) {
  if (!node) return undefined
  if (node.name === name) return node
  for (const child of node.children ?? []) {
    const found = findTreeNode(child, name)
    if (found) return found
  }
  return undefined
}

await mkdir(artifactDir, { recursive: true })

const documents = await call('list_documents')
const activeDocument =
  documents.documents.find((candidate) => candidate.active) ??
  (documents.documents.length === 1 ? documents.documents[0] : undefined)
if (!activeDocument) throw new Error('No unambiguous active OpenPencil document')
target = {
  document_id: activeDocument.id,
  page_id: activeDocument.current_page_id
}

const pages = await call('list_pages')
const page = useCurrentPage
  ? pages.pages.find((candidate) => candidate.id === activeDocument.current_page_id)
  : (pages.pages.find((candidate) => candidate.name === pageName) ??
    (await call('create_page', { name: pageName })))
if (!page) throw new Error('The active OpenPencil page could not be resolved')
if (!useCurrentPage) await call('switch_page', { page: page.id })
target.page_id = page.id

for (const root of roots) {
  const existing = await call('find_nodes', { name: root.name, type: 'FRAME' })
  for (const node of existing.nodes.filter((candidate) => candidate.name === root.name)) {
    await call('set_visible', { id: node.id, value: false })
  }
}

const renderedRoots = []
for (let index = 0; index < boards.length; index += 1) {
  const root = roots[index]
  const rendered = await call('render', {
    parent_id: page.id,
    x: root.x,
    y: root.y,
    jsx: boards[index]
  })
  renderedRoots.push(rendered)
}

for (const rendered of renderedRoots) {
  const tree = await call('get_page_tree', { root_id: rendered.id, depth: 10 })
  for (const [name, filename] of Object.entries(imageMap)) {
    const node = findTreeNode(tree.tree, name)
    if (!node) continue
    const bytes = await readFile(`${artifactDir}/${filename}`)
    await call('set_image_fill', {
      id: node.id,
      image_data: bytes.toString('base64'),
      scale_mode: 'FIT'
    })
  }
}

await new Promise((resolveWait) => setTimeout(resolveWait, 2500))

const exports = []
for (let index = 0; index < renderedRoots.length; index += 1) {
  const exported = await call('export_image', {
    ids: [renderedRoots[index].id],
    format: 'PNG',
    scale: 1
  })
  if (!exported.base64) throw new Error(`No PNG returned for ${roots[index].name}`)
  const outputPath = `${artifactDir}/board-0${index + 1}.png`
  await writeFile(outputPath, Buffer.from(exported.base64, 'base64'))
  exports.push(outputPath)
}

await call('select_nodes', { ids: [renderedRoots[1].id] })
await call('viewport_zoom_to_fit', { ids: [renderedRoots[1].id] })

const analysis = {}
for (const name of ['analyze_overlaps', 'analyze_typography', 'analyze_spacing']) {
  analysis[name] = await call(name).catch((error) => ({ error: error.message }))
}

process.stdout.write(
  `${JSON.stringify(
    {
      page: { id: page.id, name: page.name },
      roots: renderedRoots.map((root, index) => ({ id: root.id, name: roots[index].name, warnings: root.warnings })),
      exports,
      analysis
    },
    null,
    2
  )}\n`
)
