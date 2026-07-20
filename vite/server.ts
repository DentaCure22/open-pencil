import { normalizePath, type ServerOptions } from 'vite'

const WATCHED_MARKDOWN_ROOTS = ['/src/', '/packages/core/src/', '/packages/vue/src/']

function ignoreMarkdownOutsideSource(path: string): boolean {
  const normalized = normalizePath(path)
  if (!normalized.endsWith('.md')) return false
  return !WATCHED_MARKDOWN_ROOTS.some((root) => normalized.includes(root))
}

export const WATCH_IGNORED = [
  '**/desktop/**',
  '**/packages/cli/**',
  '**/packages/mcp/**',
  '**/packages/docs/**',
  '**/tests/**',
  '**/.worktrees/**',
  '**/.github/**',
  '**/.pi/**',
  ignoreMarkdownOutsideSource
]

export type OpenPencilDevServerOptions = {
  host?: string
  /** When true, HMR websocket hits Vite directly while the page is on Next :3000. */
  smylrEmbed?: boolean
  port?: number
}

/**
 * Dev server for OpenPencil.
 *
 * Smylr embed mode (`SMYLR_OPENPENCIL_BASE=/open-pencil/`):
 * - Page is opened via Next at localhost:3000/open-pencil/*
 * - Next proxies HTTP to this Vite server
 * - HMR WebSocket connects to Vite port directly (clientPort) so HMR works
 *   without Next websocket proxying
 */
export function createDevServerOptions(options: OpenPencilDevServerOptions = {}): ServerOptions {
  const host = options.host
  const port = options.port ?? Number(process.env.OPENPENCIL_VITE_PORT || 1420)
  const smylrEmbed = options.smylrEmbed ?? false

  return {
    port,
    strictPort: true,
    host: host || '127.0.0.1',
    cors: true,
    // Allow Next (3000) to load Vite modules / HMR client
    origin: smylrEmbed ? `http://127.0.0.1:${port}` : undefined,
    hmr: smylrEmbed
      ? {
          // Browser page is on :3000; WS goes straight to Vite :1420
          protocol: 'ws',
          host: '127.0.0.1',
          port,
          clientPort: port
        }
      : host
        ? {
            protocol: 'ws',
            host,
            port: port + 1
          }
        : undefined,
    watch: {
      ignored: WATCH_IGNORED
    }
  }
}
