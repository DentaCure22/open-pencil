import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'

const client = new Client({ name: 'codex-polished-canvas', version: '1.0.0' })
const transport = new StreamableHTTPClientTransport(new URL('http://127.0.0.1:7600/mcp'), {
  requestInit: { headers: { Authorization: 'Bearer codex-canvas-demo' } }
})

await client.connect(transport)

async function call(name, args = {}) {
  const result = await client.callTool({ name, arguments: args })
  if (result.isError) throw new Error(result.content?.[0]?.text ?? `${name} failed`)
  const text = result.content?.find((item) => item.type === 'text')?.text
  return text ? JSON.parse(text) : result
}

const pill = (label, bg, fg) =>
  `<Frame w="hug" h="hug" p={7} bg="${bg}" rounded={14}><Text size={11} weight="bold" color="${fg}">${label}</Text></Frame>`

const navRail = (active = 1) => `<Frame name="Clinical navigation" w={42} h="fill" flex="col" gap={10} p={8} bg="#111C38" rounded={12}>
  ${[0, 1, 2, 3, 4]
    .map(
      (index) =>
        `<Frame w={26} h={26} bg="${index === active ? '#5B6EF5' : '#263452'}" rounded={8}><Text size={10} weight="bold" color="#FFFFFF">${['H', 'C', 'P', 'T', 'R'][index]}</Text></Frame>`
    )
    .join('')}
</Frame>`

const toothRow = (active = 5, complete = []) => `<Frame name="Odontogram" w="fill" h={62} flex="row" gap={5} p={8} bg="#F2F6FC" rounded={12}>
  ${Array.from({ length: 12 }, (_, index) => {
    const number = index + 9
    const bg = index === active ? '#5267F6' : complete.includes(index) ? '#DCF5E6' : '#FFFFFF'
    const fg = index === active ? '#FFFFFF' : complete.includes(index) ? '#218653' : '#42516A'
    return `<Frame w={25} h={43} flex="col" gap={2} p={4} bg="${bg}" rounded={8}><Text size={9} weight="bold" color="${fg}">${number}</Text><Frame w={16} h={15} bg="${index === active ? '#8FA0FF' : '#DCE5F2'}" rounded={5}/></Frame>`
  }).join('')}
</Frame>`

const patientTopbar = () => `<Frame name="Patient context" w="fill" h={48} flex="row" gap={12} p={10} bg="#FFFFFF" rounded={12}>
  <Frame w={28} h={28} bg="#DDE6FF" rounded={14}><Text size={10} weight="bold" color="#4056C7">MR</Text></Frame>
  <Frame w={160} h="hug" flex="col" gap={2}><Text size={12} weight="bold" color="#1A2540">Maya Rodriguez</Text><Text size={9} color="#6C7890">34 · ID 10482 · Recall due</Text></Frame>
  <Frame w="fill" h={28} flex="row" gap={7}>
    ${pill('Allergies: none', '#EDF8F2', '#267C50')}
    ${pill('Last visit 6 mo', '#EEF3FF', '#405FC9')}
  </Frame>
</Frame>`

const currentContent = `<Frame w="fill" h="fill" flex="col" gap={10}>
  <Frame w="fill" h={54} flex="row" gap={8}>
    <Frame w={106} h="fill" flex="col" gap={3} p={9} bg="#FFFFFF" rounded={10}><Text size={9} color="#758199">Dentition</Text><Text size={12} weight="bold" color="#1A2540">Permanent</Text></Frame>
    <Frame w={106} h="fill" flex="col" gap={3} p={9} bg="#FFFFFF" rounded={10}><Text size={9} color="#758199">Open items</Text><Text size={12} weight="bold" color="#D28712">3 planned</Text></Frame>
    <Frame w="fill" h="fill" flex="col" gap={3} p={9} bg="#FFFFFF" rounded={10}><Text size={9} color="#758199">Chart status</Text><Text size={12} weight="bold" color="#2A8655">Ready</Text></Frame>
  </Frame>
  ${toothRow(5, [1, 8])}
  <Frame w="fill" h="fill" flex="row" gap={10}>
    <Frame w={154} h="fill" flex="col" gap={8} p={10} bg="#FFFFFF" rounded={12}><Text size={11} weight="bold" color="#1A2540">Recent findings</Text><Text size={9} color="#67758D">#3 · Existing crown</Text><Text size={9} color="#67758D">#14 · Occlusal caries</Text><Text size={9} color="#67758D">#19 · Watch surface</Text></Frame>
    <Frame w="fill" h="fill" flex="col" gap={8} p={10} bg="#FFFFFF" rounded={12}><Text size={11} weight="bold" color="#1A2540">Today</Text>${pill('Start charting', '#E8EDFF', '#4058D6')}<Text size={9} color="#67758D">Select a tooth to add findings or treatment.</Text></Frame>
  </Frame>
</Frame>`

const setupContent = `<Frame w="fill" h="fill" flex="col" gap={10}>
  <Frame w="fill" h={45} flex="row" gap={8}>${pill('Exam setup', '#E8EDFF', '#4058D6')}${pill('Adult', '#F0F3F8', '#56647A')}${pill('Existing chart', '#F0F3F8', '#56647A')}</Frame>
  <Frame w="fill" h="fill" flex="row" gap={10}>
    <Frame w={185} h="fill" flex="col" gap={9} p={12} bg="#FFFFFF" rounded={12}><Text size={12} weight="bold" color="#1A2540">Charting protocol</Text><Text size={9} color="#6C7890">Choose the sequence for this exam.</Text>
      <Frame w="fill" h={46} flex="col" gap={3} p={9} bg="#E8EDFF" rounded={10}><Text size={10} weight="bold" color="#4058D6">Comprehensive</Text><Text size={8} color="#6474A6">Hard tissue + conditions</Text></Frame>
      <Frame w="fill" h={42} flex="col" gap={3} p={9} bg="#F4F6FA" rounded={10}><Text size={10} weight="bold" color="#36435A">Limited exam</Text><Text size={8} color="#7B879A">Focused complaint</Text></Frame>
      <Frame w="fill" h={42} flex="col" gap={3} p={9} bg="#F4F6FA" rounded={10}><Text size={10} weight="bold" color="#36435A">Perio update</Text><Text size={8} color="#7B879A">Measurements only</Text></Frame>
    </Frame>
    <Frame w="fill" h="fill" flex="col" gap={10} p={12} bg="#FFFFFF" rounded={12}><Text size={12} weight="bold" color="#1A2540">Include in session</Text>
      <Frame w="fill" h={34} flex="row" gap={8} p={8} bg="#F6F8FC" rounded={9}><Frame w={17} h={17} bg="#5267F6" rounded={5}/><Text size={9} color="#36435A">Existing restorations</Text></Frame>
      <Frame w="fill" h={34} flex="row" gap={8} p={8} bg="#F6F8FC" rounded={9}><Frame w={17} h={17} bg="#5267F6" rounded={5}/><Text size={9} color="#36435A">Planned treatment</Text></Frame>
      <Frame w="fill" h={34} flex="row" gap={8} p={8} bg="#F6F8FC" rounded={9}><Frame w={17} h={17} bg="#FFFFFF" rounded={5}/><Text size={9} color="#36435A">Perio findings</Text></Frame>
      <Frame w="fill" h="fill" flex="col" gap={5} p={9} bg="#EEF8F3" rounded={10}><Text size={9} weight="bold" color="#237C4D">Ready to begin</Text><Text size={8} color="#4E7461">12 teeth have prior chart history.</Text></Frame>
    </Frame>
  </Frame>
</Frame>`

const activeContent = `<Frame w="fill" h="fill" flex="col" gap={10}>
  ${toothRow(5, [1, 8])}
  <Frame w="fill" h="fill" flex="row" gap={10}>
    <Frame w={150} h="fill" flex="col" gap={8} p={10} bg="#FFFFFF" rounded={12}><Text size={11} weight="bold" color="#1A2540">Tooth #14</Text><Text size={9} color="#6C7890">Select surfaces</Text>
      <Frame w="fill" h={92} flex="col" gap={5} p={8} bg="#F4F6FC" rounded={10}>
        <Frame w="fill" h={25} flex="row" gap={5}><Frame w={28} h={25} bg="#DDE4FF" rounded={6}><Text size={8} weight="bold" color="#4058D6">M</Text></Frame><Frame w={28} h={25} bg="#5267F6" rounded={6}><Text size={8} weight="bold" color="#FFFFFF">O</Text></Frame><Frame w={28} h={25} bg="#DDE4FF" rounded={6}><Text size={8} weight="bold" color="#4058D6">D</Text></Frame></Frame>
        <Frame w="fill" h={25} flex="row" gap={5}><Frame w={28} h={25} bg="#F0F3F8" rounded={6}><Text size={8} color="#55637A">B</Text></Frame><Frame w={28} h={25} bg="#F0F3F8" rounded={6}><Text size={8} color="#55637A">L</Text></Frame></Frame>
      </Frame>
      <Text size={9} color="#6C7890">Condition</Text>${pill('Primary caries', '#FFF4DB', '#A66508')}
    </Frame>
    <Frame w="fill" h="fill" flex="col" gap={8} p={10} bg="#FFFFFF" rounded={12}><Text size={11} weight="bold" color="#1A2540">Add treatment</Text>
      <Frame w="fill" h={38} flex="row" gap={7} p={8} bg="#E8EDFF" rounded={9}><Text size={9} weight="bold" color="#4058D6">Composite restoration</Text></Frame>
      <Frame w="fill" h={38} flex="row" gap={7} p={8} bg="#F5F7FB" rounded={9}><Text size={9} color="#4D5B72">Crown · ceramic</Text></Frame>
      <Frame w="fill" h={38} flex="row" gap={7} p={8} bg="#F5F7FB" rounded={9}><Text size={9} color="#4D5B72">Monitor surface</Text></Frame>
      <Frame w="fill" h="fill" flex="col" gap={5} p={9} bg="#EEF8F3" rounded={10}><Text size={9} weight="bold" color="#237C4D">Queued for review</Text><Text size={8} color="#4E7461">#14 · O · Composite</Text></Frame>
    </Frame>
  </Frame>
</Frame>`

const reviewContent = `<Frame w="fill" h="fill" flex="col" gap={9}>
  <Frame w="fill" h={42} flex="row" gap={8}>${pill('3 findings', '#FFF4DB', '#A66508')}${pill('2 planned', '#E8EDFF', '#4058D6')}${pill('1 watch', '#F0F3F8', '#59677C')}</Frame>
  <Frame w="fill" h="fill" flex="col" gap={7} p={10} bg="#FFFFFF" rounded={12}>
    <Frame w="fill" h={48} flex="row" gap={8} p={8} bg="#F7F9FC" rounded={9}><Frame w={32} h={32} bg="#E8EDFF" rounded={8}><Text size={10} weight="bold" color="#4058D6">14</Text></Frame><Frame w={165} h="hug" flex="col" gap={3}><Text size={9} weight="bold" color="#26334A">Composite restoration</Text><Text size={8} color="#718096">Occlusal · Planned</Text></Frame>${pill('$285', '#EEF8F3', '#237C4D')}</Frame>
    <Frame w="fill" h={48} flex="row" gap={8} p={8} bg="#F7F9FC" rounded={9}><Frame w={32} h={32} bg="#E8EDFF" rounded={8}><Text size={10} weight="bold" color="#4058D6">19</Text></Frame><Frame w={165} h="hug" flex="col" gap={3}><Text size={9} weight="bold" color="#26334A">Crown evaluation</Text><Text size={8} color="#718096">Buccal · Planned</Text></Frame>${pill('$0', '#F0F3F8', '#59677C')}</Frame>
    <Frame w="fill" h={48} flex="row" gap={8} p={8} bg="#F7F9FC" rounded={9}><Frame w={32} h={32} bg="#FFF4DB" rounded={8}><Text size={10} weight="bold" color="#A66508">30</Text></Frame><Frame w={165} h="hug" flex="col" gap={3}><Text size={9} weight="bold" color="#26334A">Watch surface</Text><Text size={8} color="#718096">Distal · Monitor</Text></Frame>${pill('6 mo', '#FFF4DB', '#A66508')}</Frame>
    <Frame w="fill" h="fill" flex="row" gap={8} p={9} bg="#EEF8F3" rounded={10}><Frame w="fill" h="hug" flex="col" gap={3}><Text size={9} color="#4E7461">Estimated treatment</Text><Text size={14} weight="bold" color="#237C4D">$285</Text></Frame>${pill('Approve plan', '#D8F2E4', '#1F7B4B')}</Frame>
  </Frame>
</Frame>`

const stateCard = ({ number, status, statusBg, statusFg, title, subtitle, activeNav, content }) => `<Frame name="${number} ${title}" w={430} h={610} flex="col" gap={12} p={16} bg="#FFFFFF" rounded={20} stroke="#DCE5F2">
  <Frame w="fill" h={54} flex="row" gap={10}>
    ${pill(`${number} · ${status}`, statusBg, statusFg)}
    <Frame w="fill" h="hug" flex="col" gap={3}><Text size={16} weight="bold" color="#16213A">${title}</Text><Text size={10} color="#6C7890">${subtitle}</Text></Frame>
    ${pill('Illustrative', '#F0F3F8', '#667085')}
  </Frame>
  <Frame name="${title} preview" w="fill" h="fill" flex="col" gap={10} p={10} bg="#EAF1FA" rounded={15}>
    ${patientTopbar()}
    <Frame w="fill" h="fill" flex="row" gap={10}>${navRail(activeNav)}<Frame w="fill" h="fill" flex="col" gap={9} p={10} bg="#F7FAFE" rounded={12}>${content}</Frame></Frame>
  </Frame>
</Frame>`

const flowCards = [
  stateCard({ number: '01', status: 'CURRENT', statusBg: '#E8EDFF', statusFg: '#4058D6', title: 'Patient selected', subtitle: '/dental-chart · production anchor', activeNav: 1, content: currentContent }),
  stateCard({ number: '02', status: 'SETUP', statusBg: '#FFF4DB', statusFg: '#A66508', title: 'Exam setup', subtitle: 'Choose charting protocol', activeNav: 1, content: setupContent }),
  stateCard({ number: '03', status: 'ACTIVE', statusBg: '#EDE8FF', statusFg: '#6D4CD2', title: 'Active charting', subtitle: 'Tooth and surface workflow', activeNav: 1, content: activeContent }),
  stateCard({ number: '04', status: 'REVIEW', statusBg: '#E5F6EC', statusFg: '#237C4D', title: 'Review changes', subtitle: 'Confirm findings and plan', activeNav: 1, content: reviewContent })
]

const arrow = (label) => `<Frame w={54} h={610} flex="col" gap={8} p={5}><Text size={10} weight="bold" color="#667085">${label}</Text><Text size={26} weight="bold" color="#5267F6">→</Text></Frame>`

const compactPreview = `<Frame w="fill" h={210} flex="col" gap={8} p={10} bg="#EAF1FA" rounded={13}>
  <Frame w="fill" h={34} flex="row" gap={7} p={7} bg="#FFFFFF" rounded={9}><Text size={9} weight="bold" color="#1A2540">#14 · Occlusal caries</Text>${pill('Dense', '#EDE8FF', '#6D4CD2')}</Frame>
  <Frame w="fill" h="fill" flex="row" gap={8}>
    <Frame w={116} h="fill" flex="col" gap={6} p={8} bg="#FFFFFF" rounded={9}><Text size={9} weight="bold" color="#1A2540">Surfaces</Text><Frame w="fill" h={28} bg="#5267F6" rounded={7}/><Frame w="fill" h={28} bg="#EEF2F8" rounded={7}/><Frame w="fill" h={28} bg="#EEF2F8" rounded={7}/></Frame>
    <Frame w="fill" h="fill" flex="col" gap={6} p={8} bg="#FFFFFF" rounded={9}><Text size={9} weight="bold" color="#1A2540">Quick treatments</Text><Frame w="fill" h={27} bg="#E8EDFF" rounded={7}/><Frame w="fill" h={27} bg="#E8EDFF" rounded={7}/><Frame w="fill" h={27} bg="#F0F3F8" rounded={7}/><Frame w="fill" h={27} bg="#F0F3F8" rounded={7}/></Frame>
  </Frame>
</Frame>`

const comfortPreview = `<Frame w="fill" h={210} flex="col" gap={9} p={12} bg="#EAF1FA" rounded={13}>
  <Frame w="fill" h={40} flex="row" gap={8} p={8} bg="#FFFFFF" rounded={10}><Text size={10} weight="bold" color="#1A2540">Tooth #14</Text>${pill('Guided', '#E8EDFF', '#4058D6')}</Frame>
  <Frame w="fill" h={54} flex="row" gap={8}><Frame w="fill" h="fill" bg="#FFFFFF" rounded={10}><Text size={9} weight="bold" color="#4058D6">1 · Surface</Text></Frame><Frame w="fill" h="fill" bg="#FFFFFF" rounded={10}><Text size={9} weight="bold" color="#6D4CD2">2 · Finding</Text></Frame></Frame>
  <Frame w="fill" h="fill" flex="col" gap={7} p={9} bg="#FFFFFF" rounded={10}><Text size={9} weight="bold" color="#1A2540">Recommended next action</Text><Frame w="fill" h={38} flex="row" gap={7} p={8} bg="#E8EDFF" rounded={8}><Text size={9} weight="bold" color="#4058D6">Composite restoration</Text></Frame></Frame>
</Frame>`

const versionCard = ({ status, title, note, preview, preferred = false }) => `<Frame name="${title}" w={430} h={360} flex="col" gap={10} p={16} bg="#FFFFFF" rounded={18} stroke="#DCE5F2">
  <Frame w="fill" h={46} flex="row" gap={8}>${pill(status, '#EDE8FF', '#6D4CD2')}<Frame w="fill" h="hug" flex="col" gap={3}><Text size={15} weight="bold" color="#16213A">${title}</Text><Text size={9} color="#6C7890">${note}</Text></Frame>${preferred ? pill('PREFERRED', '#E8EDFF', '#4058D6') : ''}</Frame>
  ${preview}
  <Text size={9} color="#6C7890">Illustrative preview · production source unchanged</Text>
</Frame>`

const board = `<Frame name="Dental Chart Workflow — Polished" w={2200} h={1900} flex="col" gap={26} p={56} bg="#F3F8FD" rounded={28}>
  <Frame name="Board header" w="fill" h={104} flex="row" gap={18}>
    <Frame w={1040} h="fill" flex="col" gap={8}><Text size={34} weight="bold" color="#14203A">Dental Chart knowledge canvas</Text><Text size={15} color="#65738B">Documents, structured records, application states, safe edit branches, and explicit production handoff.</Text></Frame>
    <Frame w="fill" h="fill" flex="row" gap={10} p={18} bg="#FFFFFF" rounded={18}>${pill('FLOW → ACROSS', '#E8EDFF', '#4058D6')}${pill('VERSIONS ↓ DOWN', '#EDE8FF', '#6D4CD2')}${pill('PRODUCTION PROTECTED', '#E5F6EC', '#237C4D')}</Frame>
  </Frame>
  <Frame name="How this board works" w="fill" h={150} flex="row" gap={22} p={22} bg="#FFFFFF" rounded={20} stroke="#DCE5F2">
    <Frame w={760} h="fill" flex="col" gap={8}><Text size={19} weight="bold" color="#16213A">Start from the real app</Text><Text size={12} color="#65738B">Move left to right through the patient journey. Branch downward to compare safe edits. Only an approved change set can reach source.</Text><Frame w="fill" h="hug" flex="row" gap={8}>${pill('Blue · current flow', '#E8EDFF', '#4058D6')}${pill('Violet · edit branch', '#EDE8FF', '#6D4CD2')}${pill('Green · approved', '#E5F6EC', '#237C4D')}</Frame></Frame>
    <Frame w="fill" h="fill" flex="row" gap={12} p={12} bg="#F7FAFE" rounded={14}><Frame w={210} h="fill" flex="col" gap={4} p={12} bg="#FFFFFF" rounded={12}><Text size={10} weight="bold" color="#4058D6">START HERE</Text><Text size={14} weight="bold" color="#16213A">Current</Text><Text size={9} color="#6C7890">Production state</Text></Frame><Text size={24} weight="bold" color="#5267F6">→</Text><Frame w={210} h="fill" flex="col" gap={4} p={12} bg="#FFFFFF" rounded={12}><Text size={10} weight="bold" color="#4058D6">NEXT</Text><Text size={14} weight="bold" color="#16213A">Flow state</Text><Text size={9} color="#6C7890">Shared runtime</Text></Frame><Text size={24} weight="bold" color="#6D4CD2">↓</Text><Frame w={210} h="fill" flex="col" gap={4} p={12} bg="#F2EEFF" rounded={12}><Text size={10} weight="bold" color="#6D4CD2">BRANCH</Text><Text size={14} weight="bold" color="#16213A">Edit version</Text><Text size={9} color="#6C7890">Isolated patch</Text></Frame></Frame>
  </Frame>
  <Frame name="Production flow" w="fill" h={610} flex="row" gap={10}>
    ${flowCards[0]}${arrow('Start exam')}${flowCards[1]}${arrow('Begin')}${flowCards[2]}${arrow('Finish')}${flowCards[3]}
  </Frame>
  <Frame name="Edit branches and decision" w="fill" h="fill" flex="row" gap={18}>
    <Frame name="Knowledge workspace" w={976} h="fill" flex="col" gap={12} p={18} bg="#EAF1FA" rounded={18}>
      <Text size={12} weight="bold" color="#52627A">One workspace · shared objects · production flow stays unchanged</Text>
      <Frame w="fill" h={180} flex="row" gap={12}>
        <Frame w="fill" h="fill" flex="col" gap={7} p={14} bg="#FFFFFF" rounded={14}><Text size={12} weight="bold" color="#16213A">Flow notes</Text><Text size={10} color="#65738B">• Current keeps the real patient context</Text><Text size={10} color="#65738B">• Setup owns protocol and included data</Text><Text size={10} color="#65738B">• Active charting owns tooth/surface edits</Text><Text size={10} color="#65738B">• Review owns final confirmation</Text></Frame>
        <Frame w="fill" h="fill" flex="col" gap={7} p={14} bg="#FFFFFF" rounded={14}><Text size={12} weight="bold" color="#16213A">Runtime model</Text><Text size={10} color="#65738B">One shared live runtime moves to the selected state.</Text><Text size={10} color="#65738B">Inactive states remain captures with route and revision metadata.</Text>${pill('ONE ACTIVE RUNTIME', '#E8EDFF', '#4058D6')}${pill('SOURCE UNCHANGED', '#E5F6EC', '#237C4D')}</Frame>
      </Frame>
      <Frame name="Mixed knowledge objects" w="fill" h="fill" flex="col" gap={10} p={14} bg="#FFFFFF" rounded={14}>
        <Frame w="fill" h={42} flex="row" gap={8}><Text size={15} weight="bold" color="#16213A">Knowledge workspace</Text>${pill('DOCUMENT', '#EEF3FF', '#405FC9')}${pill('COLLECTION', '#EDE8FF', '#6D4CD2')}${pill('LIVE APP BLOCK', '#E5F6EC', '#237C4D')}</Frame>
        <Frame w="fill" h="fill" flex="row" gap={10}>
          <Frame name="Document blocks" w={278} h="fill" flex="col" gap={8} p={12} bg="#F7FAFE" rounded={12}><Text size={13} weight="bold" color="#16213A">Charting improvement brief</Text><Text size={9} color="#65738B">Keep expert speed while making the next action obvious.</Text><Frame w="fill" h={56} flex="col" gap={4} p={9} bg="#E8EDFF" rounded={9}><Text size={9} weight="bold" color="#4058D6">Decision</Text><Text size={9} color="#52627A">Comfort-first is preferred.</Text></Frame><Text size={9} color="#52627A">☑ Preserve patient context</Text><Text size={9} color="#52627A">☑ Keep tooth selection visible</Text><Text size={9} color="#52627A">☐ Verify keyboard workflow</Text></Frame>
          <Frame name="Collection view" w={300} h="fill" flex="col" gap={8} p={12} bg="#F7FAFE" rounded={12}><Text size={13} weight="bold" color="#16213A">Findings collection</Text><Text size={9} color="#65738B">One record set · board view</Text><Frame w="fill" h={48} flex="row" gap={7} p={8} bg="#FFFFFF" rounded={9}>${pill('14', '#E8EDFF', '#4058D6')}<Frame w="fill" h="hug" flex="col" gap={2}><Text size={9} weight="bold" color="#26334A">Composite restoration</Text><Text size={8} color="#718096">Planned · $285</Text></Frame></Frame><Frame w="fill" h={48} flex="row" gap={7} p={8} bg="#FFFFFF" rounded={9}>${pill('19', '#E8EDFF', '#4058D6')}<Frame w="fill" h="hug" flex="col" gap={2}><Text size={9} weight="bold" color="#26334A">Crown evaluation</Text><Text size={8} color="#718096">Review · unpriced</Text></Frame></Frame><Frame w="fill" h={48} flex="row" gap={7} p={8} bg="#FFFFFF" rounded={9}>${pill('30', '#FFF4DB', '#A66508')}<Frame w="fill" h="hug" flex="col" gap={2}><Text size={9} weight="bold" color="#26334A">Watch surface</Text><Text size={8} color="#718096">Monitor · 6 months</Text></Frame></Frame></Frame>
          <Frame name="Live App Block" w="fill" h="fill" flex="col" gap={8} p={12} bg="#F7FAFE" rounded={12}><Frame w="fill" h={42} flex="row" gap={7}><Frame w="fill" h="hug" flex="col" gap={2}><Text size={13} weight="bold" color="#16213A">Dental Chart</Text><Text size={8} color="#718096">/dental-chart · adult fixture</Text></Frame>${pill('CAPTURED', '#E5F6EC', '#237C4D')}</Frame><Frame w="fill" h={145} flex="row" gap={8} p={9} bg="#EAF1FA" rounded={10}>${navRail(1)}<Frame w="fill" h="fill" flex="col" gap={7} p={8} bg="#FFFFFF" rounded={9}><Text size={9} weight="bold" color="#16213A">Maya Rodriguez</Text>${toothRow(5, [1, 8])}<Text size={8} color="#65738B">Source-backed application evidence</Text></Frame></Frame><Text size={8} color="#65738B">Inactive capture · shared runtime attaches only when activated</Text></Frame>
        </Frame>
      </Frame>
    </Frame>
    <Frame w={430} h="fill" flex="col" gap={14}><Text size={11} weight="bold" color="#6D4CD2">VERSIONS BRANCH FROM ACTIVE CHARTING ↓</Text>${versionCard({ status: 'DRAFT', title: 'Compact controls', note: 'Denser expert workflow', preview: compactPreview })}${versionCard({ status: 'ALTERNATE', title: 'Comfort-first', note: 'Guided touch-friendly workflow', preview: comfortPreview, preferred: true })}</Frame>
    <Frame w="fill" h="fill" flex="col" gap={14}><Text size={11} weight="bold" color="#237C4D">DECISION EDGE</Text><Frame w="fill" h={230} flex="col" gap={11} p={18} bg="#FFF8E8" rounded={18}><Frame w="fill" h="hug" flex="row" gap={8}>${pill('IN REVIEW', '#FFF0C9', '#9B640D')}<Text size={15} weight="bold" color="#16213A">Compare direction</Text></Frame><Text size={10} color="#65738B">Review the visible workflow differences, token changes, responsive behavior, and source ownership.</Text><Frame w="fill" h={86} flex="col" gap={5} p={11} bg="#FFFFFF" rounded={12}><Text size={10} weight="bold" color="#16213A">Selected direction</Text><Text size={13} weight="bold" color="#4058D6">Comfort-first</Text><Text size={9} color="#65738B">Preferred is a design decision—not permission to modify production.</Text></Frame></Frame><Text size={22} weight="bold" color="#237C4D">↓</Text><Frame w="fill" h={250} flex="col" gap={11} p={18} bg="#E5F6EC" rounded={18}><Frame w="fill" h="hug" flex="row" gap={8}>${pill('APPROVED', '#D5F0E0', '#237C4D')}<Text size={15} weight="bold" color="#16213A">Change set</Text></Frame><Text size={10} color="#4E7461">Packages the chosen version, source targets, acceptance criteria, and verification evidence.</Text><Frame w="fill" h="hug" flex="col" gap={7}><Text size={10} weight="bold" color="#237C4D">Proposal → source patch → tests → real-app verification</Text><Text size={9} color="#4E7461">Production remains unchanged until this explicit handoff is approved and applied.</Text></Frame></Frame></Frame>
  </Frame>
</Frame>`

const pageName = 'Dental Chart'
const pagesResult = await call('list_pages')
let page = pagesResult.pages.find((candidate) => candidate.name === pageName)
if (!page) page = await call('create_page', { name: pageName })
await call('switch_page', { page: page.id })

const existing = await call('find_nodes', {
  name: 'Dental Chart Workflow — Polished',
  type: 'FRAME'
}).catch(() => ({ nodes: [] }))
const existingId = existing.nodes?.[0]?.id

const rendered = await call('render', {
  page_id: page.id,
  parent_id: page.id,
  x: 1800,
  y: 0,
  ...(existingId ? { replace_id: existingId } : {}),
  jsx: board
})

const outputPath =
  '/Users/omar/Documents/Documents - Omar’s MacBook Pro/Codex/Smylr-Elite/archive/agent-tooling/open-pencil-base/knowledge-canvas-self-test.png'
const analyses = {}
for (const name of ['analyze_overlaps', 'analyze_colors', 'analyze_typography', 'analyze_spacing']) {
  analyses[name] = await call(name, { page_id: page.id }).catch((error) => ({ error: error.message }))
}
const exported = await call('export_image', {
  page_id: page.id,
  ids: [rendered.id],
  format: 'PNG',
  scale: 1,
  path: outputPath
})

console.log(JSON.stringify({ page, root: rendered, analyses, exported }, null, 2))
await client.close()
