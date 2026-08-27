import { describe, expect, test } from 'bun:test'

import {
  CODE_OBJECT_AGENT_PRESETS,
  CODE_OBJECT_MODALITY_DEFINITIONS,
  WORK_PLAN_ARTIFACT_KINDS,
  WORK_PLAN_BLOCK_TYPES,
  codeObjectAgentPresetForModality,
  preflightCodeObjectSource
} from '@open-pencil/core/code-object'

describe('Code Object agent presets', () => {
  test('registers exactly one safe starter for every modality', async () => {
    expect(CODE_OBJECT_AGENT_PRESETS).toHaveLength(CODE_OBJECT_MODALITY_DEFINITIONS.length)
    expect(new Set(CODE_OBJECT_AGENT_PRESETS.map(({ id }) => id)).size).toBe(
      CODE_OBJECT_AGENT_PRESETS.length
    )
    expect(new Set(CODE_OBJECT_AGENT_PRESETS.map(({ modality }) => modality)).size).toBe(
      CODE_OBJECT_MODALITY_DEFINITIONS.length
    )

    for (const definition of CODE_OBJECT_MODALITY_DEFINITIONS) {
      const preset = codeObjectAgentPresetForModality(definition.id)
      expect(preset.modality).toBe(definition.id)
      expect(preset.name.length).toBeGreaterThan(0)
      expect(preset.source.length).toBeGreaterThan(0)
      await expect(preflightCodeObjectSource(preset.source)).resolves.toMatchObject({
        syntax: 'passed'
      })
    }
  })

  test('keeps preset-owned renderers transparent at the host boundary', () => {
    for (const preset of CODE_OBJECT_AGENT_PRESETS) {
      expect(preset.surface.background).toBe('transparent')
    }
  })

  test('gives work plans typed rich blocks without absorbing source artifacts', () => {
    expect(WORK_PLAN_BLOCK_TYPES).toEqual(
      expect.arrayContaining(['diagram', 'chart', 'table', 'artifact'])
    )
    expect(WORK_PLAN_ARTIFACT_KINDS).toEqual(
      expect.arrayContaining([
        'sheet',
        'document',
        'slides',
        'pdf',
        'dataset',
        'image',
        'video',
        'audio',
        'spatial',
        'code_object',
        'app'
      ])
    )

    const workPlan = codeObjectAgentPresetForModality('work')
    expect(workPlan.source).toContain('MermaidDiagram')
    expect(workPlan.source).toContain('DataChart')
    expect(workPlan.source).toContain('DataTable')
  })
})
