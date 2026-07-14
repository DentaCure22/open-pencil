import { mkdir, readFile, writeFile } from 'node:fs/promises'

const artifactDir = '/Users/omar/Documents/Open Pencil/artifacts/design-director'
const capturePath = `${artifactDir}/real-dental-chart.png`
const outputPath = `${artifactDir}/critique-workspace-v4-clean.png`
const rootName = 'Critique Workspace / Dental Chart Edit'
const pageName = 'Page 1'

const health = await fetch('http://127.0.0.1:7600/health').then((response) => {
  if (!response.ok) throw new Error(`OpenPencil MCP health failed: HTTP ${response.status}`)
  return response.json()
})
if (health.status !== 'ok' || !health.token) {
  throw new Error('OpenPencil MCP is running without an attached document token')
}

let automationTarget = {}

async function call(name, args = {}) {
  const request =
    name === 'list_documents'
      ? { command: 'list_documents', args: {} }
      : { command: 'tool', args: { ...automationTarget, name, args } }
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
  lineStrong: '#C5C8C2',
  ink: '#1B1D21',
  text: '#4D535D',
  muted: '#7A818C',
  blue: '#2F6FED',
  blueSoft: '#E9F0FF',
  blueLine: '#9DBBFA',
  amber: '#C27C16',
  amberSoft: '#FFF4D6',
  green: '#147A50',
  greenSoft: '#E6F5EE',
  lavender: '#7056C8',
  lavenderSoft: '#F0ECFF'
}

const selectedPin = (top, left) => `<Frame name="Comment pin C" position="absolute" top={${top}} left={${left}} w={184} h={36} flex="row" gap={8} items="center" p={4} bg="${C.blue}" rounded={18} shadow="0 5 14 #22252A25" overflow="hidden">
  <Frame w={28} h={28} bg="#FFFFFF" rounded={14} overflow="hidden"><Text w={28} h={28} textAutoResize="none" textAlign="center" textAlignVertical="center" size={11} weight="bold" color="${C.blue}">C</Text></Frame>
  <Text w="fill" h={16} textAutoResize="none" size={11} weight="bold" color="#FFFFFF">Next action</Text>
</Frame>`

const proposedEdit = (top, left, width, height, compact = false) => `<Frame name="Proposed Treatment Panel Edit${compact ? ' / Crop' : ''}" position="absolute" top={${top}} left={${left}} w={${width}} h={${height}} flex="col" gap={8} p={16} bg="#F8FBFF" rounded={10} stroke="${C.blueLine}" strokeWidth={2} overflow="hidden">
  <Text w="fill" h={12} textAutoResize="none" size={9} weight="bold" letterSpacing={1} color="${C.blue}">EDIT · CANVAS ONLY</Text>
  <Text w="fill" h={${compact ? 21 : 24}} textAutoResize="none" size={${compact ? 15 : 18}} weight="bold" color="${C.ink}">Ready to plan?</Text>
  <Text w="fill" h={17} textAutoResize="none" size={${compact ? 10 : 11}} color="${C.text}">Use selected chart findings.</Text>
  <Frame w="fill" h="fill" flex="row" items="center" justify="center" bg="${C.blue}" rounded={7}><Text w="fill" h={14} textAutoResize="none" textAlign="center" textAlignVertical="center" size={10} weight="bold" color="#FFFFFF">Start treatment plan</Text></Frame>
</Frame>`

const board = `<Frame name="${rootName}" w={1900} h={1250} flex="col" gap={24} p={48} bg="${C.canvas}">
  <Frame name="Critique contract" w="fill" h={80} flex="row" gap={32} items="center">
    <Frame w={520} h="fill" flex="col" gap={8} justify="center">
      <Frame w="fill" h={16} flex="row" gap={8} items="center"><Frame w={8} h={8} bg="${C.green}" rounded={4}/><Text w="fill" h={13} textAutoResize="none" size={10} weight="bold" letterSpacing={1.1} color="${C.green}">EDIT BRANCH · SOURCE UNCHANGED</Text></Frame>
      <Text w="fill" h={38} textAutoResize="none" size={30} weight="bold" letterSpacing={-0.6} color="${C.ink}">Treatment plan handoff</Text>
    </Frame>
    <Frame w="fill" h="fill" flex="col" gap={8} justify="center">
      <Text w="fill" h={13} textAutoResize="none" size={9} weight="bold" letterSpacing={1.1} color="${C.blue}">FEEDBACK WANTED</Text>
      <Text w="fill" h={30} textAutoResize="none" size={22} weight="bold" color="${C.ink}">Is the next action obvious?</Text>
    </Frame>
    <Frame w={1} h={48} bg="${C.lineStrong}"/>
    <Frame w={300} h="fill" flex="col" gap={8} justify="center">
      <Text w="fill" h={13} textAutoResize="none" size={9} weight="bold" letterSpacing={1.1} color="${C.muted}">SCOPE</Text>
      <Text w="fill" h={24} textAutoResize="none" size={16} weight="bold" color="${C.ink}">Copy + CTA only</Text>
    </Frame>
  </Frame>

  <Frame name="Critique working area" w="fill" h={765} flex="row" gap={24}>
    <Frame name="Live product artifact" w={1360} h="fill" bg="#F3F6FC" rounded={12} stroke="${C.lineStrong}" overflow="hidden">
      <Rectangle name="Production Capture / Main" position="absolute" top={0} left={0} w={1360} h={765} bg="#F3F6FC"/>
      <Frame name="Edit region focus" position="absolute" top={456} left={972} w={360} h={292} rounded={11} stroke="${C.blue}" strokeWidth={3}/>
      ${proposedEdit(536, 998, 308, 164, false)}
      ${selectedPin(472, 1120)}
    </Frame>

    <Frame name="Selected comment side peek" w="fill" h="fill" flex="col" gap={0} bg="${C.paper}" stroke="${C.lineStrong}" rounded={12} overflow="hidden">
      <Frame w="fill" h={72} flex="row" gap={12} items="center" p={20}>
        <Frame w={32} h={32} bg="${C.blue}" rounded={16} overflow="hidden"><Text w={32} h={32} textAutoResize="none" textAlign="center" textAlignVertical="center" size={11} weight="bold" color="#FFFFFF">C</Text></Frame>
        <Frame w="fill" h={36} flex="col" gap={4}><Text w="fill" h={16} textAutoResize="none" size={12} weight="bold" color="${C.ink}">Treatment Plan</Text><Text w="fill" h={14} textAutoResize="none" size={10} color="${C.muted}">Selected comment</Text></Frame>
      </Frame>
      <Frame w="fill" h={1} bg="${C.line}"/>
      <Frame w="fill" h="fill" flex="col" gap={24} p={24}>
        <Frame w="fill" h={72} flex="col" gap={8}>
          <Text w="fill" h={13} textAutoResize="none" size={9} weight="bold" letterSpacing={1} color="${C.muted}">CURRENT</Text>
          <Text w="fill" h={42} textAutoResize="height" maxLines={2} size={14} lineHeight={20} color="${C.ink}">The empty state does not connect chart findings to a plan.</Text>
        </Frame>
        <Frame w="fill" h={1} bg="${C.line}"/>
        <Frame w="fill" h={56} flex="col" gap={8}>
          <Text w="fill" h={13} textAutoResize="none" size={9} weight="bold" letterSpacing={1} color="${C.blue}">TRY</Text>
          <Text w="fill" h={24} textAutoResize="none" size={16} weight="bold" color="${C.ink}">One contextual action</Text>
        </Frame>
        <Frame w="fill" h={56} flex="col" gap={8}>
          <Text w="fill" h={13} textAutoResize="none" size={9} weight="bold" letterSpacing={1} color="${C.muted}">QUESTION</Text>
          <Text w="fill" h={24} textAutoResize="none" size={14} color="${C.ink}">Is this enough guidance?</Text>
        </Frame>
        <Frame w="fill" h="fill"/>
        <Frame w="fill" h={44} flex="row" items="center" p={12} rounded={8} stroke="${C.lineStrong}"><Text w="fill" h={16} textAutoResize="none" size={11} color="${C.muted}">Add a reply…</Text></Frame>
        <Frame w="fill" h={44} flex="row" gap={8}>
          <Frame w="fill" h="fill" flex="row" items="center" justify="center" rounded={8} stroke="${C.lineStrong}"><Text w="fill" h={14} textAutoResize="none" textAlign="center" textAlignVertical="center" size={10} weight="bold" color="${C.ink}">Revise</Text></Frame>
          <Frame w="fill" h="fill" flex="row" items="center" justify="center" bg="${C.blue}" rounded={8}><Text w="fill" h={14} textAutoResize="none" textAlign="center" textAlignVertical="center" size={10} weight="bold" color="#FFFFFF">Keep</Text></Frame>
        </Frame>
      </Frame>
    </Frame>
  </Frame>

  <Frame name="Changed region compare" w="fill" h={261} flex="row" gap={24}>
    <Frame name="Current crop column" w="fill" h="fill" flex="col" gap={8}>
      <Frame w="fill" h={16} flex="row" items="center"><Text w="fill" h={13} textAutoResize="none" size={10} weight="bold" color="${C.muted}">CURRENT</Text><Text w={140} h={13} textAutoResize="none" textAlign="right" size={9} color="${C.muted}">PRODUCTION CAPTURE</Text></Frame>
      <Frame name="Current Treatment Plan Crop" w="fill" h="fill" bg="#F3F6FC" rounded={10} stroke="${C.lineStrong}" overflow="hidden"><Rectangle name="Production Capture / Current Crop" position="absolute" top={-970} left={-1619} w={2445} h={1375} bg="#F3F6FC"/></Frame>
    </Frame>
    <Frame name="Proposed crop column" w="fill" h="fill" flex="col" gap={8}>
      <Frame w="fill" h={16} flex="row" items="center"><Text w="fill" h={13} textAutoResize="none" size={10} weight="bold" color="${C.blue}">PROPOSED</Text><Text w={100} h={13} textAutoResize="none" textAlign="right" size={9} weight="bold" color="${C.blue}">CANVAS ONLY</Text></Frame>
      <Frame name="Proposed Treatment Plan Crop" w="fill" h="fill" bg="#F3F6FC" rounded={10} stroke="${C.blueLine}" strokeWidth={2} overflow="hidden"><Rectangle name="Production Capture / Proposed Crop" position="absolute" top={-970} left={-1619} w={2445} h={1375} bg="#F3F6FC"/>${proposedEdit(24, 141, 608, 188, true)}</Frame>
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
automationTarget.page_id = page.id

for (const oldName of [
  'Design Director / 01 Flow Overview',
  'Design Director / 02 Active Charting Focus',
  'Design Director / 03 Versions Review',
  'Design Director / 04 Knowledge Detail',
  'Design Review / Real Dental Chart'
]) {
  const old = await call('find_nodes', { name: oldName, type: 'FRAME' })
  for (const node of old.nodes.filter((candidate) => candidate.name === oldName)) {
    await call('set_visible', { id: node.id, value: false })
  }
}

const existing = await call('find_nodes', { name: rootName, type: 'FRAME' })
const exact = existing.nodes.filter((candidate) => candidate.name === rootName)
for (const previous of exact) await call('set_visible', { id: previous.id, value: false })
const rendered = await call('render', {
  parent_id: page.id,
  x: 0,
  y: 0,
  jsx: board
})
await call('set_visible', { id: rendered.id, value: true })

const renderedTree = await call('get_page_tree', { root_id: rendered.id, depth: 10 })
function findTreeNode(node, name) {
  if (!node) return undefined
  if (node.name === name) return node
  for (const child of node.children ?? []) {
    const match = findTreeNode(child, name)
    if (match) return match
  }
  return undefined
}

for (const name of [
  'Production Capture / Main',
  'Production Capture / Current Crop',
  'Production Capture / Proposed Crop'
]) {
  const node = findTreeNode(renderedTree.tree, name)
  if (!node) throw new Error(`${name} placeholder was not found after render`)
  await call('set_image_fill', {
    id: node.id,
    image_data: capture.toString('base64'),
    scale_mode: 'FIT'
  })
}

await call('switch_page', { page: page.id })
await call('select_nodes', { ids: [rendered.id] })
await call('viewport_zoom_to_fit', { ids: [rendered.id] })

// Repeated capture fills resolve asynchronously in CanvasKit. Exporting immediately can
// capture transient black tiles even though the live scene graph is correct.
await new Promise((resolve) => setTimeout(resolve, 1200))

const exported = await call('export_image', { ids: [rendered.id], format: 'PNG', scale: 1 })
const base64 = exported.base64
if (!base64) {
  throw new Error(`Export returned no PNG payload: ${JSON.stringify(exported)}`)
}
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
      outputPath,
      bytes: Buffer.byteLength(base64, 'base64'),
      analysis
    },
    null,
    2
  )
)
