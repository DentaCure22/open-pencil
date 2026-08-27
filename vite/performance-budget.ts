import { relative } from 'node:path'
import { gzipSync } from 'node:zlib'

import type { OutputChunk } from 'rollup'
import type { Plugin } from 'vite'

export const INITIAL_JAVASCRIPT_RAW_BUDGET_BYTES = 4_750_000
export const INITIAL_JAVASCRIPT_GZIP_BUDGET_BYTES = 1_300_000

export interface JavaScriptBundleSize {
  gzipBytes: number
  rawBytes: number
}

export function measureJavaScriptBundle(code: string): JavaScriptBundleSize {
  const bytes = Buffer.from(code)
  return {
    gzipBytes: gzipSync(bytes).byteLength,
    rawBytes: bytes.byteLength
  }
}

function megabytes(bytes: number) {
  return `${(bytes / 1_000_000).toFixed(2)} MB`
}

function largestRenderedModules(entry: OutputChunk, limit = 12): string[] {
  return Object.entries(entry.modules)
    .map(([id, module]) => ({
      id: relative(process.cwd(), id),
      renderedLength: module.renderedLength
    }))
    .sort((left, right) => right.renderedLength - left.renderedLength)
    .slice(0, limit)
    .map(({ id, renderedLength }) => `  ${megabytes(renderedLength)}  ${id}`)
}

export function initialJavaScriptBudgetError(size: JavaScriptBundleSize): string | null {
  const violations = [
    size.rawBytes > INITIAL_JAVASCRIPT_RAW_BUDGET_BYTES
      ? `raw ${megabytes(size.rawBytes)} > ${megabytes(INITIAL_JAVASCRIPT_RAW_BUDGET_BYTES)}`
      : null,
    size.gzipBytes > INITIAL_JAVASCRIPT_GZIP_BUDGET_BYTES
      ? `gzip ${megabytes(size.gzipBytes)} > ${megabytes(INITIAL_JAVASCRIPT_GZIP_BUDGET_BYTES)}`
      : null
  ].filter((violation): violation is string => violation !== null)
  return violations.length > 0
    ? `Initial JavaScript budget exceeded: ${violations.join(', ')}`
    : null
}

export function initialJavaScriptBudgetPlugin(): Plugin {
  return {
    apply: 'build',
    name: 'openpencil-initial-javascript-budget',
    generateBundle(_options, bundle) {
      const entry = Object.values(bundle).find(
        (output) =>
          output.type === 'chunk' && output.isEntry && output.facadeModuleId?.endsWith('index.html')
      )
      if (!entry || entry.type !== 'chunk') return
      const error = initialJavaScriptBudgetError(measureJavaScriptBundle(entry.code))
      if (error) {
        const modules = largestRenderedModules(entry)
        this.error(`${error}\nLargest initial modules:\n${modules.join('\n')}`)
      }
    }
  }
}
