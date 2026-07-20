import { describe, expect, test } from 'bun:test'

import {
  THREE_EXPERIENCE_FIXTURE_SOURCE,
  THREE_RUNTIME_ID,
  THREE_RUNTIME_SHA256,
  buildThreeExperienceDocument
} from '@/app/spatial-media/three-experience'

describe('source-backed Three.js experience adapter', () => {
  test('reuses the HTML-board sandbox with a frozen fallback and bundled offline runtime', () => {
    const definition = {
      sceneSource: THREE_EXPERIENCE_FIXTURE_SOURCE,
      sourceId: 'fixture-torus-knot',
      sourceRevision: 3,
      title: 'Authored torus knot'
    }
    const document = buildThreeExperienceDocument(definition)

    expect(document.html).toContain('data-openpencil-artifact')
    expect(document.html).toContain('three-experience-fixture-torus-knot')
    expect(document.html).toContain('editingModel')
    expect(document.html).toContain('source-backed-sandbox')
    expect(document.html).toContain('webgl-with-frozen-svg-fallback')
    expect(document.html).toContain('three.js-r184-bundled-local')
    expect(document.html).toContain('fixture-torus-knot')
    expect(document.metadata).toMatchObject({
      permission: {
        execution: 'explicit-user-start',
        hostAccess: 'opaque-origin',
        network: 'none',
        sourceCode: 'sandboxed'
      },
      runtimeIntegrity: `sha256-${THREE_RUNTIME_SHA256}`,
      runtimeUrl: THREE_RUNTIME_ID,
      sourceId: 'fixture-torus-knot',
      sourceRevision: 3
    })
    expect(document.html).toContain(`"sourceHash":"${document.metadata.sourceHash}"`)
    expect(document.js).toContain('const SOURCE = "function createExperience(THREE, stage)')
    expect(document.js).toContain('new THREE.TorusKnotGeometry(0.9, 0.28, 144, 20)')
    expect(document.html).toContain('data-frozen-preview')
    expect(document.html).toContain('data-start-three')
    expect(document.html).toContain("connect-src 'none'")
    expect(document.html).not.toContain("'unsafe-eval'")
    expect(document.js).toContain("start?.addEventListener('click', startExperience)")
    expect(document.js).toContain("new Blob([source], { type: 'text/javascript' })")
    expect(document.js).toContain('loadClassicScript(RUNTIME_SOURCE')
    expect(document.js).not.toContain('new Function')
    expect(document.js.slice(document.js.indexOf('const SOURCE'))).not.toContain('fetch(')
  })
})
