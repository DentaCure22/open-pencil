import { describe, expect, test } from 'bun:test'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import {
  FALLBACK_PI_MODELS,
  loadPiAgentModels,
  parsePiListModels,
  validatePiSelection
} from '#mcp/pi/catalog'

const LISTED = `
provider      model                          context  max-out  thinking  images
cursor        composer-2.5-fast              200K     64K      yes       no
cursor        cursor-grok-4.6-fast           200K     64K      yes       no
cursor        claude-opus-5                  200K     64K      yes       no
antigravity   gemini-3-1-pro                 1.0M     65.5K    yes       no
antigravity   gemini-3-7-flash               1.0M     65.5K    yes       no
antigravity   claude-sonnet-4-6              1.0M     65.5K    no        no
openai-codex  gpt-5.6-luna                   272K     128K     yes       yes
openai-codex  gpt-5.6-sol                    272K     128K     yes       yes
openai-codex  gpt-5.6-terra                  272K     128K     yes       yes
openai-codex  gpt-5.3-codex-spark            128K     128K     yes       no
openai-codex  gpt-5.4                        272K     128K     yes       yes
xai           grok-4.6                       500K     32K      yes       yes
xai           grok-4.5                       500K     32K      yes       yes
xai-auth      grok-4.6                       500K     131.1K   yes       yes
xai-auth      grok-composer-2.5-fast         500K     30K      no        yes
zenmux        moonshotai/kimi-k3-free        1.0M     32K      yes       yes
`

describe('Pi model catalog', () => {
  test('keeps the fallback list when no Pi files exist', () => {
    expect(
      loadPiAgentModels({
        authPath: '/missing-auth',
        settingsPath: '/missing-settings',
        skipCli: true,
        storePath: '/missing-store'
      })
    ).toEqual(FALLBACK_PI_MODELS)
  })

  test('parses the live Pi list and keeps enabled providers', () => {
    const models = parsePiListModels(LISTED, {
      defaultProvider: 'xai-auth',
      defaultThinkingLevel: 'high',
      enabledModels: [
        'openai-codex/gpt-5.6-luna:high',
        'openai-codex/gpt-5.6-sol:high',
        'openai-codex/gpt-5.6-terra:high',
        'cursor/composer-2.5-fast',
        'cursor/cursor-grok-4.6-fast:high',
        'xai-auth/grok-4.6:high',
        'xai-auth/grok-composer-2.5-fast',
        'antigravity/gemini-3-1-pro:high',
        'antigravity/gemini-3-7-flash:high'
      ]
    })
    expect(models.map((model) => model.id)).toEqual([
      'cursor/composer-2.5-fast',
      'cursor/cursor-grok-4.6-fast',
      'antigravity/gemini-3-1-pro',
      'antigravity/gemini-3-7-flash',
      'openai-codex/gpt-5.6-luna',
      'openai-codex/gpt-5.6-sol',
      'openai-codex/gpt-5.6-terra',
      'xai-auth/grok-4.6',
      'xai-auth/grok-composer-2.5-fast'
    ])
    expect(models.find((model) => model.id === 'xai-auth/grok-composer-2.5-fast')?.efforts).toEqual(
      ['medium']
    )
    expect(models.find((model) => model.id === 'cursor/composer-2.5-fast')).toMatchObject({
      defaultEffort: 'medium',
      efforts: ['medium']
    })
    expect(models.find((model) => model.id === 'cursor/cursor-grok-4.6-fast')?.efforts).toEqual([
      'low',
      'medium',
      'high',
      'xhigh'
    ])
    expect(models.find((model) => model.id === 'antigravity/gemini-3-7-flash')).toMatchObject({
      defaultEffort: 'high',
      efforts: ['low', 'medium', 'high'],
      group: 'Antigravity'
    })
    expect(models.find((model) => model.id === 'antigravity/gemini-3-1-pro')?.efforts).toEqual([
      'low',
      'high'
    ])
    expect(models.find((model) => model.id === 'openai-codex/gpt-5.6-sol')?.efforts).toEqual([
      'low',
      'medium',
      'high',
      'xhigh',
      'max'
    ])
  })

  test('prefers the Pi settings default over the store-only API slug', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'pi-catalog-'))
    const storePath = path.join(root, 'models-store.json')
    const authPath = path.join(root, 'auth.json')
    const settingsPath = path.join(root, 'settings.json')
    await writeFile(
      storePath,
      JSON.stringify({
        xai: {
          models: [
            { id: 'grok-4.6', name: 'Grok 4.6', thinkingLevelMap: { high: 'high', low: 'low' } }
          ]
        },
        openai: {
          models: [{ id: 'gpt-4o', name: 'GPT-4o' }]
        }
      })
    )
    await writeFile(authPath, JSON.stringify({ xai: { type: 'oauth' } }))
    await writeFile(
      settingsPath,
      JSON.stringify({
        defaultModel: 'grok-4.6',
        defaultProvider: 'xai-auth',
        defaultThinkingLevel: 'high',
        enabledModels: [
          'openai-codex/gpt-5.6-luna:high',
          'openai-codex/gpt-5.6-sol:high',
          'openai-codex/gpt-5.6-terra:high',
          'cursor/composer-2.5-fast',
          'cursor/cursor-grok-4.6-fast:high',
          'xai-auth/grok-4.6:high',
          'xai-auth/grok-composer-2.5-fast',
          'antigravity/gemini-3-1-pro:high',
          'antigravity/gemini-3-7-flash:high'
        ]
      })
    )

    const models = loadPiAgentModels({
      authPath,
      listedText: LISTED,
      settingsPath,
      storePath
    })
    expect(models[0]?.id).toBe('xai-auth/grok-4.6')
    expect(models.map((model) => model.id)).not.toContain('xai/grok-4.6')
    expect(models.map((model) => model.id)).toContain('cursor/composer-2.5-fast')
    expect(validatePiSelection(models, 'cursor/composer-2.5-fast')).toEqual({
      effort: 'medium',
      model: 'cursor/composer-2.5-fast'
    })
  })
})
