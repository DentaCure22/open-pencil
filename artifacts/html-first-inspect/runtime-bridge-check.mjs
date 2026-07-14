import assert from 'node:assert/strict'
import { writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'

const APP_ROOT =
  '/Users/omar/Documents/Documents - Omar’s MacBook Pro/Codex/Smylr-Elite/archive/agent-tooling/open-pencil-base'
const OUTPUT_ROOT = '/Users/omar/Documents/Open Pencil/artifacts/html-first-inspect'
const requireFromApp = createRequire(`${APP_ROOT}/package.json`)
const viteEntry = requireFromApp.resolve('vite')
const { createServer } = await import(pathToFileURL(viteEntry).href)

const html = `<main class="site" data-openpencil-component="LandingPage" data-openpencil-component-id="landing-page-1" data-openpencil-width="1440" data-openpencil-height="900">
  <nav data-openpencil-component="Navigation" data-openpencil-component-id="navigation-1" data-openpencil-slot="navigation-status" data-openpencil-slot-label="Navigation status" data-openpencil-slot-accepts="SmylrAvatar,SmylrBadge,SmylrDropdownMenu"><strong>New project</strong><a href="#content">Explore</a></nav>
  <section id="content" data-openpencil-component="Hero" data-openpencil-component-id="hero-1" data-openpencil-slot="hero-content" data-openpencil-slot-label="Hero content" data-openpencil-slot-accepts="SmylrAccordion,SmylrAlert,SmylrCalendar,SmylrCard,SmylrProgress,SmylrSeparator,SmylrTable,SmylrTabs,SmylrTooltip">
    <p class="eyebrow">HTML-first canvas</p>
    <h1>Design the real interface.</h1>
    <p class="lede">Edit standard HTML and CSS, then interact with the result directly on the board.</p>
    <div class="hero-actions" data-openpencil-slot="hero-actions" data-openpencil-slot-label="Hero controls" data-openpencil-slot-accepts="ActionButton,TextLink,SmylrButton,SmylrCheckbox,SmylrInput,SmylrRadioGroup,SmylrSelect,SmylrSlider,SmylrSwitch,SmylrTextarea">
      <button class="op-action" type="button" aria-pressed="false" data-openpencil-component="PrimaryAction" data-openpencil-component-id="primary-action-1" data-openpencil-prop-label="Start here" data-openpencil-control-label="text" data-openpencil-bind-label="text" data-openpencil-prop-tone="solid" data-openpencil-control-tone="select" data-openpencil-options-tone="solid,soft" data-openpencil-bind-tone="attribute:data-tone" data-openpencil-variant="primary" data-tone="solid">Start here</button>
    </div>
  </section>
</main>`

const css = `:root { color-scheme: light; font-family: Inter, system-ui, sans-serif; }
* { box-sizing: border-box; }
body { margin: 0; background: #f5f5f2; color: #171717; }
.site { width: 100%; min-height: 100vh; padding: 48px 64px; }
nav { display: flex; justify-content: space-between; align-items: center; }
nav a { color: inherit; text-decoration: none; }
section { max-width: 760px; margin-top: 150px; }
.eyebrow { color: #3159d9; font-size: 13px; font-weight: 700; text-transform: uppercase; letter-spacing: .08em; }
h1 { margin: 12px 0; font-size: 72px; line-height: .98; letter-spacing: -.05em; }
.lede { max-width: 620px; color: #666; font-size: 20px; line-height: 1.5; }
.hero-actions { display: flex; align-items: center; gap: 18px; margin-top: 24px; }
.op-action { border: 0; border-radius: 10px; padding: 14px 20px; background: #171717; color: white; font-weight: 650; }`

const js = `const action = document.querySelector('[data-openpencil-component="PrimaryAction"]')
action?.addEventListener('click', () => {
  action.setAttribute('aria-pressed', 'true')
  action.textContent = 'Started'
})`

const vite = await createServer({
  appType: 'custom',
  cacheDir: `${OUTPUT_ROOT}/.vite-cache`,
  configFile: false,
  logLevel: 'silent',
  optimizeDeps: { include: [], noDiscovery: true },
  root: APP_ROOT,
  server: { middlewareMode: true }
})

try {
  const workspace = await vite.ssrLoadModule('/src/app/html-board/workspace.ts')
  const componentSources = await vite.ssrLoadModule(
    '/src/app/html-board/component-sources.ts'
  )
  const components = await vite.ssrLoadModule('/src/app/html-board/components.ts')
  const { SceneGraph } = await vite.ssrLoadModule('/packages/scene-graph/src/index.ts')
  const { UndoManager } = await vite.ssrLoadModule('/packages/scene-graph/src/undo.ts')
  const document = {
    css,
    format: 'html',
    html,
    runtime: 'sandboxed-browser',
    schemaVersion: 1,
    viewport: { height: 900, width: 1440 }
  }
  const node = {
    height: 900,
    id: 'html-board-test',
    pluginData: [
      { key: 'kind', pluginId: 'openpencil-html-board', value: 'html-board' },
      {
        key: 'document',
        pluginId: 'openpencil-html-board',
        value: JSON.stringify(document)
      }
    ],
    type: 'FRAME',
    width: 1440
  }
  const migrated = workspace.htmlBoardDocument(node)
  assert.equal(workspace.HTML_BOARD_SCHEMA_VERSION, 6)
  assert.equal(migrated.schemaVersion, 6)
  assert.equal(migrated.revision, 1)
  assert.equal(migrated.js, '')
  assert.equal(migrated.artifact, null)
  assert.equal(migrated.workflow.status, 'production')
  assert.deepEqual(migrated.revisions, [])

  let liveNode = node
  const store = {
    graph: { getNode: () => liveNode },
    requestRender() {},
    updateNodeWithUndo(_id, changes) {
      liveNode = { ...liveNode, ...changes }
    }
  }
  assert.equal(
    workspace.updateHtmlBoardFrame(store, node.id, `${html}\n<footer>Blocked</footer>`, css, js),
    false
  )
  assert.equal(
    workspace.updateHtmlBoardFrame(
      store,
      node.id,
      `${html}\n<footer>Revision two</footer>`,
      css,
      js,
      'Regenerate test artifact',
      true
    ),
    true
  )
  const revisionTwo = workspace.htmlBoardDocument(liveNode)
  assert.equal(revisionTwo.revision, 2)
  assert.equal(revisionTwo.js, js)
  assert.equal(revisionTwo.revisions.length, 1)
  assert.equal(revisionTwo.revisions[0].html, html)
  assert.deepEqual(workspace.htmlBoardRevisionRef(liveNode), {
    boardId: node.id,
    revision: 2,
    schemaVersion: 6
  })
  assert.equal(workspace.htmlBoardRevision(liveNode, 1)?.html, html)
  assert.equal(workspace.htmlBoardRevision(liveNode, 2)?.html, revisionTwo.html)

  const srcdoc = workspace.htmlBoardSrcdoc(liveNode)
  assert.match(srcdoc, /data-openpencil-bridge/)
  assert.match(srcdoc, /data-openpencil-html-board-js/)
  assert.match(srcdoc, /action\.textContent = 'Started'/)
  assert.match(srcdoc, /open-pencil-renderer/)
  assert.match(srcdoc, /TRUSTED_COMPONENT_ROUTE/)
  const phoneCss = workspace.htmlBoardCssWithStyleOverride(
    css,
    '#content > h1',
    { display: 'block', 'font-size': '48px', gap: 'normal', padding: '0px' },
    'phone'
  )
  assert.match(phoneCss, /@media \(max-width: 600px\)/)
  assert.match(phoneCss, /#content > h1/)
  assert.match(phoneCss, /font-size: 48px/)
  const tokenCss = workspace.htmlBoardCssWithTokenOverride(
    ':root { --op-accent: #3159d9; }',
    '--op-accent',
    '#7357ff'
  )
  assert.equal(workspace.htmlBoardCssTokens(tokenCss).at(-1)?.value, '#7357ff')
  const labelHtml = workspace.htmlBoardHtmlWithComponentProp(
    html,
    'PrimaryAction',
    'label',
    'Continue'
  )
  assert.match(labelHtml, /data-openpencil-prop-label="Continue"/)
  assert.match(labelHtml, />Continue<\/button>/)
  const toneHtml = workspace.htmlBoardHtmlWithComponentProp(
    html,
    'PrimaryAction',
    'tone',
    'soft'
  )
  assert.match(toneHtml, /data-openpencil-prop-tone="soft"/)
  assert.match(toneHtml, /data-tone="soft"/)
  assert.equal(
    workspace.htmlBoardHtmlWithComponentProp(`${html}${html}`, 'PrimaryAction', 'label', 'Nope'),
    `${html}${html}`
  )
  const duplicatedActions = `${html}${html.replaceAll('primary-action-1', 'primary-action-2')}`
  const targetedAction = workspace.htmlBoardHtmlWithComponentProp(
    duplicatedActions,
    'PrimaryAction',
    'label',
    'Second action',
    'primary-action-2'
  )
  assert.equal(targetedAction.match(/>Second action<\/button>/g)?.length, 1)
  assert.equal(targetedAction.match(/>Start here<\/button>/g)?.length, 1)

  const withTextLink = workspace.htmlBoardHtmlWithSlotComponent(
    html,
    'hero-actions',
    'text-link'
  )
  assert.match(withTextLink, /data-openpencil-component="TextLink"/)
  assert.match(withTextLink, /data-openpencil-component-id="text-link-1"/)
  assert.match(withTextLink, />Learn more<\/a>/)
  const withSecondTextLink = workspace.htmlBoardHtmlWithSlotComponent(
    withTextLink,
    'hero-actions',
    'text-link'
  )
  assert.match(withSecondTextLink, /data-openpencil-component-id="text-link-2"/)
  assert.equal(
    workspace.htmlBoardHtmlWithSlotComponent(`${html}${html}`, 'hero-actions', 'text-link'),
    `${html}${html}`
  )
  const textOnlySlot = html.replace('ActionButton,TextLink', 'TextLink')
  assert.equal(
    workspace.htmlBoardHtmlWithSlotComponent(textOnlySlot, 'hero-actions', 'action-button'),
    textOnlySlot
  )
  const cssWithTextLink = workspace.htmlBoardCssWithRegisteredComponent(css, 'text-link')
  assert.match(cssWithTextLink, /openpencil-component:text-link/)
  assert.equal(
    workspace.htmlBoardCssWithRegisteredComponent(cssWithTextLink, 'text-link'),
    cssWithTextLink
  )

  const withSmylrButton = workspace.htmlBoardHtmlWithSlotComponent(
    html,
    'hero-actions',
    'smylr-button-live'
  )
  assert.match(withSmylrButton, /data-openpencil-component="SmylrButton"/)
  assert.match(withSmylrButton, /data-openpencil-registry-id="smylr-button-live"/)
  assert.match(withSmylrButton, /data-openpencil-source-file="src\/components\/ui\/button\.tsx"/)
  assert.match(withSmylrButton, /data-openpencil-renderer-route="\/open-pencil-renderer\?component=button&amp;embed=1"/)
  const verifiedSources = componentSources.repositoryVerifiedHtmlBoardComponentSources(
    withSmylrButton,
    { boardId: 'source-board', revision: 4, schemaVersion: 6 }
  )
  assert.equal(verifiedSources.length, 1)
  assert.equal(verifiedSources[0].verification, 'repository-verified')
  assert.equal(verifiedSources[0].filePath, 'src/components/ui/button.tsx')
  assert.equal(
    componentSources.repositoryVerifiedHtmlBoardComponentSources(
      withSmylrButton.replace('src/components/ui/button.tsx', 'src/components/ui/forged.tsx'),
      { boardId: 'source-board', revision: 4, schemaVersion: 6 }
    ).length,
    0
  )

  const catalogInsertions = [
    ['hero-content', 'smylr-accordion-live'],
    ['hero-content', 'smylr-alert-live'],
    ['navigation-status', 'smylr-avatar-live'],
    ['navigation-status', 'smylr-badge-live'],
    ['hero-actions', 'smylr-button-live'],
    ['hero-content', 'smylr-calendar-live'],
    ['hero-content', 'smylr-card-live'],
    ['hero-actions', 'smylr-checkbox-live'],
    ['navigation-status', 'smylr-dropdown-menu-live'],
    ['hero-actions', 'smylr-input-live'],
    ['hero-content', 'smylr-progress-live'],
    ['hero-actions', 'smylr-radio-group-live'],
    ['hero-actions', 'smylr-select-live'],
    ['hero-content', 'smylr-separator-live'],
    ['hero-actions', 'smylr-slider-live'],
    ['hero-actions', 'smylr-switch-live'],
    ['hero-content', 'smylr-table-live'],
    ['hero-actions', 'smylr-textarea-live'],
    ['hero-content', 'smylr-tabs-live'],
    ['hero-content', 'smylr-tooltip-live']
  ]
  let withSmylrCatalog = html
  for (const [slotName, componentId] of catalogInsertions) {
    const next = workspace.htmlBoardHtmlWithSlotComponent(
      withSmylrCatalog,
      slotName,
      componentId
    )
    assert.notEqual(next, withSmylrCatalog)
    withSmylrCatalog = next
  }
  const registeredLiveComponents = components
    .htmlBoardRegisteredComponents()
    .filter((component) => component.source?.verification === 'repository-verified')
  assert.equal(registeredLiveComponents.length, 20)
  assert.deepEqual(
    components.htmlBoardRegisteredLiveComponentRoutes(),
    catalogInsertions.map(
      ([, componentId]) =>
        components.htmlBoardRegisteredComponentById(componentId).source.route
    )
  )
  assert.equal(
    components.htmlBoardRegisteredLiveComponentByRoute(
      '/open-pencil-renderer?component=forged&embed=1'
    ),
    null
  )
  const catalogSources = componentSources.repositoryVerifiedHtmlBoardComponentSources(
    withSmylrCatalog,
    { boardId: 'catalog-board', revision: 8, schemaVersion: 6 }
  )
  assert.equal(catalogSources.length, 20)
  assert.deepEqual(
    new Set(catalogSources.map((binding) => binding.filePath)),
    new Set([
      'src/components/ui/accordion.tsx',
      'src/components/ui/alert.tsx',
      'src/components/ui/avatar.tsx',
      'src/components/ui/badge.tsx',
      'src/components/ui/button.tsx',
      'src/components/ui/calendar.tsx',
      'src/components/ui/card.tsx',
      'src/components/ui/checkbox.tsx',
      'src/components/ui/dropdown-menu.tsx',
      'src/components/ui/input.tsx',
      'src/components/ui/progress.tsx',
      'src/components/ui/radio-group.tsx',
      'src/components/ui/select.tsx',
      'src/components/ui/separator.tsx',
      'src/components/ui/slider.tsx',
      'src/components/ui/switch.tsx',
      'src/components/ui/table.tsx',
      'src/components/ui/tabs.tsx',
      'src/components/ui/textarea.tsx',
      'src/components/ui/tooltip.tsx'
    ])
  )

  const artifactMetadata = {
    artifactId: 'checkout-flow',
    diagramType: 'flowchart',
    editingModel: 'mermaid-source',
    kind: 'mermaid-diagram',
    renderFormat: 'svg',
    renderer: '@mermaid-js/mermaid-cli',
    source: 'flowchart LR\nA --> B',
    sourceHash: '7c4b156782f8d1bfe34a247d8bf39f7c8eb93490c7ac2e2b26da85b765ddb12a',
    title: 'Checkout flow'
  }
  const artifactHtml = `${html}\n<script type="application/vnd.openpencil.mermaid+json" data-openpencil-artifact>${JSON.stringify(artifactMetadata)}</script>`
  assert.deepEqual(workspace.htmlBoardArtifactMetadata(artifactHtml), artifactMetadata)
  assert.equal(workspace.htmlBoardArtifactMetadata('<main>No artifact</main>'), null)
  const artifactDocument = {
    artifact: artifactMetadata,
    css: '',
    format: 'html',
    html: artifactHtml,
    js: '',
    label: 'Created diagram artifact',
    revision: 1,
    revisions: [],
    runtime: 'sandboxed-browser',
    schemaVersion: 4,
    viewport: { height: 900, width: 1440 },
    workflow: {
      changeSet: null,
      name: 'Production',
      origin: null,
      relation: 'root',
      review: null,
      status: 'production'
    }
  }
  let liveArtifactNode = {
    height: 900,
    id: 'artifact-board-stable',
    name: 'Checkout flow',
    pluginData: [
      { key: 'kind', pluginId: 'openpencil-html-board', value: 'html-board' },
      {
        key: 'document',
        pluginId: 'openpencil-html-board',
        value: JSON.stringify(artifactDocument)
      }
    ],
    type: 'FRAME',
    width: 1440
  }
  const selectedArtifactIds = []
  const artifactStore = {
    graph: {
      getChildren: () => [liveArtifactNode],
      getNode: () => liveArtifactNode
    },
    requestRender() {},
    select(ids) {
      selectedArtifactIds.splice(0, selectedArtifactIds.length, ...ids)
    },
    state: { currentPageId: 'page', selectedIds: new Set() },
    updateNodeWithUndo(_id, changes) {
      liveArtifactNode = { ...liveArtifactNode, ...changes }
    }
  }
  const regeneratedMetadata = {
    ...artifactMetadata,
    source: 'flowchart LR\nA --> C',
    sourceHash: 'regenerated-source-hash'
  }
  const regeneratedHtml = `${html}\n<script type="application/vnd.openpencil.mermaid+json" data-openpencil-artifact>${JSON.stringify(regeneratedMetadata)}</script>`
  const regeneratedBoard = workspace.createHtmlBoardFrame(
    artifactStore,
    regeneratedHtml,
    '',
    ''
  )
  assert.equal(regeneratedBoard.id, 'artifact-board-stable')
  assert.deepEqual(selectedArtifactIds, ['artifact-board-stable'])
  assert.equal(workspace.htmlBoardDocument(liveArtifactNode).revision, 2)
  assert.equal(
    workspace.htmlBoardDocument(liveArtifactNode).artifact.sourceHash,
    'regenerated-source-hash'
  )
  const handoff = workspace.htmlBoardHandoff(liveNode)
  assert.deepEqual(handoff.board, {
    id: node.id,
    name: undefined,
    revision: 2,
    schemaVersion: 6,
    viewport: { height: 900, width: 1440 }
  })
  assert.equal(handoff.receipt.sourceApplicationStatus, 'not-applied')
  assert.equal(handoff.receipt.sourceUnchanged, true)

  const legacyV5Document = {
    ...migrated,
    schemaVersion: 5,
    workflow: {
      ...migrated.workflow,
      changeSet: {
        acceptanceCriteria: ['Preserve the selected HTML revision'],
        evidence: null,
        id: 'legacy-change-set',
        source: { boardId: 'legacy-v5-board', revision: 1, schemaVersion: 5 },
        sourceApplicationStatus: 'not-applied',
        sourceUnchanged: true,
        status: 'proposed'
      },
      status: 'change-set'
    }
  }
  const migratedV5 = workspace.htmlBoardDocument({
    ...node,
    id: 'legacy-v5-board',
    pluginData: [
      { key: 'kind', pluginId: 'openpencil-html-board', value: 'html-board' },
      {
        key: 'document',
        pluginId: 'openpencil-html-board',
        value: JSON.stringify(legacyV5Document)
      }
    ]
  })
  assert.equal(migratedV5.schemaVersion, 6)
  assert.deepEqual(migratedV5.workflow.changeSet.sourceTargets, [])

  function createTestStore() {
    const graph = new SceneGraph()
    const undo = new UndoManager()
    const state = {
      currentPageId: graph.getPages()[0].id,
      selectedIds: new Set()
    }
    return {
      graph,
      requestRender() {},
      select(ids) {
        state.selectedIds = new Set(ids)
      },
      state,
      undo,
      updateNodeWithUndo(id, changes, label = 'Update') {
        const target = graph.getNode(id)
        assert.ok(target)
        const previous = Object.fromEntries(
          Object.keys(changes).map((key) => [key, structuredClone(target[key])])
        )
        graph.updateNode(id, structuredClone(changes))
        undo.push({
          label,
          forward: () => graph.updateNode(id, structuredClone(changes)),
          inverse: () => graph.updateNode(id, structuredClone(previous))
        })
      },
      zoomToSelection() {}
    }
  }

  const decisionStore = createTestStore()
  const productionBoard = workspace.createHtmlBoardFrame(decisionStore, html, css, js)
  assert.equal(workspace.htmlBoardWorkflow(productionBoard).status, 'production')
  assert.equal(
    workspace.updateHtmlBoardFrame(
      decisionStore,
      productionBoard.id,
      `${html}<p>Direct production mutation</p>`,
      css,
      js
    ),
    false
  )
  const draftBoard = workspace.createHtmlBoardBranch(decisionStore, productionBoard.id)
  assert.ok(draftBoard)
  assert.equal(workspace.htmlBoardWorkflow(draftBoard).status, 'draft')
  assert.equal(
    workspace.updateHtmlBoardComponentProp(
      decisionStore,
      draftBoard.id,
      'PrimaryAction',
      'label',
      'Continue'
    ),
    true
  )
  assert.equal(workspace.htmlBoardDocument(draftBoard).revision, 2)
  assert.match(workspace.htmlBoardDocument(draftBoard).html, />Continue<\/button>/)
  assert.equal(decisionStore.undo.undo(), 'Update PrimaryAction label')
  assert.equal(workspace.htmlBoardDocument(draftBoard).revision, 1)
  assert.equal(decisionStore.undo.redo(), 'Update PrimaryAction label')
  assert.equal(workspace.htmlBoardDocument(draftBoard).revision, 2)
  assert.equal(
    workspace.insertHtmlBoardRegisteredComponent(
      decisionStore,
      draftBoard.id,
      'hero-actions',
      'text-link'
    ),
    true
  )
  assert.equal(workspace.htmlBoardDocument(draftBoard).revision, 3)
  assert.match(workspace.htmlBoardDocument(draftBoard).html, />Learn more<\/a>/)
  assert.match(workspace.htmlBoardDocument(draftBoard).css, /openpencil-component:text-link/)
  assert.equal(decisionStore.undo.undo(), 'Add Text link to hero-actions')
  assert.equal(workspace.htmlBoardDocument(draftBoard).revision, 2)
  assert.equal(decisionStore.undo.redo(), 'Add Text link to hero-actions')
  assert.equal(workspace.htmlBoardDocument(draftBoard).revision, 3)
  assert.equal(workspace.requestHtmlBoardReview(decisionStore, draftBoard.id), true)
  const reviewRevision = workspace.htmlBoardDocument(draftBoard).revision
  assert.equal(workspace.addHtmlBoardComment(decisionStore, draftBoard.id, 'Tighten the hero spacing'), true)
  assert.equal(workspace.htmlBoardDocument(draftBoard).revision, reviewRevision)
  assert.deepEqual(workspace.htmlBoardComments(draftBoard)[0].attachedTo, {
    boardId: draftBoard.id,
    revision: reviewRevision,
    schemaVersion: 6
  })
  assert.equal(
    decisionStore.graph
      .getChildren(decisionStore.state.currentPageId)
      .filter((candidate) => candidate.name === `Comment on r${reviewRevision}`).length,
    1
  )
  assert.equal(decisionStore.undo.undo(), 'Comment on HTML board revision')
  assert.equal(workspace.htmlBoardComments(draftBoard).length, 0)
  assert.equal(decisionStore.undo.redo(), 'Comment on HTML board revision')
  assert.equal(workspace.htmlBoardComments(draftBoard).length, 1)

  assert.equal(workspace.markHtmlBoardPreferred(decisionStore, draftBoard.id), true)
  const preferredRef = workspace.htmlBoardRevisionRef(draftBoard)
  assert.equal(workspace.htmlBoardWorkflow(draftBoard).status, 'preferred')
  assert.equal(
    workspace.createHtmlBoardChangeSet(decisionStore, draftBoard.id, [
      'Visual hierarchy matches the Preferred revision'
    ]),
    false
  )
  const sourceBindingInput = {
    filePath: 'src/components/LandingPage.tsx',
    kind: 'component',
    repository: 'Smylr-Elite',
    route: '/',
    selector: '[data-openpencil-component="LandingPage"]',
    symbol: 'LandingPage'
  }
  assert.equal(
    workspace.upsertHtmlBoardSourceBinding(decisionStore, draftBoard.id, {
      ...sourceBindingInput,
      filePath: '../escape.tsx'
    }),
    false
  )
  assert.equal(
    workspace.upsertHtmlBoardSourceBinding(decisionStore, draftBoard.id, {
      ...sourceBindingInput,
      filePath: '/absolute/path.tsx'
    }),
    false
  )
  const revisionBeforeSourceBinding = workspace.htmlBoardDocument(draftBoard).revision
  assert.equal(
    workspace.upsertHtmlBoardSourceBinding(decisionStore, draftBoard.id, sourceBindingInput),
    true
  )
  assert.equal(workspace.htmlBoardDocument(draftBoard).revision, revisionBeforeSourceBinding)
  assert.equal(workspace.htmlBoardSourceBindingsForCurrentRevision(draftBoard).length, 1)
  assert.equal(
    workspace.htmlBoardSourceBindingsForCurrentRevision(draftBoard)[0].verification,
    'declared'
  )
  assert.equal(
    workspace.upsertHtmlBoardSourceBinding(decisionStore, draftBoard.id, sourceBindingInput),
    false
  )
  assert.equal(decisionStore.undo.undo(), 'Map HTML board source target')
  assert.equal(workspace.htmlBoardSourceBindingsForCurrentRevision(draftBoard).length, 0)
  assert.equal(decisionStore.undo.redo(), 'Map HTML board source target')
  assert.equal(workspace.htmlBoardSourceBindingsForCurrentRevision(draftBoard).length, 1)
  assert.equal(
    workspace.createHtmlBoardChangeSet(decisionStore, draftBoard.id, [
      'Visual hierarchy matches the Preferred revision',
      'Responsive states remain usable',
      'Focused interaction tests pass'
    ]),
    true
  )
  let decisionDocument = workspace.htmlBoardDocument(draftBoard)
  assert.equal(decisionDocument.workflow.status, 'change-set')
  assert.deepEqual(decisionDocument.workflow.changeSet.source, preferredRef)
  assert.equal(decisionDocument.workflow.changeSet.sourceTargets.length, 1)
  assert.deepEqual(decisionDocument.workflow.changeSet.sourceTargets[0].attachedTo, preferredRef)
  assert.equal(
    decisionDocument.workflow.changeSet.sourceTargets[0].filePath,
    sourceBindingInput.filePath
  )
  assert.equal(decisionDocument.workflow.changeSet.sourceUnchanged, true)
  assert.equal(workspace.htmlBoardImplementationRequest(draftBoard).ok, false)
  assert.equal(
    workspace.updateHtmlBoardFrame(
      decisionStore,
      draftBoard.id,
      `${html}<p>Mutation after decision</p>`,
      css,
      js
    ),
    false
  )
  assert.equal(workspace.approveHtmlBoardChangeSet(decisionStore, draftBoard.id), true)
  assert.equal(workspace.checkHtmlBoardChangeSetReadiness(draftBoard).ok, true)
  assert.equal(workspace.htmlBoardImplementationRequest(draftBoard).ok, false)
  assert.equal(workspace.markHtmlBoardChangeSetWorkspaceChecked(decisionStore, draftBoard.id), true)
  const implementationRequest = workspace.htmlBoardImplementationRequest(draftBoard)
  assert.equal(implementationRequest.ok, true)
  assert.equal(implementationRequest.request.kind, 'openpencil-html-implementation-request')
  assert.equal(implementationRequest.request.board.revision, preferredRef.revision)
  assert.equal(implementationRequest.request.targets.length, 1)
  assert.equal(implementationRequest.request.targets[0].filePath, sourceBindingInput.filePath)
  assert.equal(implementationRequest.request.authorization.explicitRequired, true)
  assert.equal(implementationRequest.request.authorization.visibleDiffRequired, true)
  assert.equal(implementationRequest.request.receipt.sourceUnchanged, true)
  assert.equal(implementationRequest.request.receipt.sourceApplicationStatus, 'not-applied')
  assert.equal(
    workspace.verifyHtmlBoardChangeSet(decisionStore, draftBoard.id, {
      realAppVerified: true,
      sourcePatchId: 'patch-html-board-r3',
      testCommand: 'focused-html-board-check',
      testPassed: true,
      verifiedBy: 'runtime-bridge-check'
    }),
    true
  )
  decisionDocument = workspace.htmlBoardDocument(draftBoard)
  assert.equal(decisionDocument.workflow.status, 'verified')
  assert.equal(decisionDocument.workflow.changeSet.status, 'source-verified')
  assert.equal(workspace.htmlBoardHandoff(draftBoard).receipt.sourceUnchanged, false)
  assert.equal(workspace.htmlBoardHandoff(draftBoard).receipt.sourceApplicationStatus, 'verified')
  assert.equal(decisionStore.undo.undo(), 'Verify HTML change set')
  assert.equal(workspace.htmlBoardWorkflow(draftBoard).changeSet.status, 'workspace-checked')
  assert.equal(decisionStore.undo.redo(), 'Verify HTML change set')
  assert.equal(workspace.htmlBoardWorkflow(draftBoard).status, 'verified')

  const harness = `<!doctype html>
    <html>
      <head>
        <meta charset="utf-8">
        <style>
          * { box-sizing: border-box; }
          body { margin: 0; background: #111215; color: #f7f7f8; font-family: Inter, system-ui, sans-serif; }
          header { height: 56px; display: flex; align-items: center; justify-content: space-between; padding: 0 24px; border-bottom: 1px solid #282a30; }
          header strong { font-size: 13px; }
          header span { color: #8f939d; font-size: 12px; }
          main { display: grid; grid-template-columns: minmax(0, 1fr) 304px; height: calc(100vh - 56px); }
          .canvas { display: grid; place-items: center; padding: 36px; background: radial-gradient(circle at 50% 35%, #24262c, #17181c 64%); }
          .board { width: 920px; max-width: 100%; }
          .toolbar { display: flex; align-items: center; justify-content: space-between; margin-bottom: 10px; font-size: 11px; color: #a8abb4; }
          .modes { display: flex; gap: 4px; }
          .modes span { padding: 4px 9px; border-radius: 999px; }
          .modes .active { background: #f6f7f9; color: #17181b; }
          iframe { display: block; width: 100%; aspect-ratio: 16 / 10; border: 0; border-radius: 14px; background: white; box-shadow: 0 24px 70px rgba(0,0,0,.35); }
          aside { border-left: 1px solid #282a30; background: #17181c; padding: 22px 20px; }
          aside h2 { margin: 0 0 6px; font-size: 13px; }
          aside .hint { margin: 0; color: #8f939d; font-size: 11px; line-height: 1.5; }
          #selection { margin-top: 24px; }
          #selection code { color: #8cabff; font-size: 12px; }
          #selection .selector { margin-top: 7px; color: #8f939d; font: 10px ui-monospace, monospace; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
          dl { display: grid; grid-template-columns: 1fr 1fr; gap: 16px 12px; margin: 20px 0 0; }
          dt { color: #6f737e; font-size: 9px; text-transform: uppercase; letter-spacing: .08em; }
          dd { margin: 4px 0 0; font-size: 11px; }
        </style>
      </head>
      <body>
        <header><strong>HTML board runtime check</strong><span>Production bridge · sandboxed</span></header>
        <main>
          <section class="canvas">
            <div class="board">
              <div class="toolbar"><span>HTML Board · 1440 × 900</span><div class="modes"><span>Design</span><span class="active">Inspect</span><span>Interact</span></div></div>
              <iframe id="board" name="openpencil-inspect" sandbox="allow-scripts"></iframe>
            </div>
          </section>
          <aside>
            <h2>HTML design source</h2>
            <p class="hint">Click the real DOM. OpenPencil receives element identity and computed styles without same-origin access.</p>
            <div id="selection"><span class="hint">Waiting for an element…</span></div>
          </aside>
        </main>
        <script>
          const runtimeSrcdoc = ${JSON.stringify(srcdoc).replaceAll('<', '\\u003c')}
          window.__bridgeReady = false
          window.__selection = null
          const board = document.querySelector('#board')
          window.addEventListener('message', (event) => {
            if (event.source !== board.contentWindow || event.data?.kind !== 'OPENPENCIL_HTML_BOARD_V1') return
            if (event.data.action === 'ready') {
              window.__bridgeReady = true
              board.contentWindow.postMessage({ action: 'set-mode', kind: 'OPENPENCIL_HTML_BOARD_V1', mode: 'inspect' }, '*')
            }
            if (event.data.action === 'selection') {
              window.__selection = event.data.payload
              const payload = event.data.payload
              document.querySelector('#selection').innerHTML =
                '<code>&lt;' + payload.tagName + '&gt;</code>' +
                '<div class="selector">' + payload.selector + '</div>' +
                '<dl><div><dt>Layout</dt><dd>' + payload.styles.display + ' · ' + payload.styles.position + '</dd></div>' +
                '<div><dt>Size</dt><dd>' + Math.round(payload.rect.width) + ' × ' + Math.round(payload.rect.height) + '</dd></div>' +
                '<div><dt>Spacing</dt><dd>' + payload.styles.padding + '</dd></div>' +
                '<div><dt>Type</dt><dd>' + payload.styles['font-size'] + ' / ' + payload.styles['font-weight'] + '</dd></div></dl>'
            }
          })
          board.srcdoc = runtimeSrcdoc
        </script>
      </body>
    </html>`
  await writeFile(`${OUTPUT_ROOT}/runtime-bridge-harness.html`, harness, 'utf8')
  console.log(
    JSON.stringify(
      {
        generated: `${OUTPUT_ROOT}/runtime-bridge-harness.html`,
        hasProductionBridge: srcdoc.includes('data-openpencil-bridge'),
        javascript: 'canonical sandboxed JS injected',
        artifactIdentity:
          'Mermaid metadata parsed without execution; regeneration preserved board ID and advanced revision',
        decisions:
          'typed component props, controlled slots, trusted live-component overlay contract, repository evidence, forged-source refusal, stable component instances, exact-revision comment, Preferred, source mapping, proposal, approval, workspace check, implementation request, source verification, receipts, and undo/redo verified',
        revisions: 'schema v1 and v5 migrated to v6; revisions 1 and 2 resolved',
        sandbox: 'allow-scripts (no same-origin)',
        styleOverride: 'phone scoped CSS and token override verified',
        viewport: document.viewport
      },
      null,
      2
    )
  )
} finally {
  await vite.close()
}
