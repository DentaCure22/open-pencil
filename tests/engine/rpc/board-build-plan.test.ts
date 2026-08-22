import { describe, expect, test } from 'bun:test'

import {
  BOARD_BUILD_PLAN_CONTRACT,
  boardBuildPlanDigestInput,
  compileBoardBuildPlanComposition,
  compileBoardBuildPlanFlowLayout,
  compileBoardBuildPlanGridLayout,
  parseBoardBuildPlan,
  resolveBoardBuildPlanOperations
} from '@open-pencil/core/rpc'

const validPlan = () => ({
  artifacts: [
    {
      alias: 'detect',
      recipe: {
        body: 'Compare expected and current Board revision.',
        kind: 'native_card',
        placement: { target: { kind: 'auto' } },
        title: 'Detect stale context'
      }
    },
    {
      alias: 'retry',
      anchor: { alias: 'detect' },
      recipe: {
        kind: 'native_text',
        placement: { clearance: 32, preferred_directions: ['right'] },
        text: 'Retry with the same request ID'
      }
    }
  ],
  contract: BOARD_BUILD_PLAN_CONTRACT
})

describe('board build plan contract', () => {
  test('places canonical objects and forks placements through the atomic plan', () => {
    const plan = parseBoardBuildPlan({
      artifacts: [
        {
          alias: 'pricing',
          recipe: {
            kind: 'canonical_object',
            operation: 'place',
            placement: { target: { kind: 'point', x: 200, y: 200 } },
            source_object_id: '0:10'
          }
        }
      ],
      contract: BOARD_BUILD_PLAN_CONTRACT,
      operations: [{ kind: 'canonical_object.fork', object_id: '0:20' }]
    })

    expect(plan.artifacts[0]?.recipe).toEqual({
      kind: 'canonical_object',
      operation: 'place',
      placement: { target: { kind: 'point', x: 200, y: 200 } },
      source_object_id: '0:10'
    })
    expect(plan.operations).toEqual([{ kind: 'canonical_object.fork', object_id: '0:20' }])
    expect(() =>
      parseBoardBuildPlan({
        artifacts: [],
        contract: BOARD_BUILD_PLAN_CONTRACT,
        operations: [
          { canonical_object_id: 'object:old', kind: 'canonical_object.link', placements: [] }
        ]
      })
    ).toThrow('object_id is required')
  })

  test('accepts guarded object operations without requiring new artifacts', () => {
    const plan = parseBoardBuildPlan({
      artifacts: [],
      contract: BOARD_BUILD_PLAN_CONTRACT,
      operations: [
        { kind: 'object.move', object_id: '0:10', x: 320, y: 240 },
        { height: 280, kind: 'object.resize', object_id: '0:10', width: 480 },
        {
          kind: 'object.update',
          object_id: '0:10',
          patch: { cornerRadius: 24, fill: '#2563EB', name: 'Updated card' }
        }
      ]
    })

    expect(plan.operations).toEqual([
      { kind: 'object.move', object_id: '0:10', x: 320, y: 240 },
      { height: 280, kind: 'object.resize', object_id: '0:10', width: 480 },
      {
        kind: 'object.update',
        object_id: '0:10',
        patch: { cornerRadius: 24, fill: '#2563EB', name: 'Updated card' }
      }
    ])
  })

  test('resolves an existing Code Object viewport resize idempotently', () => {
    const plan = parseBoardBuildPlan({
      artifacts: [],
      contract: BOARD_BUILD_PLAN_CONTRACT,
      operations: [{ kind: 'object.resize', object_id: '0:10', viewport_preset: 'desktop' }]
    })

    expect(plan.operations).toEqual([
      {
        height: 1069,
        kind: 'object.resize',
        object_id: '0:10',
        viewport_preset: 'desktop',
        width: 1728
      }
    ])
    expect(parseBoardBuildPlan(plan)).toEqual(plan)

    const mismatch = structuredClone(plan) as unknown as {
      operations: Array<Record<string, unknown>>
    }
    if (mismatch.operations[0]) mismatch.operations[0].width = 390
    expect(() => parseBoardBuildPlan(mismatch)).toThrow(
      'height and width must match its viewport_preset'
    )
  })

  test('accepts one transaction revert as the entire plan', () => {
    const plan = parseBoardBuildPlan({
      artifacts: [],
      contract: BOARD_BUILD_PLAN_CONTRACT,
      operations: [{ kind: 'transaction.revert', transaction_id: 'request:prior-mutation' }]
    })

    expect(plan.operations).toEqual([
      { kind: 'transaction.revert', transaction_id: 'request:prior-mutation' }
    ])
    expect(() =>
      parseBoardBuildPlan({
        artifacts: [],
        contract: BOARD_BUILD_PLAN_CONTRACT,
        operations: [
          { kind: 'transaction.revert', transaction_id: 'request:prior-mutation' },
          { kind: 'object.delete', object_id: '0:10' }
        ]
      })
    ).toThrow('transaction.revert must be the only effect')
  })

  test('accepts relative moves and resolves them from current Board bounds', () => {
    const plan = parseBoardBuildPlan({
      artifacts: [],
      contract: BOARD_BUILD_PLAN_CONTRACT,
      operations: [
        {
          kind: 'object.move',
          object_id: '0:10',
          relative_to: { align: 'center', gap: 40, object_id: '0:11', side: 'below' }
        }
      ]
    })
    const operations = resolveBoardBuildPlanOperations(plan.operations, (objectId) =>
      objectId === '0:10'
        ? { height: 80, width: 100, x: 0, y: 0 }
        : { height: 150, width: 300, x: 400, y: 200 }
    )

    expect(operations).toEqual([{ kind: 'object.move', object_id: '0:10', x: 500, y: 390 }])
  })

  test('rejects ambiguous or self-referential relative moves', () => {
    const base = {
      artifacts: [],
      contract: BOARD_BUILD_PLAN_CONTRACT
    }
    expect(() =>
      parseBoardBuildPlan({
        ...base,
        operations: [
          {
            kind: 'object.move',
            object_id: '0:10',
            relative_to: { object_id: '0:11', side: 'below' },
            x: 10,
            y: 20
          }
        ]
      })
    ).toThrow('either x and y or relative_to')
    expect(() =>
      parseBoardBuildPlan({
        ...base,
        operations: [
          {
            kind: 'object.move',
            object_id: '0:10',
            relative_to: { object_id: '0:10', side: 'below' }
          }
        ]
      })
    ).toThrow('must reference a different object')
  })

  test('rejects an empty plan', () => {
    expect(() =>
      parseBoardBuildPlan({
        artifacts: [],
        contract: BOARD_BUILD_PLAN_CONTRACT
      })
    ).toThrow('at least one artifact, composition, or operation')
  })

  test('normalizes one ordered plan', () => {
    const plan = parseBoardBuildPlan(validPlan())
    expect(plan.operations).toBeUndefined()
    expect(plan).toMatchObject({
      artifacts: [
        { alias: 'detect', recipe: { kind: 'native_card' } },
        { alias: 'retry', anchor: { alias: 'detect' }, recipe: { kind: 'native_text' } }
      ]
    })
  })

  test('compiles semantic composition without public grid geometry', () => {
    const plan = parseBoardBuildPlan({
      artifacts: [
        {
          alias: 'heading',
          recipe: {
            kind: 'native_text',
            placement: { target: { kind: 'auto' } },
            text: 'Trace workflow'
          }
        },
        {
          alias: 'capture',
          recipe: { body: 'Capture context.', kind: 'native_card', title: 'Capture' }
        },
        {
          alias: 'resolve',
          recipe: { body: 'Resolve exact objects.', kind: 'native_card', title: 'Resolve' }
        },
        {
          alias: 'edit',
          recipe: { body: 'Apply one edit.', kind: 'native_card', title: 'Edit' }
        }
      ],
      composition: {
        anchor: { alias: 'heading' },
        members: [{ alias: 'capture' }, { alias: 'resolve' }, { alias: 'edit' }],
        placement: 'below',
        preferences: { density: 'compact', direction: 'horizontal' }
      },
      contract: BOARD_BUILD_PLAN_CONTRACT
    })

    expect(plan.composition).toMatchObject({
      geography: 'preserve',
      preferences: { density: 'compact', direction: 'horizontal' }
    })
    if (!plan.composition) throw new Error('Expected semantic composition.')
    const compiled = compileBoardBuildPlanComposition(plan.composition, {
      'alias:capture': { height: 180, width: 320 },
      'alias:edit': { height: 180, width: 320 },
      'alias:resolve': { height: 220, width: 360 }
    })
    expect(compiled.strategy).toBe('grid')
    expect(compiled.members['alias:capture']?.x).toBeLessThan(
      compiled.members['alias:resolve']?.x ?? 0
    )
    expect(compiled.members['alias:resolve']?.x).toBeLessThan(
      compiled.members['alias:edit']?.x ?? 0
    )
  })

  test('accepts anchorless composition and requires anchors only for relative placement', () => {
    const anchorless = {
      artifacts: [
        {
          alias: 'one',
          recipe: { body: 'First item.', kind: 'native_card', title: 'One' }
        },
        {
          alias: 'two',
          recipe: { body: 'Second item.', kind: 'native_card', title: 'Two' }
        }
      ],
      composition: {
        members: [{ alias: 'one' }, { alias: 'two' }],
        preferences: { direction: 'horizontal' }
      },
      contract: BOARD_BUILD_PLAN_CONTRACT
    }

    expect(parseBoardBuildPlan(anchorless).composition).toEqual({
      geography: 'preserve',
      members: [{ alias: 'one' }, { alias: 'two' }],
      preferences: { density: 'balanced', direction: 'horizontal' }
    })
    expect(() =>
      parseBoardBuildPlan({
        ...anchorless,
        composition: { ...anchorless.composition, placement: 'below' }
      })
    ).toThrow('anchor is required when relative placement is requested')
    expect(
      parseBoardBuildPlan({
        artifacts: [],
        composition: {
          geography: 'recompose',
          members: [{ object_id: '0:10' }, { object_id: '0:11' }]
        },
        contract: BOARD_BUILD_PLAN_CONTRACT
      }).composition
    ).toMatchObject({
      geography: 'recompose',
      members: [{ object_id: '0:10' }, { object_id: '0:11' }]
    })
  })

  test('moves only explicitly listed existing objects through recompose geography', () => {
    expect(() =>
      parseBoardBuildPlan({
        artifacts: [],
        composition: {
          anchor: { height: 500, kind: 'near_region', width: 900, x: 0, y: 0 },
          members: [{ object_id: '0:10' }, { object_id: '0:11' }]
        },
        contract: BOARD_BUILD_PLAN_CONTRACT
      })
    ).toThrow('requires geography recompose')

    const plan = parseBoardBuildPlan({
      artifacts: [],
      composition: {
        anchor: { height: 500, kind: 'near_region', width: 900, x: 0, y: 0 },
        geography: 'recompose',
        members: [{ object_id: '0:10' }, { object_id: '0:11' }]
      },
      contract: BOARD_BUILD_PLAN_CONTRACT
    })
    expect(plan.composition?.members).toEqual([{ object_id: '0:10' }, { object_id: '0:11' }])
  })

  test('accepts a first native text artifact with explicit free placement', () => {
    const plan = parseBoardBuildPlan({
      artifacts: [
        {
          alias: 'caption',
          recipe: {
            kind: 'native_text',
            placement: { target: { kind: 'point', x: 240, y: 180 } },
            text: 'Experiment brief'
          }
        }
      ],
      contract: BOARD_BUILD_PLAN_CONTRACT
    })

    expect(plan.artifacts[0]).toMatchObject({
      alias: 'caption',
      recipe: { placement: { target: { kind: 'point', x: 240, y: 180 } } }
    })
  })

  test('accepts the natural version and anchored relative-direction shorthands', () => {
    const plan = parseBoardBuildPlan({
      artifacts: [
        {
          alias: 'triage',
          recipe: {
            body: 'Confirm scope and severity.',
            kind: 'native_card',
            placement: { target: { kind: 'auto' } },
            title: 'Triage the signal'
          }
        },
        {
          alias: 'contain',
          anchor: { alias: 'triage' },
          recipe: {
            body: 'Stop further damage.',
            kind: 'native_card',
            placement: {
              preferred_directions: ['right'],
              target: { direction: 'right', kind: 'relative' }
            },
            title: 'Contain the impact'
          }
        },
        {
          alias: 'threshold',
          anchor: { alias: 'triage' },
          recipe: {
            height: 48,
            kind: 'native_text',
            placement: { target: { direction: 'bottom', kind: 'relative' } },
            text: 'Success threshold: 30% week-4 retention',
            width: 360
          }
        }
      ],
      version: BOARD_BUILD_PLAN_CONTRACT
    })

    expect(plan).toMatchObject({
      artifacts: [
        {},
        {
          recipe: {
            placement: { preferred_directions: ['right', 'below', 'above', 'left'] }
          }
        },
        {
          recipe: {
            height: 48,
            max_width: 360,
            placement: { preferred_directions: ['below', 'right', 'above', 'left'] }
          }
        }
      ],
      contract: BOARD_BUILD_PLAN_CONTRACT
    })
    expect('version' in plan).toBe(false)
    expect('operation' in plan.artifacts[1].recipe).toBe(false)

    const unsupportedOperation = validPlan()
    unsupportedOperation.artifacts[0].recipe = {
      ...unsupportedOperation.artifacts[0].recipe,
      operation: 'create'
    }
    expect(() => parseBoardBuildPlan(unsupportedOperation)).toThrow('operation')
  })

  test('normalizes natural card vocabulary and an optional height hint', () => {
    const plan = parseBoardBuildPlan({
      artifacts: [
        {
          alias: 'intake',
          recipe: {
            content: 'Capture the request and its owner.',
            height: 220,
            kind: 'native_card',
            name: 'Intake',
            placement: { target: { kind: 'auto' } }
          }
        }
      ],
      contract: BOARD_BUILD_PLAN_CONTRACT
    })

    expect(plan.artifacts[0].recipe).toEqual({
      body: 'Capture the request and its owner.',
      height: 220,
      kind: 'native_card',
      name: 'Intake',
      placement: { target: { kind: 'auto' } },
      title: 'Intake'
    })

    const distinctLayerName = validPlan()
    distinctLayerName.artifacts[0].recipe.name = 'Intake card'
    expect(parseBoardBuildPlan(distinctLayerName).artifacts[0].recipe).toMatchObject({
      name: 'Intake card',
      title: 'Detect stale context'
    })
  })

  test('normalizes an unambiguous recipe type alias and rejects conflicts', () => {
    const input = validPlan()
    input.artifacts[0].recipe = {
      body: 'Compare expected and current Board revision.',
      placement: { target: { kind: 'auto' } },
      title: 'Detect stale context',
      type: 'native_card'
    }

    expect(parseBoardBuildPlan(input).artifacts[0].recipe.kind).toBe('native_card')
    input.artifacts[0].recipe.kind = 'native_text'
    expect(() => parseBoardBuildPlan(input)).toThrow(
      'kind and plan.artifacts[0].recipe.type must match'
    )
  })

  test('normalizes a title-only native card with an empty body', () => {
    const input = validPlan()
    delete input.artifacts[0].recipe.body
    expect(parseBoardBuildPlan(input).artifacts[0].recipe).toMatchObject({
      body: '',
      kind: 'native_card',
      title: 'Detect stale context'
    })
  })

  test('widens long native-card prose deterministically without changing content', () => {
    const body = `${'Preserve this exact content. '.repeat(29)}End.`
    expect(body.length).toBeGreaterThan(700)
    const input = validPlan()
    input.artifacts[0].recipe.body = body

    expect(parseBoardBuildPlan(input).artifacts[0].recipe).toMatchObject({
      body,
      kind: 'native_card',
      width: 640
    })

    const explicit = {
      ...input,
      artifacts: [
        {
          ...input.artifacts[0],
          recipe: { ...input.artifacts[0].recipe, width: 480 }
        },
        ...input.artifacts.slice(1)
      ]
    }
    expect(parseBoardBuildPlan(explicit).artifacts[0].recipe).toMatchObject({ body, width: 480 })
  })

  test('normalizes and completes a preferred direction subset before digesting the plan', () => {
    const aliased = validPlan()
    aliased.artifacts[1].recipe.placement = {
      clearance: 32,
      preferred_directions: ['down', 'right']
    }
    const plan = parseBoardBuildPlan(aliased)

    expect(plan.artifacts[1].recipe).toMatchObject({
      placement: {
        clearance: 32,
        preferred_directions: ['below', 'right', 'above', 'left']
      }
    })

    const upward = validPlan()
    upward.artifacts[1].recipe.placement = { preferred_directions: ['up', 'left'] }
    expect(parseBoardBuildPlan(upward).artifacts[1].recipe).toMatchObject({
      placement: { preferred_directions: ['above', 'left', 'right', 'below'] }
    })
    expect(
      boardBuildPlanDigestInput(plan, {
        intent: 'Build a recovery decision flow',
        target: {
          content_document_id: 'content-1',
          document_id: 'document-1',
          page_id: 'page-1',
          runtime_instance_id: 'runtime-1',
          workspace_id: 'workspace-1'
        }
      })
    ).toMatchObject({
      plan: {
        artifacts: [
          {},
          {
            recipe: {
              placement: {
                preferred_directions: ['below', 'right', 'above', 'left']
              }
            }
          }
        ]
      }
    })
  })

  test('rejects unrelated directions and deduplicates equivalent direction aliases', () => {
    const unsupported = validPlan()
    unsupported.artifacts[1].recipe.placement = { preferred_directions: ['north'] }
    expect(() => parseBoardBuildPlan(unsupported)).toThrow('unsupported direction')

    const duplicate = validPlan()
    duplicate.artifacts[1].recipe.placement = {
      preferred_directions: ['above', 'top']
    }
    expect(parseBoardBuildPlan(duplicate).artifacts[1].recipe).toMatchObject({
      placement: { preferred_directions: ['above', 'right', 'below', 'left'] }
    })

    const empty = validPlan()
    empty.artifacts[1].recipe.placement = { preferred_directions: [] }
    expect(() => parseBoardBuildPlan(empty)).toThrow('one to four unique directions')
  })

  test('lifts nested anchors, expands diagonal directions, and accepts string aliases', () => {
    const plan = parseBoardBuildPlan({
      artifacts: [
        {
          alias: 'intake',
          recipe: {
            body: 'Capture the request.',
            kind: 'native_card',
            placement: { target: { kind: 'auto' } },
            title: 'Intake'
          }
        },
        {
          alias: 'review',
          recipe: {
            body: 'Evaluate the request.',
            kind: 'native_card',
            placement: {
              anchor: 'intake',
              target: { direction: 'top-right', kind: 'relative' }
            },
            title: 'Review'
          }
        }
      ],
      contract: BOARD_BUILD_PLAN_CONTRACT
    })

    expect(plan).toMatchObject({
      artifacts: [
        {},
        {
          anchor: { alias: 'intake' },
          recipe: {
            placement: {
              preferred_directions: ['above', 'right', 'below', 'left'],
              relative_offset: { column: 1, row: -1 }
            }
          }
        }
      ]
    })
  })

  test('lifts artifact placement shorthands and normalizes natural diagonals', () => {
    const input = validPlan()
    delete input.artifacts[1].recipe.placement.clearance
    delete input.artifacts[1].recipe.placement.preferred_directions
    input.artifacts[1].clearance = 520
    input.artifacts[1].preferred_directions = ['lower-left', 'upper-right']
    expect(parseBoardBuildPlan(input).artifacts[1].recipe).toMatchObject({
      placement: {
        clearance: 520,
        preferred_directions: ['below', 'left', 'above', 'right'],
        relative_offset: { column: -1, row: 1 }
      }
    })

    const spaced = validPlan()
    spaced.artifacts[1].recipe.placement = { preferred_directions: ['top right'] }
    expect(parseBoardBuildPlan(spaced).artifacts[1].recipe).toMatchObject({
      placement: {
        preferred_directions: ['above', 'right', 'below', 'left'],
        relative_offset: { column: 1, row: -1 }
      }
    })

    const explicitOffset = validPlan()
    explicitOffset.artifacts[1].recipe.placement = {
      preferred_directions: ['upper-right'],
      relative_offset: { column: -1, row: 1 }
    }
    expect(parseBoardBuildPlan(explicitOffset).artifacts[1].recipe).toMatchObject({
      placement: { relative_offset: { column: -1, row: 1 } }
    })

    const cardinal = validPlan()
    cardinal.artifacts[1].recipe.placement = { preferred_directions: ['right'] }
    expect(parseBoardBuildPlan(cardinal).artifacts[1].recipe).toMatchObject({
      placement: {
        preferred_directions: ['right', 'below', 'above', 'left']
      }
    })
    expect(parseBoardBuildPlan(cardinal).artifacts[1].recipe.placement).not.toHaveProperty(
      'relative_offset'
    )

    const invalidOffset = validPlan()
    Object.assign(invalidOffset.artifacts[1].recipe.placement, {
      relative_offset: { column: 0, row: 0 }
    })
    expect(() => parseBoardBuildPlan(invalidOffset)).toThrow('cannot be zero/zero')
  })

  test('rejects duplicate and forward aliases', () => {
    const duplicate = validPlan()
    duplicate.artifacts[1] = { ...duplicate.artifacts[1], alias: 'detect' }
    expect(() => parseBoardBuildPlan(duplicate)).toThrow('duplicated')

    const forward = validPlan()
    forward.artifacts[0] = {
      ...forward.artifacts[0],
      anchor: { alias: 'retry' },
      recipe: { ...forward.artifacts[0].recipe, placement: undefined }
    }
    expect(() => parseBoardBuildPlan(forward)).toThrow('unknown or forward alias')
  })

  test('enforces artifact anchor and placement rules', () => {
    const textWithoutAnchor = validPlan()
    delete textWithoutAnchor.artifacts[1].anchor
    expect(() => parseBoardBuildPlan(textWithoutAnchor)).toThrow('requires exactly one')

    const cardWithBoth = validPlan()
    cardWithBoth.artifacts[0].anchor = { object_id: '0:10' }
    expect(() => parseBoardBuildPlan(cardWithBoth)).toThrow('requires exactly one')
  })

  test('accepts Code Object and native Mermaid artifacts while validating their exact shapes', () => {
    const plan = parseBoardBuildPlan({
      artifacts: [
        {
          alias: 'app',
          recipe: {
            initial_state: { count: 0 },
            kind: 'code_object',
            name: 'Counter',
            object_key: 'counter-v1',
            operation: 'create',
            placement: { target: { kind: 'point', x: 320, y: 240 } },
            source:
              'export default function Counter(){return <button type="button">Count</button>}',
            source_format: 'tsx'
          }
        },
        {
          alias: 'flow',
          anchor: { alias: 'app' },
          recipe: {
            kind: 'native_diagram',
            placement: { clearance: 72, preferred_directions: ['right'] },
            source: 'flowchart LR\n  A --> B',
            source_format: 'mermaid'
          }
        }
      ],
      contract: BOARD_BUILD_PLAN_CONTRACT
    })
    expect(plan.artifacts).toMatchObject([
      { alias: 'app', recipe: { kind: 'code_object', source_format: 'tsx' } },
      {
        alias: 'flow',
        recipe: {
          kind: 'native_diagram',
          placement: {
            clearance: 72,
            preferred_directions: ['right', 'below', 'above', 'left']
          },
          source_format: 'mermaid'
        }
      }
    ])

    const rewrite = parseBoardBuildPlan({
      artifacts: [
        {
          alias: 'flow',
          recipe: {
            kind: 'native_diagram',
            owner_id: '0:42',
            source: 'flowchart TD\n  A --> B',
            source_format: 'mermaid'
          }
        }
      ],
      contract: BOARD_BUILD_PLAN_CONTRACT
    })
    expect(rewrite.artifacts[0]?.recipe).toMatchObject({
      kind: 'native_diagram',
      owner_id: '0:42'
    })
    expect(() =>
      parseBoardBuildPlan({
        artifacts: [
          {
            alias: 'flow',
            recipe: {
              kind: 'native_diagram',
              owner_id: '0:42',
              placement: { target: { kind: 'auto' } },
              source: 'flowchart TD\n  A --> B',
              source_format: 'mermaid'
            }
          }
        ],
        contract: BOARD_BUILD_PLAN_CONTRACT
      })
    ).toThrow('refinement cannot use anchor, composition, layout, or recipe.placement.target')

    const missingFormat = validPlan()
    missingFormat.artifacts[0].recipe = { kind: 'native_diagram', source: 'flowchart LR' }
    expect(() => parseBoardBuildPlan(missingFormat)).toThrow('source_format must be mermaid')

    const refinement = validPlan()
    refinement.artifacts[0].recipe = {
      kind: 'code_object',
      name: 'Counter',
      object_key: 'counter-v1',
      operation: 'refine',
      placement: { target: { kind: 'auto' } },
      source: 'export default function Counter(){return null}',
      source_format: 'tsx'
    }
    expect(() => parseBoardBuildPlan(refinement)).toThrow('operation must be create')

    expect(() => parseBoardBuildPlan({ ...validPlan(), extra: true })).toThrow('unsupported fields')
  })

  test('accepts registered trusted web apps and rejects arbitrary trusted origins', () => {
    const plan = parseBoardBuildPlan({
      artifacts: [
        {
          alias: 'chart',
          recipe: {
            app_id: 'smylr',
            height: 720,
            kind: 'trusted_web_app',
            name: 'Dental Chart',
            operation: 'create',
            placement: { target: { kind: 'auto' } },
            route: '/dental-chart',
            width: 520
          }
        }
      ],
      contract: BOARD_BUILD_PLAN_CONTRACT
    })

    expect(plan.artifacts[0]?.recipe).toEqual({
      app_id: 'smylr',
      height: 720,
      kind: 'trusted_web_app',
      name: 'Dental Chart',
      operation: 'create',
      placement: { target: { kind: 'auto' } },
      route: '/dental-chart',
      width: 520
    })

    const arbitraryOrigin = structuredClone(plan)
    arbitraryOrigin.artifacts[0] = {
      alias: 'external',
      recipe: {
        app_id: 'smylr',
        kind: 'trusted_web_app',
        name: 'External',
        operation: 'create',
        placement: { target: { kind: 'auto' } },
        route: 'https://example.com'
      }
    }
    expect(() => parseBoardBuildPlan(arbitraryOrigin)).toThrow(
      'route must be a local path beginning with one slash'
    )

    const unknownApp = structuredClone(plan) as unknown as {
      artifacts: Array<{ recipe: Record<string, unknown> }>
    }
    if (unknownApp.artifacts[0]) unknownApp.artifacts[0].recipe.app_id = 'unknown'
    expect(() => parseBoardBuildPlan(unknownApp)).toThrow('app_id must be smylr')
  })

  test('resolves one semantic trusted-app viewport preset to canonical dimensions', () => {
    const plan = parseBoardBuildPlan({
      artifacts: [
        {
          alias: 'chart',
          recipe: {
            app_id: 'smylr',
            kind: 'trusted_web_app',
            name: 'Dental Chart',
            operation: 'create',
            placement: { target: { kind: 'auto' } },
            route: '/dental-chart',
            viewport_preset: 'tablet'
          }
        }
      ],
      contract: BOARD_BUILD_PLAN_CONTRACT
    })

    expect(plan.artifacts[0]?.recipe).toEqual({
      app_id: 'smylr',
      height: 1024,
      kind: 'trusted_web_app',
      name: 'Dental Chart',
      operation: 'create',
      placement: { target: { kind: 'auto' } },
      route: '/dental-chart',
      viewport_preset: 'tablet',
      width: 768
    })

    const conflictingSize = structuredClone(plan) as unknown as {
      artifacts: Array<{ recipe: Record<string, unknown> }>
    }
    if (conflictingSize.artifacts[0]) {
      conflictingSize.artifacts[0].recipe.viewport_preset = 'desktop'
    }
    expect(() => parseBoardBuildPlan(conflictingSize)).toThrow(
      'height and width must match its viewport_preset'
    )
  })

  test('binds the normalized plan and exact target into the digest input', () => {
    const plan = parseBoardBuildPlan(validPlan())
    const digestInput = boardBuildPlanDigestInput(plan, {
      intent: 'Build a recovery decision flow',
      target: {
        content_document_id: 'content-1',
        document_id: 'document-1',
        page_id: 'page-1',
        runtime_instance_id: 'runtime-1',
        workspace_id: 'workspace-1'
      },
      trace_id: 'trace-1'
    })
    expect(digestInput).toMatchObject({
      intent: 'Build a recovery decision flow',
      plan,
      route: 'board_build:plan/v1',
      target: { page_id: 'page-1' },
      trace_id: 'trace-1'
    })
  })

  test('normalizes and compiles a variable-height four-by-two grid', () => {
    const heights = [216, 236, 236, 216, 216, 216, 216, 236]
    const plan = parseBoardBuildPlan({
      artifacts: [
        {
          alias: 'title',
          recipe: {
            kind: 'native_text',
            placement: { target: { kind: 'auto' } },
            text: 'Two-Week Field Research Plan'
          }
        },
        ...heights.map((height, index) => ({
          alias: `card_${index + 1}`,
          recipe: {
            body: `Expected learning ${index + 1}`,
            height,
            kind: 'native_card',
            title: `Day ${index + 1}`,
            width: 320
          }
        }))
      ],
      contract: BOARD_BUILD_PLAN_CONTRACT,
      layout: {
        anchor: { alias: 'title' },
        columns: 4,
        kind: 'grid',
        members: heights.map((_, index) => `card_${index + 1}`),
        placement: { preferred_directions: ['down'] }
      }
    })

    expect(plan.layout).toEqual({
      align: 'start',
      anchor: { alias: 'title' },
      column_gap: 48,
      columns: 4,
      kind: 'grid',
      members: heights.map((_, index) => `card_${index + 1}`),
      placement: { preferred_directions: ['below', 'right', 'above', 'left'] },
      row_gap: 48
    })
    if (!plan.layout) throw new Error('Expected normalized grid layout.')
    const compiled = compileBoardBuildPlanGridLayout(
      plan.layout,
      Object.fromEntries(
        heights.map((height, index) => [`card_${index + 1}`, { height, width: 320 }])
      )
    )

    expect(compiled.footprint).toEqual({ height: 520, width: 1_424 })
    expect([1, 2, 3, 4].map((index) => compiled.aliases[`card_${index}`]?.y)).toEqual([0, 0, 0, 0])
    expect([5, 6, 7, 8].map((index) => compiled.aliases[`card_${index}`]?.y)).toEqual([
      284, 284, 284, 284
    ])
    expect([1, 2, 3, 4].map((index) => compiled.aliases[`card_${index}`]?.x)).toEqual([
      0, 368, 736, 1_104
    ])
  })

  test('accepts a bounded region as a grid layout anchor', () => {
    const plan = parseBoardBuildPlan({
      artifacts: ['one', 'two'].map((alias) => ({
        alias,
        recipe: { body: alias, kind: 'native_card', title: alias }
      })),
      contract: BOARD_BUILD_PLAN_CONTRACT,
      layout: {
        anchor: { height: 480, kind: 'region', width: 960, x: 120, y: 240 },
        columns: 2,
        kind: 'grid',
        members: ['one', 'two']
      }
    })

    expect(plan.layout?.anchor).toEqual({
      height: 480,
      kind: 'region',
      width: 960,
      x: 120,
      y: 240
    })
  })

  test('normalizes unambiguous grid member alias objects', () => {
    const plan = parseBoardBuildPlan({
      artifacts: [
        {
          alias: 'title',
          recipe: {
            kind: 'native_text',
            placement: { target: { kind: 'auto' } },
            text: 'Grid title'
          }
        },
        ...['one', 'two'].map((alias) => ({
          alias,
          recipe: { body: alias, kind: 'native_card', title: alias }
        }))
      ],
      contract: BOARD_BUILD_PLAN_CONTRACT,
      layout: {
        anchor: { alias: 'title' },
        columns: 2,
        kind: 'grid',
        members: [{ alias: 'one' }, { alias: 'two' }]
      }
    })

    expect(plan.layout?.kind).toBe('grid')
    if (plan.layout?.kind !== 'grid') throw new Error('Expected a grid layout.')
    expect(plan.layout.members).toEqual(['one', 'two'])
  })

  test('compiles measured flow ranks with deterministic geometry', () => {
    const plan = parseBoardBuildPlan({
      artifacts: [
        {
          alias: 'title',
          recipe: {
            kind: 'native_text',
            placement: { target: { kind: 'auto' } },
            text: 'Schema map'
          }
        },
        ...['users', 'teams', 'projects', 'tasks', 'comments'].map((alias) => ({
          alias,
          recipe: { body: `${alias} fields`, kind: 'native_card', title: alias, width: 320 }
        }))
      ],
      contract: BOARD_BUILD_PLAN_CONTRACT,
      layout: {
        anchor: { alias: 'title' },
        direction: 'right',
        kind: 'flow',
        ranks: [['users', 'teams'], ['projects'], ['tasks', 'comments']]
      }
    })

    expect(plan.layout?.kind).toBe('flow')
    if (plan.layout?.kind !== 'flow') throw new Error('Expected a flow layout.')
    expect(plan.layout).toMatchObject({ align: 'center', node_gap: 72, rank_gap: 160 })
    const compiled = compileBoardBuildPlanFlowLayout(plan.layout, {
      comments: { height: 260, width: 320 },
      projects: { height: 240, width: 360 },
      tasks: { height: 300, width: 320 },
      teams: { height: 220, width: 320 },
      users: { height: 280, width: 320 }
    })

    expect(compiled.footprint).toEqual({ height: 632, width: 1_320 })
    expect(compiled.aliases.users).toEqual({ height: 280, width: 320, x: 0, y: 30 })
    expect(compiled.aliases.teams).toEqual({ height: 220, width: 320, x: 0, y: 382 })
    expect(compiled.aliases.projects).toEqual({ height: 240, width: 360, x: 480, y: 196 })
    expect(compiled.aliases.tasks).toEqual({ height: 300, width: 320, x: 1_000, y: 0 })
    expect(compiled.aliases.comments).toEqual({ height: 260, width: 320, x: 1_000, y: 372 })
  })

  test('rejects duplicate or individually placed flow members', () => {
    const input = {
      artifacts: [
        {
          alias: 'title',
          recipe: {
            kind: 'native_text',
            placement: { target: { kind: 'auto' } },
            text: 'Schema map'
          }
        },
        { alias: 'one', recipe: { body: 'one', kind: 'native_card', title: 'one' } },
        { alias: 'two', recipe: { body: 'two', kind: 'native_card', title: 'two' } }
      ],
      contract: BOARD_BUILD_PLAN_CONTRACT,
      layout: {
        anchor: { alias: 'title' },
        kind: 'flow',
        ranks: [['one'], ['two']]
      }
    }

    expect(() =>
      parseBoardBuildPlan({
        ...input,
        layout: { ...input.layout, ranks: [['one'], ['one']] }
      })
    ).toThrow('unique aliases')
    expect(() =>
      parseBoardBuildPlan({
        ...input,
        artifacts: input.artifacts.map((artifact) =>
          artifact.alias === 'two'
            ? {
                ...artifact,
                recipe: { ...artifact.recipe, placement: { target: { kind: 'auto' } } }
              }
            : artifact
        )
      })
    ).toThrow('may not declare anchor or recipe placement')
  })

  test('rejects invalid grid fields, members, columns, and gaps', () => {
    const input = {
      artifacts: [
        {
          alias: 'title',
          recipe: {
            kind: 'native_text',
            placement: { target: { kind: 'auto' } },
            text: 'Grid title'
          }
        },
        ...['one', 'two'].map((alias) => ({
          alias,
          recipe: { body: alias, kind: 'native_card', title: alias }
        }))
      ],
      contract: BOARD_BUILD_PLAN_CONTRACT,
      layout: {
        anchor: { alias: 'title' },
        columns: 2,
        kind: 'grid',
        members: ['one', 'two']
      }
    }

    expect(() =>
      parseBoardBuildPlan({ ...input, layout: { ...input.layout, extra: true } })
    ).toThrow('unsupported fields')
    expect(() =>
      parseBoardBuildPlan({ ...input, layout: { ...input.layout, members: ['one', 'missing'] } })
    ).toThrow('unknown alias "missing"')
    expect(() =>
      parseBoardBuildPlan({ ...input, layout: { ...input.layout, members: ['one', 'one'] } })
    ).toThrow('unique aliases')
    expect(() =>
      parseBoardBuildPlan({
        ...input,
        layout: { ...input.layout, placement: { target: { kind: 'auto' } } }
      })
    ).toThrow('unsupported fields')
    for (const columns of [0, 1.5, 13]) {
      expect(() => parseBoardBuildPlan({ ...input, layout: { ...input.layout, columns } })).toThrow(
        'plan.layout.columns'
      )
    }
    for (const [field, value] of [
      ['column_gap', -1],
      ['column_gap', 1_025],
      ['row_gap', -1],
      ['row_gap', 1_025]
    ] as const) {
      expect(() =>
        parseBoardBuildPlan({ ...input, layout: { ...input.layout, [field]: value } })
      ).toThrow(`plan.layout.${field}`)
    }
  })

  test('rejects grid member placement and member or late anchors', () => {
    const input = {
      artifacts: [
        {
          alias: 'title',
          recipe: {
            kind: 'native_text',
            placement: { target: { kind: 'auto' } },
            text: 'Grid title'
          }
        },
        {
          alias: 'one',
          recipe: { body: 'One', kind: 'native_card', title: 'One' }
        },
        {
          alias: 'two',
          recipe: { body: 'Two', kind: 'native_card', title: 'Two' }
        },
        {
          alias: 'late',
          recipe: {
            kind: 'native_text',
            placement: { target: { kind: 'auto' } },
            text: 'Late anchor'
          }
        }
      ],
      contract: BOARD_BUILD_PLAN_CONTRACT,
      layout: {
        anchor: { alias: 'title' },
        columns: 2,
        kind: 'grid',
        members: ['one', 'two']
      }
    }
    const placed = structuredClone(input)
    placed.artifacts[1].recipe.placement = { preferred_directions: ['right'] }
    expect(() => parseBoardBuildPlan(placed)).toThrow('may not declare anchor or recipe placement')

    const anchored = structuredClone(input)
    anchored.artifacts[2].anchor = { alias: 'one' }
    expect(() => parseBoardBuildPlan(anchored)).toThrow(
      'may not declare anchor or recipe placement'
    )

    expect(() =>
      parseBoardBuildPlan({ ...input, layout: { ...input.layout, anchor: { alias: 'one' } } })
    ).toThrow('cannot reference a grid member')
    expect(() =>
      parseBoardBuildPlan({ ...input, layout: { ...input.layout, anchor: { alias: 'late' } } })
    ).toThrow('must be created before every grid member')
  })
})
