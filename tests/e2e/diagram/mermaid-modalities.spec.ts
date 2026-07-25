import type { Page } from '@playwright/test'
import { wcagContrast } from 'culori'

import type { SceneNode } from '@open-pencil/scene-graph'

import { expect, test } from '#tests/e2e/fixtures'
import { CanvasHelper } from '#tests/helpers/canvas'

interface MermaidModality {
  expectedText: string[]
  id: string
  source: string
}

const MERMAID_MODALITIES: MermaidModality[] = [
  {
    expectedText: ['New idea', 'Build prototype', 'Ready to test?', 'User testing', 'Ship'],
    id: 'flowchart',
    source: `flowchart LR
  A[New idea] --> B[Build prototype]
  B --> C{Ready to test?}
  C -->|Yes| D[User testing]
  C -->|No| B
  D --> E[Ship]`
  },
  {
    expectedText: ['User', 'App', 'Database', 'Save note', 'Write record', 'Saved', 'Confirmed'],
    id: 'sequence',
    source: `sequenceDiagram
  participant U as User
  participant A as App
  participant D as Database
  U->>A: Save note
  A->>D: Write record
  D-->>A: Saved
  A-->>U: Confirmed`
  },
  {
    expectedText: ['User', '+String name', '+login()', 'Board', '+String title', '+open()', 'owns'],
    id: 'class',
    source: `classDiagram
  class User {
    +String name
    +login()
  }
  class Board {
    +String title
    +open()
  }
  User "1" --> "many" Board : owns`
  },
  {
    expectedText: ['Draft', 'Review', 'Published', 'submit', 'approve', 'revise'],
    id: 'state',
    source: `stateDiagram-v2
  [*] --> Draft
  Draft --> Review : submit
  Review --> Published : approve
  Review --> Draft : revise
  Published --> [*]`
  },
  {
    expectedText: ['USER', 'BOARD', 'CARD', 'owns', 'contains', 'string', 'name', 'title', 'text'],
    id: 'entity-relationship',
    source: `erDiagram
  USER ||--o{ BOARD : owns
  BOARD ||--o{ CARD : contains
  USER {
    string id
    string name
  }
  BOARD {
    string id
    string title
  }
  CARD {
    string id
    string text
  }`
  },
  {
    expectedText: [
      'Onboarding',
      'Discover',
      'Start',
      'Visit site',
      'Compare plans',
      'Create account',
      'Finish setup',
      'User'
    ],
    id: 'user-journey',
    source: `journey
  title Onboarding
  section Discover
    Visit site: 5: User
    Compare plans: 4: User
  section Start
    Create account: 3: User
    Finish setup: 5: User`
  },
  {
    expectedText: ['Release plan', 'Design', 'Build', 'Prototype', 'Validate', 'Implement', 'Ship'],
    id: 'gantt',
    source: `gantt
  title Release plan
  dateFormat YYYY-MM-DD
  axisFormat %b %d
  tickInterval 3day
  section Design
    Prototype :done, d1, 2026-07-01, 3d
    Validate :active, d2, after d1, 4d
  section Build
    Implement :d3, after d2, 5d
    Ship :milestone, after d3, 0d`
  },
  {
    expectedText: ['Product usage', 'Core editor [48]', 'Collaboration [27]', 'Automation [15]'],
    id: 'pie',
    source: `pie showData
  title Product usage
  "Core editor" : 48
  "Collaboration" : 27
  "Automation" : 15
  "Other" : 10`
  },
  {
    expectedText: [
      'Feature priorities',
      'Quick wins',
      'Strategic',
      'Avoid',
      'Explore',
      'Live collaboration',
      'Theme polish',
      '3D import',
      'Legacy cleanup'
    ],
    id: 'quadrant',
    source: `quadrantChart
  title Feature priorities
  x-axis Low effort --> High effort
  y-axis Low impact --> High impact
  quadrant-1 Strategic
  quadrant-2 Quick wins
  quadrant-3 Avoid
  quadrant-4 Explore
  "Live collaboration": [0.35, 0.85]
  "Theme polish": [0.25, 0.55]
  "3D import": [0.75, 0.65]
  "Legacy cleanup": [0.70, 0.25]`
  },
  {
    expectedText: [
      '<<Requirement>>',
      'secure_login',
      'ID: REQ-1',
      'Users authenticate securely',
      '<<Element>>',
      'app'
    ],
    id: 'requirement',
    source: `requirementDiagram
  direction LR
  requirement secure_login {
    id: "REQ-1"
    text: Users authenticate securely
    risk: high
    verifymethod: test
  }
  element app {
    type: application
    docref: "src/auth.ts"
  }
  app - satisfies -> secure_login`
  },
  {
    expectedText: ['main', 'feature', 'Start', 'Build', 'Merge', 'Ship'],
    id: 'git-graph',
    source: `gitGraph LR:
  commit id: "Start"
  branch feature
  checkout feature
  commit id: "Build"
  checkout main
  merge feature id: "Merge"
  commit id: "Ship"`
  },
  {
    expectedText: [
      'Product context',
      'Designer',
      'OpenPencil',
      'External API',
      'Creates and edits',
      'Fetches data'
    ],
    id: 'c4',
    source: `C4Context
  title Product context
  Person(user, "Designer", "Creates boards")
  System(app, "OpenPencil", "Spatial design editor")
  System_Ext(api, "External API", "Provides data")
  Rel(user, app, "Creates and edits")
  Rel(app, api, "Fetches data")`
  },
  {
    expectedText: [
      'Product launch',
      'Discover',
      'Interview users',
      'Define problem',
      'Build',
      'Prototype',
      'Test',
      'Ship',
      'Release',
      'Learn'
    ],
    id: 'mindmap',
    source: `mindmap
  root((Product launch))
    Discover
      Interview users
      Define problem
    Build
      Prototype
      Test
    Ship
      Release
      Learn`
  },
  {
    expectedText: [
      'Product launch',
      '2026-07-01',
      'Research',
      'Interviews',
      'Prototype',
      'Beta',
      'Launch'
    ],
    id: 'timeline',
    source: `timeline
  title Product launch
  2026-07-01 : Research
             : Interviews
  2026-07-08 : Prototype
  2026-07-15 : Beta
  2026-07-22 : Launch`
  },
  {
    expectedText: [
      'Paid ads 120',
      'Organic search 90',
      'Website visits 210',
      'Product demo 160',
      'Paid plan 70',
      'Trial 90'
    ],
    id: 'sankey',
    source: `---
config:
  sankey:
    linkColor: source
    showValues: true
---
sankey-beta
Paid ads,Website visits,120
Organic search,Website visits,90
Website visits,Product demo,160
Website visits,Bounced,50
Product demo,Paid plan,70
Product demo,Trial,90`
  },
  {
    expectedText: ['Weekly signups', 'Signups', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'],
    id: 'xy-chart',
    source: `xychart
  title "Weekly signups"
  x-axis [Mon, Tue, Wed, Thu, Fri, Sat, Sun]
  y-axis "Signups" 0 --> 100
  bar [20, 35, 48, 62, 80, 70, 92]
  line [15, 30, 45, 60, 72, 78, 90]`
  },
  {
    expectedText: ['Client', 'API', 'Auth', 'Database', 'Cache'],
    id: 'block',
    source: `block
  columns 3
  client["Client"] space api["API"]
  space:3
  auth["Auth"] db[("Database")] cache[("Cache")]
  client --> api
  api --> auth
  api --> db
  api --> cache`
  },
  {
    expectedText: [
      'TCP Header',
      'Source Port',
      'Destination Port',
      'Sequence Number',
      'Acknowledgment Number',
      'Flags',
      'Window'
    ],
    id: 'packet',
    source: `packet
  title TCP Header
  0-15: "Source Port"
  16-31: "Destination Port"
  32-63: "Sequence Number"
  64-95: "Acknowledgment Number"
  96-111: "Flags"
  112-127: "Window"`
  },
  {
    expectedText: ['Product API', 'Client', 'Server', 'Database', 'Cache'],
    id: 'architecture',
    source: `architecture-beta
  group api(cloud)[Product API]
  service client(internet)[Client] in api
  service server(server)[Server] in api
  service db(database)[Database] in api
  service cache(disk)[Cache] in api
  client:R --> L:server
  server:R --> L:db
  server:B --> T:cache`
  },
  {
    expectedText: [
      'Backlog',
      'Collect feedback',
      'Prioritize ideas',
      'In progress',
      'Build prototype',
      'Test interactions',
      'Done',
      'Ship update'
    ],
    id: 'kanban',
    source: `kanban
  backlog[Backlog]
    task1[Collect feedback]
    task2[Prioritize ideas]
  active[In progress]
    task3[Build prototype]
    task4[Test interactions]
  done[Done]
    task5[Ship update]`
  },
  {
    expectedText: [
      'Product',
      'Editor',
      '42',
      'Collaboration',
      '24',
      'Automation',
      '18',
      'Import and export',
      '16'
    ],
    id: 'treemap',
    source: `treemap-beta
  "Product"
    "Editor": 42
    "Collaboration": 24
    "Automation": 18
    "Import and export": 16`
  },
  {
    expectedText: [
      'Product quality',
      'Speed',
      'Clarity',
      'Depth',
      'Trust',
      'Polish',
      'Current',
      'Target'
    ],
    id: 'radar',
    source: `radar-beta
  title Product quality
  axis speed["Speed"], clarity["Clarity"], depth["Depth"], trust["Trust"], polish["Polish"]
  curve current["Current"]{72, 78, 86, 82, 74}
  curve target["Target"]{90, 92, 94, 95, 91}
  max 100
  min 0
  showLegend true`
  }
]

const APPEARANCES = ['dark', 'light'] as const
test.setTimeout(90_000)

async function openMermaidDialog(page: Page): Promise<void> {
  const menubar = page.locator('[role="menubar"]')
  if (!(await menubar.isVisible())) await page.getByTestId('app-menu-toggle').click()
  await page.getByTestId('menubar-insert').click()
  await page.getByRole('menuitem', { name: 'Mermaid diagram…', exact: true }).click()
  await expect(page.getByTestId('mermaid-import-dialog')).toBeVisible()
}

for (const appearance of APPEARANCES) {
  for (const modality of MERMAID_MODALITIES) {
    test(`renders and imports ${appearance} Mermaid ${modality.id}`, async ({ page }) => {
      await page.goto('/?test&no-rulers')
      const canvasHelper = new CanvasHelper(page)
      await canvasHelper.waitForInit()
      await canvasHelper.clearCanvas()
      await page.evaluate((nextAppearance) => {
        document.documentElement.dataset.theme = nextAppearance
        document.documentElement.style.colorScheme = nextAppearance
      }, appearance)
      await openMermaidDialog(page)
      await page.getByTestId('mermaid-source').fill(modality.source)

      await expect(page.getByTestId('mermaid-layer-count')).toContainText('editable layers', {
        timeout: 30_000
      })
      await expect(page.getByTestId('mermaid-preview-error')).toHaveCount(0)
      const preview = page.getByTestId('mermaid-preview')
      await expect(preview).toBeVisible({ timeout: 30_000 })
      await page.getByTestId('mermaid-preview-fit').click()
      await expect(preview).toHaveScreenshot(`${modality.id}-${appearance}.png`, {
        animations: 'disabled',
        timeout: 15_000
      })
      await page.getByTestId('mermaid-preview-readable').click()
      const readablePreview = await preview.evaluate((element) => {
        const svg = element as SVGSVGElement
        const text = svg.querySelector('foreignObject, text')
        const box = text?.getBoundingClientRect()
        const viewBox = svg.viewBox.baseVal
        const scale = svg.getBoundingClientRect().width / Math.max(1, viewBox.width)
        const fontSize = text ? Number.parseFloat(getComputedStyle(text).fontSize) : 0
        return { projectedFontSize: fontSize * scale, visibleHeight: box?.height ?? 0 }
      })
      expect(readablePreview.projectedFontSize).toBeGreaterThanOrEqual(10.5)
      expect(readablePreview.visibleHeight).toBeGreaterThan(0)
      const readableScroll = await page
        .getByTestId('mermaid-preview-scroll-content')
        .evaluate((content) => {
          const viewport = content.parentElement
          const diagram = content.querySelector('svg')
          if (!viewport || !diagram) return { leftClipped: true, rightReachable: false }
          const initialViewport = viewport.getBoundingClientRect()
          const initialDiagram = diagram.getBoundingClientRect()
          const leftClipped = initialDiagram.left < initialViewport.left - 1
          viewport.scrollLeft = viewport.scrollWidth
          const scrolledViewport = viewport.getBoundingClientRect()
          const scrolledDiagram = diagram.getBoundingClientRect()
          const rightReachable = scrolledDiagram.right <= scrolledViewport.right + 1
          viewport.scrollLeft = 0
          return { leftClipped, rightReachable }
        })
      expect(readableScroll.leftClipped).toBe(false)
      expect(readableScroll.rightReachable).toBe(true)

      await expect(page.getByTestId('mermaid-insert')).toBeEnabled({ timeout: 15_000 })
      await page.getByTestId('mermaid-insert').click()
      await expect(page.getByTestId('mermaid-import-dialog')).toHaveCount(0)
      await canvasHelper.waitForRender()

      const inserted = await page.evaluate(
        ({ expectedSource, expectedText }) => {
          const store = window.openPencil?.getStore?.()
          if (!store) throw new Error('OpenPencil store not initialized')
          const ownerId = [...store.state.selectedIds][0]
          const owner = ownerId ? store.graph.getNode(ownerId) : undefined
          const pieces: SceneNode[] = []
          const pending = [...(owner?.childIds ?? [])]
          while (pending.length > 0) {
            const id = pending.shift()
            const node = id ? store.graph.getNode(id) : undefined
            if (!node) continue
            pieces.push(node)
            pending.push(...node.childIds)
          }
          const textNodes = pieces.filter((node) => node.type === 'TEXT')
          const textValues = textNodes.map((node) => node.text)
          const sameColor = (
            left: { r: number; g: number; b: number },
            right: { r: number; g: number; b: number }
          ) =>
            Math.abs(left.r - right.r) < 0.01 &&
            Math.abs(left.g - right.g) < 0.01 &&
            Math.abs(left.b - right.b) < 0.01
          const containingBackground = (textNode: (typeof textNodes)[number]) => {
            const textPosition = store.graph.getAbsolutePosition(textNode.id)
            const centerX = textPosition.x + textNode.width / 2
            const centerY = textPosition.y + textNode.height / 2
            return pieces
              .filter((piece) => {
                const position = store.graph.getAbsolutePosition(piece.id)
                return (
                  (piece.type === 'ELLIPSE' ||
                    piece.type === 'RECTANGLE' ||
                    (piece.type === 'VECTOR' && Boolean(piece.vectorNetwork?.regions.length))) &&
                  piece.fills[0]?.type === 'SOLID' &&
                  piece.fills[0].visible &&
                  piece.fills[0].opacity >= 0.8 &&
                  piece.fills[0].color.a >= 0.8 &&
                  centerX >= position.x &&
                  centerX <= position.x + piece.width &&
                  centerY >= position.y &&
                  centerY <= position.y + piece.height
                )
              })
              .sort((left, right) => left.width * left.height - right.width * right.height)[0]
          }
          return {
            appearance: owner?.pluginData.find((entry) => entry.key === 'mermaid/appearance')
              ?.value,
            darkNeutralStandaloneTextCount: textNodes.filter((node) => {
              const fill = node.fills[0]
              if (fill?.type !== 'SOLID') return false
              const darkest = Math.min(fill.color.r, fill.color.g, fill.color.b)
              const lightest = Math.max(fill.color.r, fill.color.g, fill.color.b)
              return !containingBackground(node) && lightest <= 0.3 && lightest - darkest <= 0.08
            }).length,
            forcedDarkThemeStandaloneTextCount: textNodes.filter((node) => {
              const fill = node.fills[0]
              if (fill?.type !== 'SOLID') return false
              return (
                !containingBackground(node) &&
                Math.abs(fill.color.r - 244 / 255) < 0.01 &&
                Math.abs(fill.color.g - 245 / 255) < 0.01 &&
                Math.abs(fill.color.b - 247 / 255) < 0.01
              )
            }).length,
            geometryCount: pieces.filter((node) =>
              ['ELLIPSE', 'RECTANGLE', 'VECTOR'].includes(node.type)
            ).length,
            hasImageFill: pieces.some((node) => node.fills.some((fill) => fill.type === 'IMAGE')),
            height: owner?.height,
            containedTextColorPairs: textNodes.flatMap((textNode) => {
              const textFill = textNode.fills[0]
              const background = containingBackground(textNode)
              const backgroundFill = background?.fills[0]
              return textFill?.type === 'SOLID' && backgroundFill?.type === 'SOLID'
                ? [
                    {
                      background: backgroundFill.color,
                      backgroundName: background?.name,
                      backgroundOpacity: backgroundFill.opacity,
                      text: textFill.color,
                      textOpacity: textFill.opacity,
                      value: textNode.text
                    }
                  ]
                : []
            }),
            matchingBackgroundTextCount: textNodes.filter((textNode) => {
              const textFill = textNode.fills[0]
              if (textFill?.type !== 'SOLID') return false
              const textPosition = store.graph.getAbsolutePosition(textNode.id)
              const centerX = textPosition.x + textNode.width / 2
              const centerY = textPosition.y + textNode.height / 2
              return pieces.some((piece) => {
                if (!['ELLIPSE', 'RECTANGLE'].includes(piece.type)) return false
                const fill = piece.fills[0]
                const position = store.graph.getAbsolutePosition(piece.id)
                return (
                  fill?.type === 'SOLID' &&
                  centerX >= position.x &&
                  centerX <= position.x + piece.width &&
                  centerY >= position.y &&
                  centerY <= position.y + piece.height &&
                  sameColor(textFill.color, fill.color)
                )
              })
            }).length,
            minimumProjectedFontSize:
              Math.min(...textNodes.map((node) => node.fontSize)) * store.state.zoom,
            missingText: expectedText.filter(
              (expected) => !textValues.some((value) => value.includes(expected))
            ),
            ownerType: owner?.type,
            pieceCount: pieces.length,
            source: owner?.pluginData.find((entry) => entry.key === 'mermaid/source')?.value,
            textCount: textNodes.length,
            tightTextCount: textNodes.filter((node) => {
              const longestLine = Math.max(...node.text.split('\n').map((line) => line.length))
              return node.width < longestLine * node.fontSize * 0.4
            }).length,
            width: owner?.width,
            sourceMatches: owner?.pluginData
              .find((entry) => entry.key === 'mermaid/source')
              ?.value.includes(expectedSource.split('\n')[0] ?? '')
          }
        },
        { expectedSource: modality.source, expectedText: modality.expectedText }
      )

      expect(inserted.appearance).toBe(appearance)
      expect(inserted.ownerType).toBe('GROUP')
      expect(inserted.pieceCount).toBeGreaterThan(0)
      expect(inserted.textCount).toBeGreaterThan(0)
      expect(inserted.geometryCount).toBeGreaterThan(0)
      expect(inserted.missingText).toEqual([])
      expect(inserted.matchingBackgroundTextCount).toBe(0)
      expect(inserted.minimumProjectedFontSize).toBeGreaterThanOrEqual(10.5)
      expect(
        inserted.containedTextColorPairs.filter(
          (pair) =>
            wcagContrast({ mode: 'rgb', ...pair.text }, { mode: 'rgb', ...pair.background }) < 4.5
        )
      ).toEqual([])
      if (appearance === 'dark') {
        expect(inserted.darkNeutralStandaloneTextCount).toBe(0)
      } else {
        expect(inserted.forcedDarkThemeStandaloneTextCount).toBe(0)
      }
      expect(inserted.tightTextCount).toBe(0)
      expect(inserted.width).toBeGreaterThan(40)
      expect(inserted.height).toBeGreaterThan(40)
      expect(inserted.hasImageFill).toBe(false)
      expect(inserted.sourceMatches).toBe(true)
      expect(inserted.source).toBe(modality.source)

      if (['flowchart', 'gantt', 'mindmap'].includes(modality.id)) {
        const canvas = await canvasHelper.screenshotCanvas()
        expect(canvas).toMatchSnapshot(`native-${modality.id}-${appearance}.png`)
      }
    })
  }
}
