import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: {
    index: './src/index.ts',
    'local-workspace-authority': './src/local-workspace-authority.ts',
    'usage-ledger-schema': './src/usage-ledger-schema.ts',
    server: './src/server.ts',
    stdio: './src/stdio.ts',
    'dispatch-stdio': './src/dispatch-stdio.ts'
  },
  platform: 'node',
  format: ['esm'],
  dts: true,
  sourcemap: true,
  clean: true,
  outDir: './dist',
  treeshake: false,
  deps: {
    neverBundle: [
      '@hono/node-server',
      '@modelcontextprotocol/sdk',
      '@open-pencil/core',
      /^@open-pencil\/core\//,
      '@open-pencil/scene-graph',
      /^@open-pencil\/scene-graph\//,
      'hono',
      /^hono\//,
      'package-manager-detector',
      /^package-manager-detector\//,
      'ws',
      'zod',
      /^node:/
    ],
    onlyBundle: false
  }
})
