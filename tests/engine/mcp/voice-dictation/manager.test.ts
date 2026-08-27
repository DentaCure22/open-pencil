import { expect, test } from 'bun:test'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { AgyVoiceDictationManager } from '#mcp/voice-dictation/manager'

async function waitForPhase(manager: AgyVoiceDictationManager, sessionId: string, phase: string) {
  const deadline = Date.now() + 3_000
  while (Date.now() < deadline) {
    const snapshot = manager.read(sessionId)
    if (snapshot?.phase === phase) return snapshot
    await Bun.sleep(20)
  }
  throw new Error(`Voice session did not reach ${phase}`)
}

test('voice dictation manager keeps one helper session and returns its exact transcript', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'openpencil-agy-voice-'))
  const helper = path.join(root, 'fake-helper.py')
  await writeFile(
    helper,
    [
      'import json, os, socket, sys, threading, time',
      'host, port = os.environ["ANTIGRAVITY_MIC"].rsplit(":", 1)',
      'time.sleep(0.02)',
      'mic = socket.create_connection((host, int(port)))',
      'audio = bytearray()',
      'def receive_audio():',
      '    while True:',
      '        chunk = mic.recv(65536)',
      '        if not chunk:',
      '            return',
      '        audio.extend(chunk)',
      'threading.Thread(target=receive_audio, daemon=True).start()',
      'print(json.dumps({"phase": "starting"}), flush=True)',
      'print(json.dumps({"phase": "recording"}), flush=True)',
      'for line in sys.stdin:',
      '    command = json.loads(line).get("command")',
      '    if command == "stop":',
      '        time.sleep(0.05)',
      '        print(json.dumps({"phase": "finishing"}), flush=True)',
      '        print(json.dumps({"phase": "ready", "transcript": audio.hex()}), flush=True)',
      '        break',
      '    if command == "cancel":',
      '        print(json.dumps({"phase": "cancelled"}), flush=True)',
      '        break'
    ].join('\n')
  )
  const manager = new AgyVoiceDictationManager({
    agyBinary: '/tmp/fake-agy',
    cwd: root,
    helperPath: helper,
    pythonBinary: 'python3'
  })

  try {
    await manager.ready()
    const started = manager.start()
    await waitForPhase(manager, started.sessionId, 'recording')
    expect(manager.active()?.sessionId).toBe(started.sessionId)
    expect(() => manager.start()).toThrow('already active')

    expect(manager.writeAudio(started.sessionId, new Uint8Array([0, 1, 127, 255]))).toBe(true)
    manager.stop(started.sessionId)
    const ready = await waitForPhase(manager, started.sessionId, 'ready')
    expect(ready.transcript).toBe('00017fff')
    expect(manager.active()).toBeNull()
  } finally {
    manager.close()
    await rm(root, { force: true, recursive: true })
  }
})

test('voice dictation manager exposes revised transcript snapshots before stop', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'openpencil-agy-voice-live-'))
  const helper = path.join(root, 'fake-helper.py')
  await writeFile(
    helper,
    [
      'import json, sys, time',
      'print(json.dumps({"phase": "recording", "transcript": "Open pensil"}), flush=True)',
      'time.sleep(0.03)',
      'print(json.dumps({"phase": "recording", "transcript": "Open Pencil streams live"}), flush=True)',
      'for line in sys.stdin:',
      '    if json.loads(line).get("command") == "cancel":',
      '        print(json.dumps({"phase": "cancelled"}), flush=True)',
      '        break'
    ].join('\n')
  )
  const manager = new AgyVoiceDictationManager({
    agyBinary: '/tmp/fake-agy',
    cwd: root,
    helperPath: helper,
    pythonBinary: 'python3'
  })

  try {
    await manager.ready()
    const started = manager.start()
    const live = await waitForPhase(manager, started.sessionId, 'recording')
    const deadline = Date.now() + 1_000
    let transcript = live.transcript
    while (transcript !== 'Open Pencil streams live' && Date.now() < deadline) {
      await Bun.sleep(10)
      transcript = manager.read(started.sessionId)?.transcript ?? ''
    }
    expect(transcript).toBe('Open Pencil streams live')
  } finally {
    manager.close()
    await rm(root, { force: true, recursive: true })
  }
})

test('voice dictation manager validates bounded context before starting a helper', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'openpencil-agy-voice-context-'))
  const manager = new AgyVoiceDictationManager({
    agyBinary: '/tmp/fake-agy',
    cwd: root,
    helperPath: path.join(root, 'unused-helper.py'),
    pythonBinary: 'python3'
  })

  try {
    await manager.ready()
    expect(() => manager.start({ active: { composerText: 'x'.repeat(25 * 1024) } })).toThrow(
      'Voice context is too large'
    )
  } finally {
    manager.close()
    await rm(root, { force: true, recursive: true })
  }
})
