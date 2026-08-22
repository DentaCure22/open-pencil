import { describe, expect, test } from 'bun:test'

import { narratedTraceTargetForLiveInspectorSelection } from '@/app/narrated-trace/live-inspector-target'

describe('Narrated Trace live inspector targets', () => {
  test('records an exact live container inside its owning Code Object frame', () => {
    const target = narratedTraceTargetForLiveInspectorSelection({
      document: {
        capturedAt: '2026-08-06T12:00:00.000Z',
        route: '/patients',
        selectedId: 'page-content',
        title: 'Smylr',
        tree: {
          children: [
            {
              children: [
                {
                  id: 'patient-action',
                  label: 'Add patient',
                  rect: { height: 32, width: 100, x: 840, y: 12 },
                  role: 'button',
                  tagName: 'button'
                }
              ],
              id: 'page-content',
              label: 'Page Content',
              rect: { height: 520, width: 960, x: 240, y: 80 },
              source: {
                componentName: 'Primitive.div.Slot',
                filePath: 'src/features/patient-admin/components/patients-list.tsx',
                lineNumber: 91,
                ownerPath: [
                  {
                    componentName: 'Primitive.div.Slot',
                    filePath: 'src/features/patient-admin/components/patients-list.tsx',
                    lineNumber: 91
                  },
                  {
                    componentName: 'PatientsList',
                    filePath: 'src/features/patient-admin/components/patients-list.tsx',
                    lineNumber: 72
                  }
                ]
              }
            }
          ],
          id: 'application-shell',
          label: 'Application Shell',
          rect: { height: 900, width: 1440, x: 0, y: 0 }
        }
      },
      frameBounds: { height: 900, width: 1440, x: 120, y: 180 },
      frameId: 'smylr-frame',
      framePath: ['Dental Board', 'Smylr'],
      selectedId: 'page-content',
      selectedRect: { height: 520, width: 960, x: 240, y: 80 }
    })

    expect(target).toEqual({
      bounds: { height: 520, width: 960, x: 360, y: 260 },
      elementKind: 'container',
      frameId: 'smylr-frame',
      hierarchy: {
        children: [{ label: 'Add patient', stableId: 'patient-action' }],
        current: { label: 'Page Content', stableId: 'page-content' },
        parent: { label: 'Application Shell', stableId: 'application-shell' }
      },
      name: 'Page Content',
      path: ['Dental Board', 'Smylr', 'Application Shell', 'Page Content'],
      route: '/patients',
      source: {
        componentName: 'PatientsList',
        filePath: 'src/features/patient-admin/components/patients-list.tsx',
        lineNumber: 72
      },
      stableId: 'page-content'
    })
  })

  test('rejects a stale live selection that is absent from the current tree', () => {
    expect(
      narratedTraceTargetForLiveInspectorSelection({
        document: {
          capturedAt: '2026-08-06T12:00:00.000Z',
          route: '/',
          selectedId: 'application-shell',
          title: 'Smylr',
          tree: {
            id: 'application-shell',
            label: 'Application Shell',
            rect: { height: 900, width: 1440, x: 0, y: 0 }
          }
        },
        frameBounds: { height: 900, width: 1440, x: 0, y: 0 },
        frameId: 'smylr-frame',
        framePath: ['Smylr'],
        selectedId: 'stale-container',
        selectedRect: { height: 10, width: 10, x: 0, y: 0 }
      })
    ).toBeNull()
  })
})
