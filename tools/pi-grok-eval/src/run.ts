import { spawn, spawnSync } from 'node:child_process'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import path from 'node:path'

import {
  parseCodexUsage,
  parseFooter,
  parseGrokText,
  parseGrokUsage,
  parsePiFinalText,
  parsePiUsage,
  type TaskFooter,
  type TokenUsage
} from './parse'

const ROOT = path.resolve(import.meta.dir, '../../..')
const PAIR = process.argv.includes('sol') ? 'sol' : 'grok'
const RUN_DIR = path.join(
  tmpdir(),
  PAIR === 'sol' ? 'openpencil-pi-sol-eval' : 'openpencil-pi-grok-eval'
)
const RECORD_DIR = path.join(
  ROOT,
  PAIR === 'sol' ? '.firecrawl/pi-sol-eval' : '.firecrawl/pi-grok-eval-isolated'
)
const PI_BIN = path.join(homedir(), '.local/share/pi-node/current/bin/pi')
const GROK_BIN = path.join(homedir(), '.grok/bin/grok')
const CODEX_BIN = path.join(
  homedir(),
  '.local/share/pi-node/node-v22.23.1-darwin-arm64/lib/node_modules/ima2-gen/node_modules/@openai/codex-darwin-arm64/vendor/aarch64-apple-darwin/bin/codex'
)

type Harness = 'codex-sol' | 'grok-build' | 'pi' | 'pi-sol'
type TaskId = 'bash' | 'copy' | 'edit' | 'json' | 'read' | 'search' | 'write'

type TaskSpec = {
  id: TaskId
  prompt: (paths: EvalPaths) => string
}

type EvalPaths = {
  copyPath: string
  decoyPath: string
  fixturePath: string
  hitPath: string
  jsonPath: string
  scratchPath: string
  writePath: string
}

export type TaskResult = {
  error: string | null
  footer: TaskFooter
  harness: Harness
  model: string
  ok: boolean
  task: TaskId
  text: string
  usage: TokenUsage
  wallMs: number
}

const TASKS: TaskSpec[] = [
  {
    id: 'read',
    prompt: ({ fixturePath }) =>
      [
        `Read only this file: ${fixturePath}`,
        'Find the station code on the CODE line.',
        'Do not edit the file. Do not use mail or calendar tools.',
        'End with exactly:',
        'USED=<tool names or none>',
        'CODE=<station code or unknown>',
        'OK=yes or no'
      ].join('\n')
  },
  {
    id: 'bash',
    prompt: ({ fixturePath }) =>
      [
        `Using a shell, count the lines in ${fixturePath}.`,
        'Do not edit the file. Do not use mail or calendar tools.',
        'End with exactly:',
        'USED=<tool names or none>',
        'LINES=<number or unknown>',
        'OK=yes or no'
      ].join('\n')
  },
  {
    id: 'search',
    prompt: ({ decoyPath, hitPath }) =>
      [
        `Search these two files only: ${hitPath} and ${decoyPath}`,
        'Find the TOKEN line. Report the file that contains it.',
        'Do not edit either file. Do not use mail or calendar tools.',
        'End with exactly:',
        'USED=<tool names or none>',
        'FILE=<filename or unknown>',
        'OK=yes or no'
      ].join('\n')
  },
  {
    id: 'json',
    prompt: ({ jsonPath }) =>
      [
        `Read only this file: ${jsonPath}`,
        'Find the lead name.',
        'Do not edit the file. Do not use mail or calendar tools.',
        'End with exactly:',
        'USED=<tool names or none>',
        'NAME=<lead name or unknown>',
        'OK=yes or no'
      ].join('\n')
  },
  {
    id: 'edit',
    prompt: ({ scratchPath }) =>
      [
        `Edit only this file: ${scratchPath}`,
        'Add one new last line: probed-by-eval',
        'Do not edit any other file.',
        'End with exactly:',
        'USED=<tool names or none>',
        'EDIT=ok or no',
        'OK=yes or no'
      ].join('\n')
  },
  {
    id: 'write',
    prompt: ({ writePath }) =>
      [
        `Create only this new file: ${writePath}`,
        'Write exactly two lines:',
        'eval note',
        'HELLO=eval',
        'Do not edit any other file.',
        'End with exactly:',
        'USED=<tool names or none>',
        'WRITE=ok or no',
        'OK=yes or no'
      ].join('\n')
  },
  {
    id: 'copy',
    prompt: ({ copyPath, fixturePath }) =>
      [
        `Read ${fixturePath} and create only ${copyPath}.`,
        'The new file must contain only the station code from the CODE line, then a newline.',
        'Do not edit the source file.',
        'End with exactly:',
        'USED=<tool names or none>',
        'CODE=<station code or unknown>',
        'OK=yes or no'
      ].join('\n')
  }
]

function firstErrorLine(stderr: string): string | null {
  for (const line of stderr.split('\n')) {
    const trimmed = line.trim()
    if (trimmed) return trimmed
  }
  return null
}

function spawnCapture(
  command: string,
  args: string[],
  cwd: string,
  options: { settlePattern?: string; timeoutMs?: number } = {}
): Promise<{
  code: number | null
  settled: boolean
  stderr: string
  stdout: string
  timedOut: boolean
}> {
  const timeoutMs = options.timeoutMs ?? 150_000
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe']
    })
    let stdout = ''
    let stderr = ''
    let timedOut = false
    let settled = false
    const stop = (signal: NodeJS.Signals = 'SIGTERM'): void => {
      child.kill(signal)
    }
    const timer = setTimeout(() => {
      timedOut = true
      stderr += `timeout after ${String(timeoutMs)}ms\n`
      stop()
    }, timeoutMs)
    child.stdout.on('data', (chunk) => {
      stdout += String(chunk)
      if (!settled && options.settlePattern && stdout.includes(options.settlePattern)) {
        settled = true
        stop()
      }
    })
    child.stderr.on('data', (chunk) => {
      stderr += String(chunk)
    })
    child.on('error', (error) => {
      clearTimeout(timer)
      reject(error)
    })
    child.on('exit', (code) => {
      clearTimeout(timer)
      resolve({ code, settled, stderr, stdout, timedOut })
    })
  })
}

async function writeEvalWorkspace(): Promise<void> {
  await mkdir(RUN_DIR, { recursive: true })
  await mkdir(path.join(RUN_DIR, '.grok'), { recursive: true })
  await mkdir(RECORD_DIR, { recursive: true })
  spawnSync('git', ['init'], { cwd: RUN_DIR })
  await writeFile(
    path.join(RUN_DIR, 'pi-mcp.json'),
    `${JSON.stringify({ mcpServers: {}, settings: { freezeDirectTools: true } }, null, 2)}\n`
  )
  await writeFile(
    path.join(RUN_DIR, '.grok/config.toml'),
    [
      '[compat.cursor]',
      'agents = false',
      'rules = false',
      'skills = false',
      'mcps = false',
      '',
      '[compat.claude]',
      'agents = false',
      'rules = false',
      'skills = false',
      'mcps = false',
      ''
    ].join('\n')
  )
  await writeFile(
    path.join(RUN_DIR, 'fixture.md'),
    ['Eval fixture', 'Keep this file as-is.', 'CODE=lumen-47', 'CITY=Austin', ''].join('\n')
  )
  await writeFile(
    path.join(RUN_DIR, 'people.json'),
    `${JSON.stringify({ lead: 'mira', city: 'Austin', role: 'scout' }, null, 2)}\n`
  )
  await writeFile(
    path.join(RUN_DIR, 'notes-hit.md'),
    'field notes\nTOKEN=cedar-9\nkeep this file\n'
  )
  await writeFile(
    path.join(RUN_DIR, 'notes-miss.md'),
    'field notes\nno token here\nkeep this file\n'
  )
  for (const harness of ['pi', 'grok-build', 'pi-sol', 'codex-sol'] as const) {
    await writeFile(
      path.join(RUN_DIR, `scratch-${harness}.md`),
      'eval scratch\nleave this file in place\n'
    )
  }
}

async function runPi(
  prompt: string,
  provider: 'openai-codex' | 'xai-auth',
  model: string
): Promise<{
  lastText: string
  settled: boolean
  stderr: string
  stdout: string
  timedOut: boolean
}> {
  const result = await spawnCapture(
    PI_BIN,
    [
      '-p',
      '--provider',
      provider,
      '--model',
      model,
      '--thinking',
      'low',
      '--no-session',
      '--no-skills',
      '--no-context-files',
      '--approve',
      '--tools',
      'read,bash,edit,write,grep',
      '--mcp-config',
      path.join(RUN_DIR, 'pi-mcp.json'),
      '--mode',
      'json',
      prompt
    ],
    RUN_DIR,
    { settlePattern: '"type":"agent_settled"' }
  )
  return { ...result, lastText: '' }
}

async function runCodexSol(
  prompt: string,
  lastPath: string
): Promise<{
  lastText: string
  settled: boolean
  stderr: string
  stdout: string
  timedOut: boolean
}> {
  const result = await spawnCapture(
    CODEX_BIN,
    [
      'exec',
      '-m',
      'gpt-5.6-sol',
      '--approve-for-me',
      '--json',
      '--ephemeral',
      '--ignore-user-config',
      '--ignore-rules',
      '--color',
      'never',
      '-C',
      RUN_DIR,
      '-c',
      'model_reasoning_effort="low"',
      '-o',
      lastPath,
      prompt
    ],
    RUN_DIR
  )
  return { ...result, lastText: (await readText(lastPath)) ?? '' }
}

async function runGrok(prompt: string): Promise<{
  lastText: string
  settled: boolean
  stderr: string
  stdout: string
  timedOut: boolean
}> {
  const result = await spawnCapture(
    GROK_BIN,
    [
      '--model',
      'grok-4.6',
      '--reasoning-effort',
      'low',
      '--output-format',
      'json',
      '--always-approve',
      '--disable-web-search',
      '--no-alt-screen',
      '--cwd',
      RUN_DIR,
      '-p',
      prompt
    ],
    RUN_DIR
  )
  return { ...result, lastText: '' }
}

type HarnessResult = Awaited<ReturnType<typeof runPi>>

async function runHarness(harness: Harness, prompt: string, lastPath: string) {
  if (harness === 'pi') return runPi(prompt, 'xai-auth', 'grok-4.6')
  if (harness === 'pi-sol') return runPi(prompt, 'openai-codex', 'gpt-5.6-sol')
  if (harness === 'codex-sol') return runCodexSol(prompt, lastPath)
  return runGrok(prompt)
}

function harnessText(harness: Harness, result: HarnessResult): string {
  if (harness === 'pi' || harness === 'pi-sol') return parsePiFinalText(result.stdout)
  if (harness === 'codex-sol') return result.lastText || result.stdout
  return parseGrokText(result.stdout)
}

function harnessUsage(harness: Harness, result: HarnessResult): TokenUsage {
  if (harness === 'pi' || harness === 'pi-sol') return parsePiUsage(result.stdout)
  if (harness === 'codex-sol') return parseCodexUsage(result.stdout)
  return parseGrokUsage(result.stdout)
}

function harnessModel(harness: Harness): string {
  if (harness === 'pi') return 'xai-auth/grok-4.6'
  if (harness === 'pi-sol') return 'openai-codex/gpt-5.6-sol'
  if (harness === 'codex-sol') return 'codex-cli/gpt-5.6-sol'
  return 'grok-4.6-build'
}

function evalPaths(harness: Harness): EvalPaths {
  return {
    copyPath: path.join(RUN_DIR, `station-${harness}.txt`),
    decoyPath: path.join(RUN_DIR, 'notes-miss.md'),
    fixturePath: path.join(RUN_DIR, 'fixture.md'),
    hitPath: path.join(RUN_DIR, 'notes-hit.md'),
    jsonPath: path.join(RUN_DIR, 'people.json'),
    scratchPath: path.join(RUN_DIR, `scratch-${harness}.md`),
    writePath: path.join(RUN_DIR, `note-${harness}.txt`)
  }
}

async function readText(filePath: string): Promise<string | null> {
  try {
    return await readFile(filePath, 'utf8')
  } catch {
    return null
  }
}

function errorUnless(condition: boolean, message: string): string | null {
  return condition ? null : message
}

async function verifyTask(
  task: TaskId,
  harness: Harness,
  footer: TaskFooter
): Promise<string | null> {
  const paths = evalPaths(harness)
  const fixture = await readText(paths.fixturePath)
  if (!fixture?.includes('CODE=lumen-47')) return 'fixture changed'
  switch (task) {
    case 'read':
      return errorUnless(footer.code === 'lumen-47', 'wrong code')
    case 'bash':
      return errorUnless(footer.lines === '4', 'wrong line count')
    case 'search':
      return errorUnless(Boolean(footer.file?.includes('notes-hit.md')), 'wrong search file')
    case 'json':
      return errorUnless(footer.name === 'mira', 'wrong lead name')
    case 'edit': {
      const scratch = await readText(paths.scratchPath)
      return errorUnless(Boolean(scratch?.includes('probed-by-eval')), 'scratch missing line')
    }
    case 'write': {
      const written = await readText(paths.writePath)
      return errorUnless(Boolean(written?.includes('HELLO=eval')), 'write file missing')
    }
    case 'copy': {
      const copied = (await readText(paths.copyPath))?.trim()
      if (copied !== 'lumen-47') return 'copy file wrong'
      return errorUnless(footer.code === 'lumen-47', 'wrong copied code')
    }
  }
}

async function runOne(harness: Harness, task: TaskSpec): Promise<TaskResult> {
  const paths = evalPaths(harness)
  const prompt = task.prompt(paths)
  const started = Date.now()
  let stdout = ''
  let stderr = ''
  let lastText = ''
  let error: string | null = null
  try {
    const lastPath = path.join(RUN_DIR, 'logs', `${harness}-${task.id}.last.txt`)
    await mkdir(path.join(RUN_DIR, 'logs'), { recursive: true })
    const result = await runHarness(harness, prompt, lastPath)
    stdout = result.stdout
    stderr = result.stderr
    lastText = result.lastText
    if (result.timedOut && !result.settled) error = `timeout after 150000ms`
    else if (!stdout.trim() && !lastText.trim()) error = firstErrorLine(stderr)
  } catch (caught) {
    error = caught instanceof Error ? caught.message : String(caught)
  }
  await mkdir(path.join(RUN_DIR, 'logs'), { recursive: true })
  await writeFile(path.join(RUN_DIR, 'logs', `${harness}-${task.id}.stdout.txt`), stdout)
  await writeFile(path.join(RUN_DIR, 'logs', `${harness}-${task.id}.stderr.txt`), stderr)
  const wallMs = Date.now() - started
  const result = { lastText, settled: false, stderr, stdout, timedOut: false }
  const text = harnessText(harness, result)
  const footer = parseFooter(text)
  const usage = harnessUsage(harness, result)
  const verifyError = error ? null : await verifyTask(task.id, harness, footer)
  if (verifyError) error = verifyError
  return {
    error,
    footer,
    harness,
    model: harnessModel(harness),
    ok: footer.ok === true && error === null,
    task: task.id,
    text: text.slice(0, 2000),
    usage,
    wallMs
  }
}

async function main(): Promise<void> {
  await writeEvalWorkspace()
  const results: TaskResult[] = []
  const harnesses: Harness[] = PAIR === 'sol' ? ['codex-sol', 'pi-sol'] : ['grok-build', 'pi']
  for (const task of TASKS) {
    for (const harness of harnesses) {
      process.stderr.write(`running ${harness} ${task.id}\n`)
      results.push(await runOne(harness, task))
      const latest = results.at(-1)
      process.stderr.write(
        `  ok=${String(latest?.ok)} wall=${String(latest?.wallMs)}ms tokens=${String(latest?.usage.total)}\n`
      )
    }
  }
  const payload = `${JSON.stringify({ generatedAt: new Date().toISOString(), runDir: RUN_DIR, results }, null, 2)}\n`
  const outPath = path.join(RUN_DIR, 'results.json')
  await writeFile(outPath, payload)
  await writeFile(path.join(RECORD_DIR, 'results.json'), payload)
  process.stdout.write(`${outPath}\n`)
}

await main()
