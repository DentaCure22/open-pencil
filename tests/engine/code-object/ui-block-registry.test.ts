import { describe, expect, test } from 'bun:test'

import {
  CODE_OBJECT_UI_BLOCK_DEFINITIONS,
  resolveCodeObjectUiBlock,
  validateCodeObjectUiBlockConfig
} from '@open-pencil/core/code-object'

describe('Code Object UI block registry', () => {
  test('owns the portable financial dashboard contract', () => {
    expect(CODE_OBJECT_UI_BLOCK_DEFINITIONS).toHaveLength(3)
    expect(CODE_OBJECT_UI_BLOCK_DEFINITIONS[0]).toMatchObject({
      capabilities: ['actions', 'charts', 'tables'],
      configSchema: {
        additionalProperties: false,
        properties: {
          companyName: { maxLength: 160, minLength: 1, type: 'string' },
          keyNumbers: { maxItems: 8, type: 'array' }
        },
        type: 'object'
      },
      defaultSize: { height: 980, width: 1040 },
      defaultState: { lastAction: null },
      description: 'A business-health dashboard with metrics, findings, actions, and detail tables',
      id: 'financial-dashboard',
      label: 'Financial dashboard',
      sizing: 'content',
      surface: { background: 'transparent', overflow: 'scroll' }
    })
    expect(CODE_OBJECT_UI_BLOCK_DEFINITIONS[1]).toMatchObject({
      capabilities: ['actions', 'tables'],
      configSchema: {
        additionalProperties: false,
        properties: {
          estimates: { maxItems: 50, type: 'array' }
        },
        required: ['estimates'],
        type: 'object'
      },
      defaultSize: { height: 720, width: 1040 },
      defaultState: { lastAction: null },
      id: 'estimates-list',
      label: 'Estimates list',
      surface: { background: 'transparent', overflow: 'scroll' }
    })
    expect(CODE_OBJECT_UI_BLOCK_DEFINITIONS[2]).toMatchObject({
      capabilities: ['media'],
      configSchema: {
        additionalProperties: false,
        properties: {
          fit: { enum: ['contain', 'cover'] },
          src: { maxLength: 4096, minLength: 1, type: 'string' }
        },
        required: ['src'],
        type: 'object'
      },
      defaultSize: { height: 360, width: 640 },
      defaultState: {},
      id: 'video-player',
      label: 'Video player',
      sizing: 'viewport',
      surface: { background: 'surface', overflow: 'clip' }
    })
  })

  test('applies registry defaults while preserving explicit overrides', () => {
    expect(
      resolveCodeObjectUiBlock({
        block: 'financial-dashboard',
        config: { companyName: 'Northstar Dental' }
      })
    ).toMatchObject({
      block: 'financial-dashboard',
      config: { companyName: 'Northstar Dental' },
      height: 980,
      initialState: { lastAction: null },
      surface: { background: 'transparent', overflow: 'scroll' },
      width: 1040
    })

    expect(
      resolveCodeObjectUiBlock({
        block: 'financial-dashboard',
        height: 720,
        initialState: { lastAction: 'reviewed' },
        surface: { background: 'surface', overflow: 'clip' },
        width: 1120
      })
    ).toMatchObject({
      height: 720,
      initialState: { lastAction: 'reviewed' },
      surface: { background: 'surface', overflow: 'clip' },
      width: 1120
    })

    expect(
      resolveCodeObjectUiBlock({ block: 'estimates-list', config: { estimates: [] } })
    ).toMatchObject({
      block: 'estimates-list',
      config: { estimates: [] },
      height: 720,
      surface: { background: 'transparent', overflow: 'scroll' },
      width: 1040
    })

    expect(
      resolveCodeObjectUiBlock({
        block: 'video-player',
        config: { controls: true, fit: 'cover', src: 'https://example.com/clip.mp4' }
      })
    ).toMatchObject({
      block: 'video-player',
      config: { controls: true, fit: 'cover', src: 'https://example.com/clip.mp4' },
      height: 360,
      initialState: {},
      surface: { background: 'surface', overflow: 'clip' },
      width: 640
    })
  })

  test('rejects unknown blocks and misspelled configuration fields', () => {
    expect(validateCodeObjectUiBlockConfig('missing', {})).toEqual({
      error: 'UI block "missing" is not registered.',
      success: false
    })
    expect(
      validateCodeObjectUiBlockConfig('financial-dashboard', { company: 'Typo' })
    ).toMatchObject({
      success: false
    })
    expect(() => resolveCodeObjectUiBlock({ block: 'missing' })).toThrow(
      'UI block "missing" is not registered.'
    )
  })
})
