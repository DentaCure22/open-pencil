import { describe, expect, test } from 'bun:test'

import { resolveInteractiveSurfacePresentation } from '@/app/interactive-surface'
import {
  createKnowledgeWorkspace,
  createSurfaceRun,
  createWorkspaceContext,
  type SurfaceMode,
  type SurfaceRun
} from '@/app/workspace'

function surface(
  rendererId: string,
  modes: SurfaceMode[],
  input: { formKind?: SurfaceRun['form']['kind']; id?: string } = {}
): SurfaceRun {
  const workspace = createKnowledgeWorkspace({
    documentId: 'document-presentation-resolution',
    id: `workspace-${input.id ?? rendererId}`,
    name: 'Presentation resolution',
    pageId: `page-${input.id ?? rendererId}`
  })
  return createSurfaceRun(createWorkspaceContext(workspace), {
    artifact: {
      artifactId: `artifact-${input.id ?? rendererId}`,
      boardId: `board-${input.id ?? rendererId}`,
      boardRevision: 1,
      boardSchemaVersion: 1,
      kind: 'html-board',
      sourceHash: 'fnv1a-presentation'
    },
    evidenceManifest: { objectId: 'evidence-presentation', revision: 1 },
    formKind: input.formKind,
    formRationale: 'Resolve one renderer-local presentation target.',
    id: input.id ?? `surface-${rendererId}`,
    intent: { objectId: 'intent-presentation', revision: 1 },
    modes,
    name: 'Presentation surface',
    recommendations: [],
    rendererId
  })
}

describe('interactive surface presentation resolution', () => {
  test('keeps workspace view identity separate from the renderer target', () => {
    const program = surface('interactive-program-v1', [
      {
        id: 'mode-focus',
        kind: 'focus',
        label: 'Explore',
        rendererViewId: 'explore',
        viewId: 'workspace-view-focus'
      }
    ])

    expect(
      resolveInteractiveSurfacePresentation(program, {
        comparisonBasis: 'none',
        purpose: 'focus',
        role: 'root-surface'
      })
    ).toMatchObject({
      modeId: 'mode-focus',
      rendererViewId: 'explore',
      status: 'resolved'
    })
  })

  test('uses native compare only for a renderer-backed root comparison', () => {
    const flow = surface('flow-clarification-v1', [
      { id: 'mode-focus', kind: 'focus', label: 'Focus', rendererViewId: 'focus' },
      { id: 'mode-compare', kind: 'compare', label: 'Compare', rendererViewId: 'compare' }
    ])

    expect(
      resolveInteractiveSurfacePresentation(flow, {
        comparisonBasis: 'renderer-mode',
        purpose: 'compare',
        role: 'root-surface'
      })
    ).toMatchObject({
      modeKind: 'compare',
      reason: 'native-compare',
      rendererViewId: 'compare',
      status: 'resolved'
    })
  })

  test('keeps both sides of a companion comparison in their fitting focus targets', () => {
    const root = surface(
      'record-explorer-v1',
      [{ id: 'mode-focus', kind: 'focus', label: 'Focus', rendererViewId: 'focus' }],
      { id: 'root' }
    )
    const companion = surface(
      'evidence-brief-v1',
      [{ id: 'mode-focus', kind: 'focus', label: 'Brief', rendererViewId: 'focus' }],
      { id: 'companion' }
    )

    for (const [candidate, role] of [
      [root, 'root-surface'],
      [companion, 'companion-surface']
    ] as const) {
      expect(
        resolveInteractiveSurfacePresentation(candidate, {
          comparisonBasis: 'companion-surfaces',
          purpose: 'compare',
          role
        })
      ).toMatchObject({
        modeKind: 'focus',
        reason: 'companion-focus',
        rendererViewId: 'focus',
        status: 'resolved'
      })
    }
  })

  test('supports legacy nonstandard targets without inventing a workspace or mode ID', () => {
    const legacyMap = surface('spatial-map-v1', [
      { id: 'mode-map', kind: 'focus', label: 'Map', viewId: 'workspace-view-map' }
    ])
    const unknown = surface('unknown-renderer-v1', [
      { id: 'mode-focus', kind: 'focus', label: 'Focus', viewId: 'workspace-view-secret' }
    ])

    expect(
      resolveInteractiveSurfacePresentation(legacyMap, {
        comparisonBasis: 'none',
        purpose: 'focus',
        role: 'root-surface'
      })
    ).toMatchObject({ rendererViewId: 'map', status: 'resolved' })
    expect(
      resolveInteractiveSurfacePresentation(unknown, {
        comparisonBasis: 'none',
        purpose: 'focus',
        role: 'root-surface'
      })
    ).toMatchObject({ reason: 'renderer-target-unavailable', status: 'unsupported' })
  })

  test('does not command artifacts that are not embedded in Knowledge or Review', () => {
    const flow = surface('flow-clarification-v1', [
      { id: 'mode-review', kind: 'review', label: 'Review', rendererViewId: 'review' }
    ])
    for (const purpose of ['knowledge', 'review'] as const) {
      expect(
        resolveInteractiveSurfacePresentation(flow, {
          comparisonBasis: 'renderer-mode',
          purpose,
          role: 'root-surface'
        })
      ).toMatchObject({ reason: 'not-embedded-for-purpose', status: 'not-applicable' })
    }
  })
})
