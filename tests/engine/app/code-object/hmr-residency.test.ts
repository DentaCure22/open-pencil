import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(import.meta.dir, '../../../..')

describe('Code Object HMR residency', () => {
  test('preserves stable runtimes across graph replacement and Vue HMR', () => {
    const overlays = readFileSync(
      resolve(root, 'src/components/canvas/CodeObjectOverlays.vue'),
      'utf8'
    )
    const graphReplacementHandler = overlays.match(
      /store\.onEditorEvent\('graph:replaced',[\s\S]*?\n\s*}\),/
    )?.[0]

    expect(graphReplacementHandler).toBeDefined()
    expect(graphReplacementHandler).not.toContain('disposeAllCodeObjects')
    expect(graphReplacementHandler).toContain('reconcileCurrentBoardRuntimes')
    expect(overlays).toContain('runtime?.parkAllCodeObjects()')
    expect(overlays).toContain('preserveCodeObjectRuntimeDuringHotUpdate()')
  })

  test('parks the real iframe DOM runtime during OpenPencil HMR', () => {
    const trustedWebApp = readFileSync(
      resolve(root, 'src/components/code-object/SmylrTrustedWebApp.vue'),
      'utf8'
    )
    const domRuntime = readFileSync(
      resolve(root, 'src/app/code-object/trusted-web-app-dom-runtime.ts'),
      'utf8'
    )

    expect(trustedWebApp).toContain('parkTrustedWebAppDomRuntime(frameId)')
    expect(trustedWebApp).toContain('attachTrustedWebAppDomRuntime(frameId, host)')
    expect(trustedWebApp).not.toContain('<iframe')
    expect(domRuntime).toContain('moveBefore')
    expect(domRuntime).toContain('openPencilRuntimeParking')
  })
})
