import { describe, expect, test } from 'bun:test'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

import {
  antigravityActivities,
  antigravityResolvedOutput,
  antigravityThoughtText,
  antigravityToolImages
} from '#mcp/pi/antigravity-activity'

describe('Antigravity thought text', () => {
  test('keeps leftover thinking after stripping tool markers and incomplete tails', () => {
    expect(
      antigravityThoughtText(
        [
          '**Analyzing Chat Data**',
          '',
          'I found the Layali chat.',
          '[agy tool: view_file]',
          '[agy input]',
          '{"AbsolutePath":"README.md"}',
          '[/agy input]',
          '[agy output]',
          'File contents',
          '[/agy output]',
          'Next I will send the text.',
          '[agy tool: call_mcp_tool]',
          '[agy input]',
          '{"name":"Layali"}'
        ].join('\n')
      )
    ).toBe('**Analyzing Chat Data**\n\nI found the Layali chat.\n\nNext I will send the text.')
    expect(antigravityThoughtText('[agy tool: view_file]\n')).toBe('')
    expect(antigravityThoughtText('thinking')).toBe('')
  })

  test('inlines an offloaded tool dump instead of leaving a saved-to path', () => {
    const path = join(mkdtempSync(join(tmpdir(), 'agy-output-')), 'output.txt')
    writeFileSync(path, 'Found 21 tools matching "gmail".')
    const notice = `The output was large and was saved to: ${pathToFileURL(path).href}`

    expect(antigravityResolvedOutput('call_mcp_tool', notice)).toBe(
      'Found 21 tools matching "gmail".'
    )
    expect(
      antigravityActivities(
        [
          '[agy tool: call_mcp_tool]',
          '[agy input]',
          '{"Arguments":{"search":"gmail"},"ToolName":"mcp"}',
          '[/agy input]',
          '[agy output]',
          notice,
          '[/agy output]'
        ].join('\n'),
        (value) => (typeof value === 'string' ? value : '')
      )
    ).toEqual([
      {
        input: '{"Arguments":{"search":"gmail"},"ToolName":"mcp"}',
        name: 'connected_app_search',
        output: 'Found 21 tools matching "gmail".',
        type: 'tool'
      }
    ])
  })

  test('upgrades a name-only file read when input and output arrive later', () => {
    expect(
      antigravityActivities(
        [
          '[agy tool: view_file]',
          '[agy tool: view_file]',
          '[agy input]',
          '{"AbsolutePath":"README.md"}',
          '[/agy input]',
          '[agy output]',
          'File contents',
          '[/agy output]'
        ].join('\n'),
        (value) => (typeof value === 'string' ? value : '')
      )
    ).toEqual([
      {
        input: '{"AbsolutePath":"README.md"}',
        name: 'view_file',
        output: 'File contents',
        type: 'tool'
      }
    ])
  })
})

describe('Antigravity image activity', () => {
  test('attaches an edited image returned as a singular result path', () => {
    const imagePath = resolve('packages/demos/videos/toolbar.png')
    const images = antigravityToolImages(
      'ima2-media_edit_image',
      JSON.stringify({ result: { ok: true, path: imagePath }, status: 'completed' })
    )

    expect(images).toEqual([
      { alt: 'ima2-media_edit_image image', url: expect.stringContaining('data:image/png;base64,') }
    ])
  })
})
