import { expect, test } from 'bun:test'
import { spawnSync } from 'node:child_process'
import path from 'node:path'

const helperPath = path.resolve('packages/mcp/src/voice-dictation/agy-voice-helper.py')

test('voice helper reconstructs a revised live transcript from the agy terminal screen', () => {
  const terminalOutput = [
    '\r\n\n● Recording 00:02\x1b[2A\x1b[3GOpen pensil\x1b[K',
    '\r\n\n● Recording 00:03\x1b[2A\x1b[8GPencil\x1b[K',
    '\r\n\n● Recording 00:04\x1b[2A\x1b[14G streams live\x1b[K'
  ].join('')
  const result = spawnSync(
    'python3',
    [
      '-c',
      [
        'import importlib.util, sys',
        `spec = importlib.util.spec_from_file_location("agy_voice_helper", ${JSON.stringify(helperPath)})`,
        'helper = importlib.util.module_from_spec(spec)',
        'spec.loader.exec_module(helper)',
        'screen = helper.TerminalScreen(34, 120)',
        'screen.feed(sys.stdin.read())',
        'print(helper.screen_dictation_transcript(screen))'
      ].join('; ')
    ],
    { encoding: 'utf8', input: terminalOutput }
  )

  expect(result.status).toBe(0)
  expect(result.stdout.trim()).toBe('Open Pencil streams live')
})

test('voice helper removes terminal borders left behind in a live partial', () => {
  const result = spawnSync(
    'python3',
    [
      '-c',
      [
        'import importlib.util',
        `spec = importlib.util.spec_from_file_location("agy_voice_helper", ${JSON.stringify(helperPath)})`,
        'helper = importlib.util.module_from_spec(spec)',
        'spec.loader.exec_module(helper)',
        'print(helper.clean_screen_transcript("Change the──────────────── wing color."))'
      ].join('; ')
    ],
    { encoding: 'utf8' }
  )

  expect(result.status).toBe(0)
  expect(result.stdout.trim()).toBe('Change the wing color.')
})

test('voice helper prepares the hidden agy conversation without project-specific bias', () => {
  const result = spawnSync(
    'python3',
    [
      '-c',
      [
        'import argparse, importlib.util, json',
        `spec = importlib.util.spec_from_file_location("agy_voice_helper", ${JSON.stringify(helperPath)})`,
        'helper = importlib.util.module_from_spec(spec)',
        'spec.loader.exec_module(helper)',
        'args = argparse.Namespace(agy="agy")',
        'print(json.dumps(helper.agy_command(args)))'
      ].join('; ')
    ],
    { encoding: 'utf8' }
  )

  expect(result.status).toBe(0)
  const command = JSON.parse(result.stdout) as string[]
  expect(command.slice(0, 4)).toEqual(['agy', '--mode', 'plan', '--prompt-interactive'])
  expect(command.at(-1)).toContain('OPENPENCIL_VOICE_CONTEXT_READY')
  expect(command.at(-1)).not.toContain('Dental')
  expect(command).not.toContain('--add-dir')
})
