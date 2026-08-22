import { randomUUID } from 'node:crypto'
import { chmod, mkdir, readFile, readdir, rename, stat, unlink, writeFile } from 'node:fs/promises'
import path from 'node:path'

function errorCode(error: unknown): string | null {
  if (!error || typeof error !== 'object' || !('code' in error)) return null
  return typeof error.code === 'string' ? error.code : null
}

export async function readJsonFile(filePath: string): Promise<unknown | null> {
  try {
    return JSON.parse(await readFile(filePath, 'utf8')) as unknown
  } catch (error) {
    if (errorCode(error) === 'ENOENT') return null
    throw error
  }
}

async function writeFileAtomically(filePath: string, value: string | Uint8Array): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true })
  const temporaryPath = `${filePath}.${randomUUID()}.tmp`
  try {
    await writeFile(temporaryPath, value, { mode: 0o600 })
    await rename(temporaryPath, filePath)
    await chmod(filePath, 0o600)
  } catch (error) {
    await unlink(temporaryPath).catch(() => undefined)
    throw error
  }
}

export async function writeBinaryFile(filePath: string, value: Uint8Array): Promise<void> {
  await writeFileAtomically(filePath, value)
}

export async function writeJsonFile(filePath: string, value: unknown): Promise<void> {
  await writeFileAtomically(filePath, `${JSON.stringify(value, null, 2)}\n`)
}

export async function jsonFileMarker(filePath: string): Promise<string> {
  try {
    const details = await stat(filePath, { bigint: true })
    return `${details.ino}:${details.size}:${details.mtimeNs}`
  } catch (error) {
    if (errorCode(error) === 'ENOENT') return 'missing'
    throw error
  }
}

function historyFileName(revision: number, contentHash: string): string {
  return `${String(revision).padStart(10, '0')}-${contentHash}.json`
}

export async function writeJsonHistory(
  historyPath: string,
  revision: number,
  contentHash: string,
  value: unknown
): Promise<void> {
  await writeFileAtomically(
    path.join(historyPath, historyFileName(revision, contentHash)),
    `${JSON.stringify(value)}\n`
  )
}

export async function readJsonHistory(
  historyPath: string,
  revision: number
): Promise<unknown | null> {
  const prefix = `${String(revision).padStart(10, '0')}-`
  try {
    const fileName = (await readdir(historyPath)).find(
      (candidate) => candidate.startsWith(prefix) && candidate.endsWith('.json')
    )
    return fileName ? readJsonFile(path.join(historyPath, fileName)) : null
  } catch (error) {
    if (errorCode(error) === 'ENOENT') return null
    throw error
  }
}

export async function findJsonHistoryRevisionByHash(
  historyPath: string,
  contentHash: string
): Promise<number | null> {
  let matchingFileNames: string[]
  try {
    matchingFileNames = (await readdir(historyPath)).filter(
      (fileName) => fileName.endsWith(`-${contentHash}.json`) && /^\d{10}-/.test(fileName)
    )
  } catch (error) {
    if (errorCode(error) === 'ENOENT') return null
    throw error
  }
  const fileName = matchingFileNames.sort().at(-1)
  return fileName ? Number.parseInt(fileName.slice(0, 10), 10) : null
}

export async function pruneJsonHistory(historyPath: string, limit: number): Promise<void> {
  let fileNames: string[]
  try {
    fileNames = (await readdir(historyPath))
      .filter((fileName) => /^\d{10}-[a-f0-9]+\.json$/.test(fileName))
      .sort()
  } catch (error) {
    if (errorCode(error) === 'ENOENT') return
    throw error
  }
  await Promise.all(
    fileNames
      .slice(0, Math.max(0, fileNames.length - limit))
      .map((fileName) => unlink(path.join(historyPath, fileName)))
  )
}
