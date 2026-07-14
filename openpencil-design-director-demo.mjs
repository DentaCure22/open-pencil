import { mkdir, writeFile } from 'node:fs/promises'

import { Client } from '/Users/omar/Documents/Documents - Omar’s MacBook Pro/Codex/Smylr-Elite/archive/agent-tooling/open-pencil-base/node_modules/.bun/@modelcontextprotocol+sdk@1.28.0/node_modules/@modelcontextprotocol/sdk/dist/esm/client/index.js'
import { StreamableHTTPClientTransport } from '/Users/omar/Documents/Documents - Omar’s MacBook Pro/Codex/Smylr-Elite/archive/agent-tooling/open-pencil-base/node_modules/.bun/@modelcontextprotocol+sdk@1.28.0/node_modules/@modelcontextprotocol/sdk/dist/esm/client/streamableHttp.js'

const client = new Client({ name: 'openpencil-design-director-demo', version: '1.0.0' })
const transport = new StreamableHTTPClientTransport(new URL('http://127.0.0.1:7600/mcp'), {
  requestInit: { headers: { Authorization: 'Bearer codex-canvas-demo' } }
})

await client.connect(transport)

async function call(name, args = {}) {
  const result = await client.callTool({ name, arguments: args })
  if (result.isError) throw new Error(result.content?.[0]?.text ?? `${name} failed`)
  const value = result.content?.find((item) => item.type === 'text')?.text
  const parsed = value ? JSON.parse(value) : result
  if (parsed?.error) throw new Error(`${name}: ${parsed.error}`)
  return parsed
}

const C = {
  ink: '#18181B',
  text: '#3F3F46',
  muted: '#71717A',
  faint: '#A1A1AA',
  line: '#E4E4E7',
  soft: '#F4F4F5',
  paper: '#FFFFFF',
  canvas: '#FAFAFA',
  blue: '#5267F6',
  blueSoft: '#EEF0FF',
  violet: '#7C5CE7',
  violetSoft: '#F2EEFF',
  green: '#23845B',
  greenSoft: '#EAF7F0',
  amber: '#A16207',
  amberSoft: '#FFF7E6',
  navy: '#20263A'
}

const pill = (label, bg = C.soft, fg = C.text) =>
  `<Frame w="hug" h="hug" p={8} bg="${bg}" rounded={14}><Text size={12} weight="bold" color="${fg}">${label}</Text></Frame>`

const dot = (color) => `<Frame w={8} h={8} bg="${color}" rounded={4}/>`

const viewNav = (active) => {
  const items = ['Overview', 'Active chart', 'Versions', 'Brief']
  return `<Frame name="View navigation" w="hug" h={40} flex="row" gap={4} p={4} bg="${C.soft}" rounded={12}>
    ${items
      .map(
        (item, index) =>
          `<Frame w="hug" h={32} p={8} bg="${index === active ? C.paper : C.soft}" rounded={9}><Text size={12} weight="${index === active ? 'bold' : 'normal'}" color="${index === active ? C.ink : C.muted}">${item}</Text></Frame>`
      )
      .join('')}
  </Frame>`
}

const viewHeader = (index, kicker, title, subtitle) => `<Frame name="View header" w="fill" h={110} flex="row" gap={24}>
  <Frame w="fill" h="fill" flex="col" gap={7}>
    <Text size={12} weight="bold" color="${C.blue}">${kicker}</Text>
    <Text size={36} weight="bold" color="${C.ink}">${title}</Text>
    <Text size={14} color="${C.muted}">${subtitle}</Text>
  </Frame>
  ${viewNav(index)}
</Frame>`

const patientBar = (compact = false) => `<Frame name="Patient context" w="fill" h={${compact ? 52 : 64}} flex="row" gap={12} p={${compact ? 10 : 14}} bg="${C.paper}" rounded={12} stroke="${C.line}">
  <Frame w={${compact ? 30 : 36}} h={${compact ? 30 : 36}} bg="${C.blueSoft}" rounded={18}><Text size={${compact ? 10 : 12}} weight="bold" color="${C.blue}">MR</Text></Frame>
  <Frame w={${compact ? 170 : 235}} h="hug" flex="col" gap={3}><Text size={${compact ? 12 : 14}} weight="bold" color="${C.ink}">Maya Rodriguez</Text><Text size={${compact ? 10 : 11}} color="${C.muted}">34 · ID 10482 · Recall due</Text></Frame>
  <Frame w="fill" h="fill" flex="row" gap={8}>${pill('No allergies', C.greenSoft, C.green)}${compact ? '' : pill('Last visit 6 months', C.soft, C.text)}</Frame>
</Frame>`

const rail = (compact = false) => `<Frame name="Clinical rail" w={${compact ? 42 : 52}} h="fill" flex="col" gap={10} p={8} bg="${C.navy}" rounded={12}>
  ${['H', 'C', 'P', 'T', 'R']
    .map(
      (label, index) =>
        `<Frame w={${compact ? 26 : 36}} h={${compact ? 30 : 36}} bg="${index === 1 ? C.blue : '#343B52'}" rounded={9}><Text size={${compact ? 10 : 12}} weight="bold" color="#FFFFFF">${label}</Text></Frame>`
    )
    .join('')}
</Frame>`

const toothStrip = (compact = false) => `<Frame name="Odontogram" w="fill" h={${compact ? 64 : 82}} flex="row" gap={${compact ? 5 : 8}} p={${compact ? 8 : 10}} bg="${C.soft}" rounded={12}>
  ${Array.from({ length: compact ? 10 : 12 }, (_, index) => {
    const tooth = index + (compact ? 10 : 9)
    const active = tooth === 14
    const complete = tooth === 11 || tooth === 17
    const bg = active ? C.blue : complete ? C.greenSoft : C.paper
    const fg = active ? '#FFFFFF' : complete ? C.green : C.text
    return `<Frame w="fill" h="fill" flex="col" gap={4} p={5} bg="${bg}" rounded={9}><Text size={${compact ? 10 : 11}} weight="bold" color="${fg}">${tooth}</Text><Frame w="fill" h={${compact ? 20 : 28}} bg="${active ? '#8997FF' : '#E7E7EA'}" rounded={6}/></Frame>`
  }).join('')}
</Frame>`

const miniState = ({ number, title, meta, accent, body }) => `<Frame name="State ${number} / ${title}" w={344} h={580} flex="col" gap={14} p={18} bg="${C.paper}" rounded={18} stroke="${C.line}">
  <Frame w="fill" h={56} flex="row" gap={10}>
    <Frame w={40} h={40} bg="${accent === C.blue ? C.blueSoft : accent === C.green ? C.greenSoft : C.violetSoft}" rounded={12}><Text size={13} weight="bold" color="${accent}">${number}</Text></Frame>
    <Frame w="fill" h="hug" flex="col" gap={4}><Text size={16} weight="bold" color="${C.ink}">${title}</Text><Text size={11} color="${C.muted}">${meta}</Text></Frame>
  </Frame>
  <Frame name="Illustrative preview" w="fill" h="fill" flex="col" gap={10} p={12} bg="${C.canvas}" rounded={14}>
    ${patientBar(true)}
    ${body}
  </Frame>
  <Frame w="fill" h={28} flex="row" gap={7}>${dot(accent)}<Text size={11} color="${C.muted}">Illustrative preview · production unchanged</Text></Frame>
</Frame>`

const currentMini = `<Frame w="fill" h="fill" flex="row" gap={10}>${rail(true)}<Frame w="fill" h="fill" flex="col" gap={10}>${toothStrip(true)}<Frame w="fill" h={76} flex="row" gap={8}><Frame w="fill" h="fill" flex="col" gap={5} p={10} bg="${C.paper}" rounded={10}><Text size={11} color="${C.muted}">Dentition</Text><Text size={13} weight="bold" color="${C.ink}">Permanent</Text></Frame><Frame w="fill" h="fill" flex="col" gap={5} p={10} bg="${C.paper}" rounded={10}><Text size={11} color="${C.muted}">Open items</Text><Text size={13} weight="bold" color="${C.amber}">3 planned</Text></Frame></Frame><Frame w="fill" h="fill" flex="col" gap={8} p={12} bg="${C.paper}" rounded={10}><Text size={12} weight="bold" color="${C.ink}">Today</Text><Text size={11} color="${C.muted}">Select a tooth to begin charting.</Text>${pill('Start charting', C.blueSoft, C.blue)}</Frame></Frame></Frame>`

const setupMini = `<Frame w="fill" h="fill" flex="row" gap={10}>${rail(true)}<Frame w="fill" h="fill" flex="col" gap={10}><Text size={12} weight="bold" color="${C.ink}">Choose charting protocol</Text><Frame w="fill" h={72} flex="col" gap={4} p={12} bg="${C.blueSoft}" rounded={11}><Text size={13} weight="bold" color="${C.blue}">Comprehensive exam</Text><Text size={11} color="${C.text}">Hard tissue + conditions</Text></Frame><Frame w="fill" h={64} flex="col" gap={4} p={12} bg="${C.paper}" rounded={11}><Text size={12} weight="bold" color="${C.ink}">Limited exam</Text><Text size={11} color="${C.muted}">Focused complaint</Text></Frame><Frame w="fill" h="fill" flex="col" gap={10} p={12} bg="${C.paper}" rounded={11}><Text size={12} weight="bold" color="${C.ink}">Include in session</Text><Text size={11} color="${C.text}">✓ Existing restorations</Text><Text size={11} color="${C.text}">✓ Planned treatment</Text><Text size={11} color="${C.muted}">○ Perio findings</Text></Frame></Frame></Frame>`

const activeMini = `<Frame w="fill" h="fill" flex="row" gap={10}>${rail(true)}<Frame w="fill" h="fill" flex="col" gap={10}>${toothStrip(true)}<Frame w="fill" h="fill" flex="row" gap={8}><Frame w={112} h="fill" flex="col" gap={8} p={10} bg="${C.paper}" rounded={11}><Text size={13} weight="bold" color="${C.ink}">Tooth #14</Text><Text size={11} color="${C.muted}">Surface</Text><Frame w="fill" h={44} bg="${C.blue}" rounded={9}><Text size={12} weight="bold" color="#FFFFFF">O</Text></Frame>${pill('Caries', C.amberSoft, C.amber)}</Frame><Frame w="fill" h="fill" flex="col" gap={8} p={10} bg="${C.paper}" rounded={11}><Text size={13} weight="bold" color="${C.ink}">Treatment</Text><Frame w="fill" h={44} p={11} bg="${C.blueSoft}" rounded={9}><Text size={11} weight="bold" color="${C.blue}">Composite</Text></Frame><Frame w="fill" h={44} p={11} bg="${C.soft}" rounded={9}><Text size={11} color="${C.text}">Crown</Text></Frame><Frame w="fill" h="fill" p={11} bg="${C.greenSoft}" rounded={9}><Text size={11} weight="bold" color="${C.green}">Queued for review</Text></Frame></Frame></Frame></Frame></Frame>`

const reviewMini = `<Frame w="fill" h="fill" flex="row" gap={10}>${rail(true)}<Frame w="fill" h="fill" flex="col" gap={8}>${['14 · Composite restoration', '19 · Crown evaluation', '30 · Watch surface']
  .map(
    (label, index) =>
      `<Frame w="fill" h={64} flex="row" gap={8} p={10} bg="${C.paper}" rounded={10}><Frame w={34} h={34} bg="${index === 2 ? C.amberSoft : C.blueSoft}" rounded={8}><Text size={11} weight="bold" color="${index === 2 ? C.amber : C.blue}">${[14, 19, 30][index]}</Text></Frame><Frame w="fill" h="hug" flex="col" gap={4}><Text size={11} weight="bold" color="${C.ink}">${label.split(' · ')[1]}</Text><Text size={10} color="${C.muted}">${index === 2 ? 'Monitor · 6 months' : 'Planned treatment'}</Text></Frame></Frame>`
  )
  .join('')}<Frame w="fill" h="fill" flex="col" gap={7} p={12} bg="${C.greenSoft}" rounded={10}><Text size={11} color="${C.green}">Estimated treatment</Text><Text size={18} weight="bold" color="${C.green}">$285</Text>${pill('Approve plan', '#D6F0E2', C.green)}</Frame></Frame></Frame>`

const overview = `<Frame name="Design Director / 01 Flow Overview" w={1600} h={1000} flex="col" gap={26} p={48} bg="${C.canvas}" rounded={24}>
  ${viewHeader(0, 'DENTAL CHART · FLOW OVERVIEW', 'One journey. Four clear states.', 'Scan the clinical path first; open another view when you need detail.')}
  <Frame name="Flow legend" w="fill" h={54} flex="row" gap={12}>${pill('→ Production flow', C.blueSoft, C.blue)}${pill('↓ Safe edit branch', C.violetSoft, C.violet)}${pill('✓ Explicit review', C.greenSoft, C.green)}<Frame w="fill" h={1}/>${pill('Source: /dental-chart', C.paper, C.text)}</Frame>
  <Frame name="Four-state journey" w="fill" h="fill" flex="row" gap={18}>
    ${miniState({ number: '01', title: 'Patient selected', meta: 'Current production anchor', accent: C.blue, body: currentMini })}
    ${miniState({ number: '02', title: 'Exam setup', meta: 'Choose protocol', accent: C.blue, body: setupMini })}
    ${miniState({ number: '03', title: 'Active charting', meta: 'Tooth + surface entry', accent: C.violet, body: activeMini })}
    ${miniState({ number: '04', title: 'Review changes', meta: 'Confirm findings', accent: C.green, body: reviewMini })}
  </Frame>
</Frame>`

const fullChartApp = `<Frame name="Active charting application" w="fill" h="fill" flex="col" gap={12} p={16} bg="${C.canvas}" rounded={16} stroke="${C.line}">
  ${patientBar(false)}
  <Frame w="fill" h="fill" flex="row" gap={14}>
    ${rail(false)}
    <Frame w="fill" h="fill" flex="col" gap={14}>
      ${toothStrip(false)}
      <Frame w="fill" h="fill" flex="row" gap={14}>
        <Frame name="Tooth controls" w={300} h="fill" flex="col" gap={12} p={18} bg="${C.paper}" rounded={14} stroke="${C.line}">
          <Frame w="fill" h={52} flex="row" gap={10}><Frame w="fill" h="hug" flex="col" gap={4}><Text size={16} weight="bold" color="${C.ink}">Tooth #14</Text><Text size={12} color="${C.muted}">Upper left first molar</Text></Frame>${pill('ACTIVE', C.blueSoft, C.blue)}</Frame>
          <Text size={12} weight="bold" color="${C.text}">Select surface</Text>
          <Frame w="fill" h={118} flex="col" gap={8} p={12} bg="${C.soft}" rounded={12}>
            <Frame w="fill" h={42} flex="row" gap={8}><Frame w="fill" h="fill" bg="${C.paper}" rounded={9}><Text size={12} weight="bold" color="${C.text}">M</Text></Frame><Frame w="fill" h="fill" bg="${C.blue}" rounded={9}><Text size={12} weight="bold" color="#FFFFFF">O</Text></Frame><Frame w="fill" h="fill" bg="${C.paper}" rounded={9}><Text size={12} weight="bold" color="${C.text}">D</Text></Frame></Frame>
            <Frame w="fill" h={42} flex="row" gap={8}><Frame w="fill" h="fill" bg="${C.paper}" rounded={9}><Text size={12} weight="bold" color="${C.text}">B</Text></Frame><Frame w="fill" h="fill" bg="${C.paper}" rounded={9}><Text size={12} weight="bold" color="${C.text}">L</Text></Frame></Frame>
          </Frame>
          <Text size={12} weight="bold" color="${C.text}">Finding</Text>
          <Frame w="fill" h={66} flex="col" gap={4} p={12} bg="${C.amberSoft}" rounded={11}><Text size={13} weight="bold" color="${C.amber}">Primary caries</Text><Text size={11} color="${C.text}">Occlusal surface</Text></Frame>
          <Frame w="fill" h="fill" flex="col" gap={6} p={12} bg="${C.soft}" rounded={11}><Text size={11} color="${C.muted}">Keyboard</Text><Text size={12} weight="bold" color="${C.ink}">O → C → Enter</Text><Text size={11} color="${C.muted}">Expert path remains available</Text></Frame>
        </Frame>
        <Frame name="Treatment choices" w="fill" h="fill" flex="col" gap={12} p={18} bg="${C.paper}" rounded={14} stroke="${C.line}">
          <Text size={16} weight="bold" color="${C.ink}">Choose treatment</Text>
          <Text size={12} color="${C.muted}">Recommended for this finding</Text>
          <Frame w="fill" h={82} flex="row" gap={12} p={14} bg="${C.blueSoft}" rounded={12} stroke="#C9CEFF"><Frame w={46} h={46} bg="${C.blue}" rounded={12}><Text size={14} weight="bold" color="#FFFFFF">CR</Text></Frame><Frame w="fill" h="hug" flex="col" gap={5}><Text size={14} weight="bold" color="${C.blue}">Composite restoration</Text><Text size={11} color="${C.text}">One-surface posterior · $285</Text></Frame>${pill('RECOMMENDED', '#DDE1FF', C.blue)}</Frame>
          <Frame w="fill" h={68} flex="row" gap={10} p={14} bg="${C.soft}" rounded={12}><Frame w="fill" h="hug" flex="col" gap={5}><Text size={13} weight="bold" color="${C.ink}">Crown · ceramic</Text><Text size={11} color="${C.muted}">Full coverage restoration</Text></Frame></Frame>
          <Frame w="fill" h={68} flex="row" gap={10} p={14} bg="${C.soft}" rounded={12}><Frame w="fill" h="hug" flex="col" gap={5}><Text size={13} weight="bold" color="${C.ink}">Monitor surface</Text><Text size={11} color="${C.muted}">No treatment today</Text></Frame></Frame>
          <Frame w="fill" h="fill" flex="col" gap={8} p={14} bg="${C.greenSoft}" rounded={12}><Frame w="fill" h={28} flex="row" gap={8}>${dot(C.green)}<Text size={12} weight="bold" color="${C.green}">Queued for review</Text></Frame><Text size={13} weight="bold" color="${C.ink}">#14 · O · Composite restoration</Text><Text size={11} color="${C.text}">Nothing is committed until the review step.</Text></Frame>
        </Frame>
      </Frame>
    </Frame>
  </Frame>
</Frame>`

const focus = `<Frame name="Design Director / 02 Active Charting Focus" w={1600} h={1000} flex="col" gap={26} p={48} bg="${C.canvas}" rounded={24}>
  ${viewHeader(1, 'FOCUS VIEW · ACTIVE CHARTING', 'Make the next clinical action obvious.', 'One large application state, with only the context needed to judge it.')}
  <Frame w="fill" h="fill" flex="row" gap={24}>
    <Frame name="Primary evidence" w={1120} h="fill" flex="col" gap={10}>${fullChartApp}<Frame w="fill" h={24} flex="row" gap={7}>${dot(C.blue)}<Text size={11} color="${C.muted}">Illustrative preview based on /dental-chart · not a live production capture</Text></Frame></Frame>
    <Frame name="Context rail" w="fill" h="fill" flex="col" gap={16}>
      <Frame w="fill" h={168} flex="col" gap={10} p={18} bg="${C.paper}" rounded={16} stroke="${C.line}"><Text size={12} weight="bold" color="${C.blue}">DESIGN INTENT</Text><Text size={18} weight="bold" color="${C.ink}">Speed without ambiguity</Text><Text size={12} color="${C.text}">Keep the expert shortcut path while giving the recommended treatment a visible home.</Text></Frame>
      <Frame w="fill" h={236} flex="col" gap={12} p={18} bg="${C.paper}" rounded={16} stroke="${C.line}"><Text size={14} weight="bold" color="${C.ink}">What to inspect</Text><Text size={12} color="${C.text}">✓ Patient context stays visible</Text><Text size={12} color="${C.text}">✓ Tooth and surface stay selected</Text><Text size={12} color="${C.text}">✓ Recommendation is explicit</Text><Text size={12} color="${C.text}">✓ Review remains a separate step</Text></Frame>
      <Frame w="fill" h={172} flex="col" gap={10} p={18} bg="${C.violetSoft}" rounded={16}><Text size={12} weight="bold" color="${C.violet}">SAFE EDIT STATE</Text><Text size={16} weight="bold" color="${C.ink}">Comfort-first draft</Text><Text size={12} color="${C.text}">This view can branch into versions without changing production.</Text>${pill('Open Versions →', '#E4DCFF', C.violet)}</Frame>
      <Frame w="fill" h="fill" flex="col" gap={10} p={18} bg="${C.greenSoft}" rounded={16}><Text size={12} weight="bold" color="${C.green}">SUCCESS CHECK</Text><Text size={16} weight="bold" color="${C.ink}">A new user can act in 5 seconds.</Text><Text size={12} color="${C.text}">An expert can still complete the action from the keyboard.</Text></Frame>
    </Frame>
  </Frame>
</Frame>`

const variantPreview = (kind) => {
  const config = {
    Production: { accent: C.text, soft: C.soft, badge: 'BASELINE', title: 'Dense expert layout', note: 'Fast, but hierarchy is flat.' },
    Compact: { accent: C.violet, soft: C.violetSoft, badge: 'DRAFT A', title: 'Compact controls', note: 'More shortcuts above the fold.' },
    Comfort: { accent: C.blue, soft: C.blueSoft, badge: 'PREFERRED', title: 'Comfort-first', note: 'Guided next action + expert path.' }
  }[kind]
  const treatmentBlocks =
    kind === 'Production'
      ? `<Frame w="fill" h={52} bg="${C.soft}" rounded={9}/><Frame w="fill" h={52} bg="${C.soft}" rounded={9}/><Frame w="fill" h={52} bg="${C.soft}" rounded={9}/>`
      : kind === 'Compact'
        ? `<Frame w="fill" h={42} bg="${C.violetSoft}" rounded={9}/><Frame w="fill" h={42} bg="${C.violetSoft}" rounded={9}/><Frame w="fill" h={42} bg="${C.soft}" rounded={9}/><Frame w="fill" h={42} bg="${C.soft}" rounded={9}/>`
        : `<Frame w="fill" h={78} flex="col" gap={5} p={12} bg="${C.blueSoft}" rounded={10}><Text size={12} weight="bold" color="${C.blue}">Recommended next action</Text><Text size={13} weight="bold" color="${C.ink}">Composite restoration</Text></Frame><Frame w="fill" h={60} flex="row" gap={8}><Frame w="fill" h="fill" bg="${C.paper}" rounded={9}><Text size={11} weight="bold" color="${C.text}">1 · Surface</Text></Frame><Frame w="fill" h="fill" bg="${C.paper}" rounded={9}><Text size={11} weight="bold" color="${C.text}">2 · Finding</Text></Frame></Frame>`
  return `<Frame name="Version / ${kind}" w="fill" h="fill" flex="col" gap={14} p={18} bg="${C.paper}" rounded={18} stroke="${kind === 'Comfort' ? '#BFC6FF' : C.line}">
    <Frame w="fill" h={70} flex="col" gap={6}><Frame w="fill" h={24} flex="row" gap={7}>${dot(config.accent)}<Text size={11} weight="bold" color="${config.accent}">${config.badge}</Text></Frame><Text size={18} weight="bold" color="${C.ink}">${config.title}</Text><Text size={11} color="${C.muted}">${config.note}</Text></Frame>
    <Frame name="Illustrative preview" w="fill" h="fill" flex="col" gap={10} p={12} bg="${C.canvas}" rounded={13}>
      ${patientBar(true)}
      ${toothStrip(true)}
      <Frame w="fill" h="fill" flex="row" gap={10}><Frame w={120} h="fill" flex="col" gap={8} p={10} bg="${C.paper}" rounded={10}><Text size={12} weight="bold" color="${C.ink}">Tooth #14</Text><Text size={11} color="${C.muted}">Occlusal</Text><Frame w="fill" h={58} bg="${config.accent}" rounded={10}><Text size={13} weight="bold" color="#FFFFFF">O</Text></Frame>${pill('Caries', C.amberSoft, C.amber)}</Frame><Frame w="fill" h="fill" flex="col" gap={8} p={10} bg="${C.paper}" rounded={10}><Text size={12} weight="bold" color="${C.ink}">Treatment</Text>${treatmentBlocks}<Frame w="fill" h="fill" bg="${kind === 'Comfort' ? C.greenSoft : config.soft}" rounded={9}/></Frame></Frame>
    </Frame>
    <Frame w="fill" h={52} flex="row" gap={8}>${kind === 'Comfort' ? pill('SELECTED DIRECTION', C.greenSoft, C.green) : pill('Compare', C.soft, C.text)}<Frame w="fill" h={1}/><Text size={11} color="${C.muted}">Source unchanged</Text></Frame>
  </Frame>`
}

const compare = `<Frame name="Design Director / 03 Versions Review" w={1600} h={1000} flex="col" gap={26} p={48} bg="${C.canvas}" rounded={24}>
  ${viewHeader(2, 'COMPARE VIEW · SAFE EDIT VERSIONS', 'Compare the interface—not the documentation.', 'Three equally sized states make the differences visible at a glance.')}
  <Frame name="Comparison criteria" w="fill" h={54} flex="row" gap={10}>${pill('Hierarchy', C.paper, C.text)}${pill('Expert speed', C.paper, C.text)}${pill('New-user clarity', C.paper, C.text)}${pill('Review safety', C.paper, C.text)}<Frame w="fill" h={1}/>${pill('Preferred ≠ production', C.amberSoft, C.amber)}</Frame>
  <Frame name="Version comparison" w="fill" h="fill" flex="row" gap={22}>${variantPreview('Production')}${variantPreview('Compact')}${variantPreview('Comfort')}</Frame>
</Frame>`

const linkedRecord = (tooth, title, status, accent, soft, meta) => `<Frame w="fill" h={88} flex="row" gap={12} p={14} bg="${C.paper}" rounded={12} stroke="${C.line}"><Frame w={48} h={48} bg="${soft}" rounded={11}><Text size={14} weight="bold" color="${accent}">${tooth}</Text></Frame><Frame w="fill" h="hug" flex="col" gap={5}><Text size={13} weight="bold" color="${C.ink}">${title}</Text><Text size={11} color="${C.muted}">${meta}</Text></Frame>${pill(status, soft, accent)}</Frame>`

const knowledge = `<Frame name="Design Director / 04 Knowledge Detail" w={1600} h={1000} flex="col" gap={26} p={48} bg="${C.canvas}" rounded={24}>
  ${viewHeader(3, 'KNOWLEDGE VIEW · DESIGN BRIEF', 'The thinking behind the board.', 'Notion-like detail lives here, away from the visual workflow.')}
  <Frame w="fill" h="fill" flex="row" gap={28}>
    <Frame name="Design brief document" w={920} h="fill" flex="col" gap={20} p={32} bg="${C.paper}" rounded={18} stroke="${C.line}">
      <Frame w="fill" h={54} flex="row" gap={12}><Frame w={44} h={44} bg="${C.blueSoft}" rounded={12}><Text size={18} weight="bold" color="${C.blue}">✦</Text></Frame><Frame w="fill" h="hug" flex="col" gap={4}><Text size={22} weight="bold" color="${C.ink}">Charting improvement brief</Text><Text size={12} color="${C.muted}">Updated today · owner: Product Design</Text></Frame></Frame>
      <Frame w="fill" h={112} flex="col" gap={8} p={18} bg="${C.blueSoft}" rounded={14}><Text size={12} weight="bold" color="${C.blue}">DESIGN QUESTION</Text><Text size={18} weight="bold" color="${C.ink}">How might we keep expert charting speed while making the next action obvious?</Text></Frame>
      <Frame w="fill" h={156} flex="col" gap={10}><Text size={16} weight="bold" color="${C.ink}">What must stay true</Text><Text size={13} color="${C.text}">✓ Patient context remains visible throughout the task.</Text><Text size={13} color="${C.text}">✓ Tooth and surface selection never become ambiguous.</Text><Text size={13} color="${C.text}">✓ No production source changes without explicit handoff.</Text><Text size={13} color="${C.text}">✓ Keyboard-first experts keep a fast path.</Text></Frame>
      <Frame w="fill" h={156} flex="row" gap={14}><Frame w="fill" h="fill" flex="col" gap={9} p={18} bg="${C.soft}" rounded={14}><Text size={12} weight="bold" color="${C.muted}">DECISION</Text><Text size={17} weight="bold" color="${C.ink}">Comfort-first is preferred</Text><Text size={12} color="${C.text}">It gives hierarchy to the next action without removing expert controls.</Text></Frame><Frame w="fill" h="fill" flex="col" gap={9} p={18} bg="${C.greenSoft}" rounded={14}><Text size={12} weight="bold" color="${C.green}">SUCCESS SIGNAL</Text><Text size={17} weight="bold" color="${C.ink}">Act in 5 seconds</Text><Text size={12} color="${C.text}">First-time users understand the recommended path; experts retain shortcuts.</Text></Frame></Frame>
      <Frame w="fill" h="fill" flex="col" gap={12}><Text size={16} weight="bold" color="${C.ink}">Open questions</Text><Frame w="fill" h={48} flex="row" gap={10} p={12} bg="${C.canvas}" rounded={10}>${dot(C.amber)}<Text size={12} color="${C.text}">Does the comfort-first hierarchy still work at tablet width?</Text></Frame><Frame w="fill" h={48} flex="row" gap={10} p={12} bg="${C.canvas}" rounded={10}>${dot(C.amber)}<Text size={12} color="${C.text}">Can an expert complete the flow without touching the pointer?</Text></Frame></Frame>
    </Frame>
    <Frame name="Linked knowledge" w="fill" h="fill" flex="col" gap={18}>
      <Frame w="fill" h={156} flex="col" gap={10} p={20} bg="${C.paper}" rounded={16} stroke="${C.line}"><Frame w="fill" h={30} flex="row" gap={8}>${dot(C.green)}<Text size={12} weight="bold" color="${C.green}">SOURCE CONTEXT</Text></Frame><Text size={18} weight="bold" color="${C.ink}">Dental Chart</Text><Text size={12} color="${C.text}">Route: /dental-chart</Text><Text size={12} color="${C.muted}">Illustrative states only · production source protected</Text></Frame>
      <Frame w="fill" h={60} flex="row" gap={10}><Text size={18} weight="bold" color="${C.ink}">Linked findings</Text><Frame w="fill" h={1}/>${pill('3 records', C.soft, C.text)}</Frame>
      ${linkedRecord('14', 'Composite restoration', 'PLANNED', C.blue, C.blueSoft, 'Occlusal · $285')}
      ${linkedRecord('19', 'Crown evaluation', 'REVIEW', C.violet, C.violetSoft, 'Buccal · unpriced')}
      ${linkedRecord('30', 'Watch surface', 'MONITOR', C.amber, C.amberSoft, 'Distal · 6 months')}
      <Frame w="fill" h="fill" flex="col" gap={10} p={20} bg="${C.violetSoft}" rounded={16}><Text size={12} weight="bold" color="${C.violet}">HANDOFF PATH</Text><Text size={16} weight="bold" color="${C.ink}">Proposal → source patch → tests → real-app verification</Text><Text size={12} color="${C.text}">A preferred design is still only a design decision until this handoff is approved.</Text></Frame>
    </Frame>
  </Frame>
</Frame>`

const pageName = 'Page 1'
const pageList = await call('list_pages')
const page =
  pageList.pages.find((candidate) => candidate.name === pageName) ??
  (await call('create_page', { name: pageName }))
await call('switch_page', { page: page.id })

const baseline = await call('find_nodes', { name: 'Dental Chart Workflow — Polished', type: 'FRAME' })
for (const node of baseline.nodes.filter((candidate) => candidate.name === 'Dental Chart Workflow — Polished')) {
  await call('set_visible', { id: node.id, value: false })
}

const definitions = [
  { name: 'Design Director / 01 Flow Overview', x: 0, y: 0, jsx: overview, file: '08-flow-overview.png' },
  { name: 'Design Director / 02 Active Charting Focus', x: 2000, y: 0, jsx: focus, file: '09-active-chart-focus.png' },
  { name: 'Design Director / 03 Versions Review', x: 0, y: 1300, jsx: compare, file: '10-versions-review.png' },
  { name: 'Design Director / 04 Knowledge Detail', x: 2000, y: 1300, jsx: knowledge, file: '11-knowledge-detail.png' }
]

const roots = []
for (const definition of definitions) {
  const found = await call('find_nodes', { name: definition.name, type: 'FRAME' })
  const exact = found.nodes.filter((candidate) => candidate.name === definition.name)
  const rendered = await call('render', {
    parent_id: page.id,
    x: definition.x,
    y: definition.y,
    ...(exact[0] ? { replace_id: exact[0].id } : {}),
    jsx: definition.jsx
  })
  for (const duplicate of exact.slice(1)) await call('set_visible', { id: duplicate.id, value: false })
  roots.push({
    name: definition.name,
    file: definition.file,
    x: definition.x,
    y: definition.y,
    id: rendered.id,
    warnings: rendered.warnings
  })
}

const artifactDir = '/Users/omar/Documents/Open Pencil/artifacts/design-director'
await mkdir(artifactDir, { recursive: true })
await call('switch_page', { page: pageName })
const currentPage = await call('get_current_page')
const exports = []
for (const root of roots) {
  try {
    const exported = await client.callTool({
      name: 'export_image',
      arguments: { ids: [root.id], format: 'PNG', scale: 1 }
    })
    if (exported.isError) {
      throw new Error(exported.content?.find((item) => item.type === 'text')?.text ?? 'Export failed')
    }
    const image = exported.content?.find((item) => item.type === 'image')
    const text = exported.content?.find((item) => item.type === 'text')?.text
    const metadata = text ? JSON.parse(text) : {}
    const base64 = image?.data ?? metadata.base64
    if (!base64) throw new Error('Export returned no PNG payload')
    const output = `${artifactDir}/${root.file}`
    await writeFile(output, Buffer.from(base64, 'base64'))
    exports.push({ name: root.name, output, bytes: metadata.byteLength ?? Buffer.byteLength(base64, 'base64') })
  } catch (error) {
    exports.push({ name: root.name, error: error.message })
  }
}

const analyses = {}
for (const name of ['analyze_overlaps', 'analyze_colors', 'analyze_typography', 'analyze_spacing']) {
  analyses[name] = await call(name).catch((error) => ({ error: error.message }))
}

const analysisSummary = {
  overlaps: analyses.analyze_overlaps?.summary ?? analyses.analyze_overlaps,
  colors: analyses.analyze_colors?.error
    ? analyses.analyze_colors
    : {
        totalNodes: analyses.analyze_colors?.totalNodes,
        uniqueColors: analyses.analyze_colors?.uniqueColors
      },
  typography: analyses.analyze_typography?.error
    ? analyses.analyze_typography
    : {
        totalTextNodes: analyses.analyze_typography?.totalTextNodes,
        uniqueStyles: analyses.analyze_typography?.uniqueStyles
      },
  spacing: analyses.analyze_spacing?.error
    ? analyses.analyze_spacing
    : {
        totalNodes: analyses.analyze_spacing?.totalNodes,
        offGridGapCount: analyses.analyze_spacing?.offGridGaps?.length,
        offGridPaddingCount: analyses.analyze_spacing?.offGridPaddings?.length
      }
}

console.log(
  JSON.stringify(
    { page, currentPage, baselineHidden: baseline.nodes.length, roots, exports, analysisSummary },
    null,
    2
  )
)
await client.close()
