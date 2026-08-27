import { describe, expect, test } from 'bun:test'

import type { CodeObjectDocument } from '@/app/code-object/model'
import { connectedPlanObjectIds, isWorkPlanDocument } from '@/app/code-object/work-plan-link'

function workPlanDocument(): CodeObjectDocument {
  return {
    boardPermissions: [],
    component: 'user-code',
    definitionId: 'openpencil.preset.work-plan',
    name: 'Work plan',
    presetId: 'work-plan',
    props: {},
    runtime: 'openpencil-code',
    schemaVersion: 1,
    source: '',
    state: {}
  }
}

describe('connected Plan objects', () => {
  test('recognizes the canonical preset and legacy plan documents', () => {
    const document = workPlanDocument()

    expect(isWorkPlanDocument(document)).toBe(true)

    const legacyDocument = {
      ...document,
      presetId: undefined,
      props: { plan: { blocks: [], version: 1 } }
    }
    expect(isWorkPlanDocument(legacyDocument)).toBe(true)
  })

  test('prefers the Plan itself, then linked Plan artifacts', () => {
    const document = workPlanDocument()

    const galleryDocument = {
      ...document,
      props: {
        plan: {
          blocks: [
            {
              artifacts: [
                { kind: 'code_object', objectId: 'plan:patient-history' },
                { kind: 'image', objectId: 'image:ignored' },
                { kind: 'code_object', objectId: 'plan:patient-history' }
              ]
            }
          ],
          version: 1
        }
      }
    }

    expect(connectedPlanObjectIds('plan:gallery', galleryDocument)).toEqual([
      'plan:gallery',
      'plan:patient-history'
    ])
  })
})
