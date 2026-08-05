import { describe, expect, test } from 'bun:test'

import { normalizeFreshContextRecipe } from '#cli/board-build/fresh-context'

const refineRecipe = {
  expected_source_hash: `sha256:${'a'.repeat(64)}`,
  kind: 'code_object',
  name: 'Patient summary',
  object_key: 'patient-summary',
  operation: 'refine',
  owner_id: 'frame:patient-summary',
  props: { compact: true },
  source: 'export default function PatientSummary() { return <main>Updated</main> }',
  source_format: 'tsx'
}

describe('fresh-context Code Object refinement', () => {
  test('accepts exact-owner full-source replacement without placement', () => {
    expect(normalizeFreshContextRecipe(refineRecipe)).toEqual(refineRecipe)
  })

  test('rejects auto placement, stale hash shapes, and create-only fields', () => {
    expect(() => normalizeFreshContextRecipe(refineRecipe, true)).toThrow(
      '--auto-place cannot be used with code_object refine'
    )
    expect(() =>
      normalizeFreshContextRecipe({ ...refineRecipe, expected_source_hash: 'sha256:stale' })
    ).toThrow('lowercase SHA-256')
    expect(() => normalizeFreshContextRecipe({ ...refineRecipe, width: 640 })).toThrow(
      'unexpected or authority fields: width'
    )
  })
})
