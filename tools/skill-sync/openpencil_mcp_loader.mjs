import { access, realpath } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'
import path from 'node:path'

const defaultSdkRoot =
  '/Users/omar/Documents/Documents - Omar’s MacBook Pro/Codex/Smylr-Elite/archive/agent-tooling/open-pencil-base/node_modules/@modelcontextprotocol/sdk'
const sdkRoot = await realpath(process.env.OPENPENCIL_MCP_SDK_ROOT || defaultSdkRoot)
const prefix = '@modelcontextprotocol/sdk/'

export async function resolve(specifier, context, nextResolve) {
  if (!specifier.startsWith(prefix)) return nextResolve(specifier, context)

  const subpath = specifier.slice(prefix.length)
  const candidate = path.join(sdkRoot, 'dist/esm', subpath)
  await access(candidate)
  return { url: pathToFileURL(candidate).href, shortCircuit: true }
}
