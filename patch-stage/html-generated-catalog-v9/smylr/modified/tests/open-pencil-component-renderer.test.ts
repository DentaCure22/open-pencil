import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

const assetsPanelSource = readFileSync(
  'archive/agent-tooling/open-pencil-base/src/components/AssetsPanel.vue',
  'utf8'
)
const catalogSource = readFileSync(
  'archive/agent-tooling/open-pencil-base/src/app/smylr-component-library/computed-catalog.ts',
  'utf8'
)
const rendererCatalog = JSON.parse(
  readFileSync(
    'archive/agent-tooling/open-pencil-base/src/app/smylr-component-library/renderer-catalog.generated.json',
    'utf8'
  )
) as {
  schemaVersion: number
  rendererVersion: string
  fixtures: Array<{
    fixtureId: string
    frameHeight: number
    frameWidth: number
    interactionHeight: number
    inventory: { layer: string; storyStatus: string; storyTitle: string }
    overlayHeight: number
    overlayWidth: number
    repository: string
    selector: string
    sourcePath: string
    symbol: string
  }>
}
const liveCanvasSource = readFileSync(
  'archive/agent-tooling/open-pencil-base/src/app/smylr-component-library/live-component-canvas.ts',
  'utf8'
)
const liveEmbedSource = readFileSync(
  'archive/agent-tooling/open-pencil-base/src/components/canvas/SmylrLiveAppEmbed.vue',
  'utf8'
)
const rendererSource = readFileSync(
  'src/components/runtime/smylr-open-pencil-component-renderer.tsx',
  'utf8'
)
const rendererUtilitiesSource = readFileSync(
  'src/styles/open-pencil-renderer-utilities.css',
  'utf8'
)
const packageJson = JSON.parse(readFileSync('package.json', 'utf8')) as {
  scripts: Record<string, string>
}

describe('Smylr internal OpenPencil component renderer', () => {
  it('keeps every computed component linked to a real renderer fixture and source export', () => {
    const fixtureBlock = rendererSource.match(
      /const FIXTURES = \{([\s\S]*?)\}\s+satisfies Record/
    )?.[1]

    expect(rendererCatalog.schemaVersion).toBe(1)
    expect(rendererCatalog.rendererVersion).toBe('6')
    expect(rendererCatalog.fixtures).toHaveLength(12)
    expect(fixtureBlock).toBeDefined()
    for (const fixture of rendererCatalog.fixtures) {
      expect(fixture.repository).toBe('Smylr-Elite')
      expect(fixture.symbol).not.toBe('')
      expect(fixture.selector).not.toBe('')
      expect(fixture.frameHeight).toBeGreaterThan(0)
      expect(fixture.frameWidth).toBeGreaterThan(0)
      expect(fixture.overlayHeight).toBeGreaterThan(0)
      expect(fixture.overlayWidth).toBeGreaterThan(0)
      expect(fixture.interactionHeight).toBeGreaterThanOrEqual(fixture.overlayHeight)
      expect(fixture.inventory.storyStatus).toBe('covered')
      expect(fixture.inventory.storyTitle).not.toBe('')
      expect(existsSync(fixture.sourcePath)).toBe(true)
      expect(fixtureBlock).toMatch(new RegExp(`\\b${fixture.fixtureId}:`))
      expect(rendererSource).toContain(
        `@/${fixture.sourcePath.replace(/^src\//, '').replace(/\.tsx$/, '')}`
      )
    }
    expect(rendererSource).toContain(
      'SMYLR_OPENPENCIL_COMPONENT_FIXTURE_IDS = rendererCatalog.fixtures.map'
    )
    expect(catalogSource).toContain("renderer-catalog.generated.json")
  })

  it('keeps the renderer catalog generated from current Component Atlas evidence', () => {
    expect(() =>
      execFileSync('node', ['scripts/generate-open-pencil-component-catalog.mjs', '--check'], {
        stdio: 'pipe',
      })
    ).not.toThrow()
    expect(packageJson.scripts['docs:open-pencil-component-catalog']).toBe(
      'node scripts/generate-open-pencil-component-catalog.mjs'
    )
  })

  it('opens assets as live same-origin Smylr canvases without Storybook or DOM conversion', () => {
    expect(liveCanvasSource).toContain("`/open-pencil-renderer?component=${encodeURIComponent(asset.fixtureId)}`")
    expect(liveCanvasSource).toContain("pluginData('kind', LIVE_APP_KIND)")
    expect(liveCanvasSource).toContain('The visible')
    expect(liveCanvasSource).toContain('component remains the real Smylr React/DOM tree')
    expect(assetsPanelSource).not.toContain('127.0.0.1:6006')
    expect(assetsPanelSource).not.toContain('iframe.html')
    expect(assetsPanelSource).not.toContain('pasteFromHTML')
    expect(assetsPanelSource).not.toContain('findSmylrComputedComponentAsset')
    expect(assetsPanelSource).toContain('ensureSmylrLiveComponentCanvas(editor, asset)')
    expect(assetsPanelSource).toContain("setLiveInspectorInteractionMode('interact')")
    expect(assetsPanelSource).toContain('{ settle: false }')
    expect(liveEmbedSource).toContain('isLiveComponentRuntime')
    expect(liveEmbedSource).toContain("? iframeSrc.value")
    expect(liveEmbedSource).toContain("data-runtime-kind")
    expect(catalogSource).not.toContain('storyId:')
    expect(packageJson.scripts.dev).toBe(packageJson.scripts['dev:app'])
    expect(packageJson.scripts['dev:with-storybook']).toBe('node scripts/dev-with-storybook.mjs')
  })

  it('mounts the real source primitives under the computed bridge root', () => {
    for (const source of [
      "@/components/ui/alert",
      "@/components/ui/badge",
      "@/components/ui/button",
      "@/components/ui/card",
      "@/components/ui/checkbox",
      "@/components/ui/input",
      "@/components/ui/progress",
      "@/components/ui/select",
      "@/components/ui/separator",
      "@/components/ui/switch",
      "@/components/ui/table",
      "@/components/ui/tabs",
    ]) {
      expect(rendererSource).toContain(source)
    }
    expect(rendererSource).toContain("data-smylr-component-renderer-root='true'")
    expect(rendererSource).toContain("data-smylr-component-renderer-embedded={embedded ? 'true' : 'false'}")
    expect(rendererSource).toContain("data-openpencil-embedded-fixture='button'")
    expect(rendererSource).toContain("{saved ? 'Saved' : 'Save changes'}")
    expect(rendererSource).toContain("'flex size-full items-start justify-start'")
    expect(rendererSource).toContain("'bg-transparent text-foreground h-screen w-screen overflow-visible")
    expect(rendererSource).toContain('<SmylrOpenPencilBridgeRuntime />')
    expect(liveCanvasSource).toContain('SMYLR_COMPUTED_ASSET_RENDERER_VERSION')
    expect(rendererUtilitiesSource).toContain("@import 'tailwindcss/utilities' source(none)")
    expect(rendererUtilitiesSource).toContain("@reference './globals.css'")
    for (const fixture of rendererCatalog.fixtures) {
      expect(rendererUtilitiesSource).toContain(`@source '../${fixture.sourcePath.replace(/^src\//, '')}'`)
    }
  })

  it('captures component leaf structure instead of container candidates only', () => {
    const bridgeSource = readFileSync(
      'src/components/runtime/smylr-open-pencil-bridge-runtime.tsx',
      'utf8'
    )
    expect(bridgeSource).toContain(
      "element.closest('[data-smylr-component-renderer-root=\"true\"]')"
    )
    expect(bridgeSource).toContain("attrs['data-smylr-vector-path'] = vectorPath")
    expect(bridgeSource).toContain("'stroke-linecap': style.getPropertyValue('stroke-linecap')")
  })
})
