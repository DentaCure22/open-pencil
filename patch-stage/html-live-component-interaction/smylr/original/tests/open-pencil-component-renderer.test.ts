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
    const assets = [...catalogSource.matchAll(
      /fixtureId: '([^']+)'[\s\S]*?repository: '([^']+)'[\s\S]*?sourcePath: '([^']+)'[\s\S]*?symbol: '([^']+)'/g
    )].map((match) => ({
      fixtureId: match[1],
      repository: match[2],
      sourcePath: match[3],
      symbol: match[4],
    }))
    const fixtureManifest = rendererSource.match(
      /SMYLR_OPENPENCIL_COMPONENT_FIXTURE_IDS\s*=\s*\[([\s\S]*?)\]\s*as const/
    )?.[1] ?? ''

    expect(assets).toHaveLength(8)
    for (const asset of assets) {
      expect(asset.repository).toBe('Smylr-Elite')
      expect(asset.symbol).not.toBe('')
      expect(existsSync(asset.sourcePath)).toBe(true)
      expect(fixtureManifest).toContain(`'${asset.fixtureId}'`)
      expect(rendererSource).toContain(`@/${asset.sourcePath.replace(/^src\//, '').replace(/\.tsx$/, '')}`)
    }
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
      "@/components/ui/badge",
      "@/components/ui/button",
      "@/components/ui/card",
      "@/components/ui/checkbox",
      "@/components/ui/select",
      "@/components/ui/separator",
      "@/components/ui/switch",
      "@/components/ui/table",
    ]) {
      expect(rendererSource).toContain(source)
    }
    expect(rendererSource).toContain("data-smylr-component-renderer-root='true'")
    expect(rendererSource).toContain("data-smylr-component-renderer-embedded={embedded ? 'true' : 'false'}")
    expect(rendererSource).toContain("data-smylr-openpencil-embedded-critical='true'")
    expect(rendererSource).toContain("data-openpencil-embedded-fixture='button'")
    expect(rendererSource).toContain('<SmylrOpenPencilBridgeRuntime />')
    expect(liveCanvasSource).toContain('SMYLR_COMPUTED_ASSET_RENDERER_VERSION')
    expect(rendererUtilitiesSource).toContain("@import 'tailwindcss/utilities' source(none)")
    expect(rendererUtilitiesSource).toContain("@reference './globals.css'")
    expect(rendererUtilitiesSource).toContain("@source '../components/ui/button.tsx'")
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
