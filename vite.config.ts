import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import process from 'node:process'

import tailwindcss from '@tailwindcss/vite'
import vue from '@vitejs/plugin-vue'
import IconsResolver from 'unplugin-icons/resolver'
import Icons from 'unplugin-icons/vite'
import Components from 'unplugin-vue-components/vite'
import { defineConfig, loadEnv } from 'vite'

import packageJson from './package.json'
import { createOpenPencilAliases } from './vite/aliases'
import { copyCanvasKitAssetsPlugin } from './vite/canvaskit-assets'
import {
  localWorkspaceAuthorityToken,
  openPencilLocalWorkspaceAuthorityPlugin
} from './vite/local-workspace-authority'
import { initialJavaScriptBudgetPlugin } from './vite/performance-budget'
import { openPencilPwaPlugin } from './vite/pwa'
import { rawMarkdownPlugin } from './vite/raw-markdown'
import { createDevServerOptions } from './vite/server'

const host = process.env.TAURI_DEV_HOST
const base =
  process.env.SMYLR_OPENPENCIL_BASE ?? (process.argv.includes('build') ? '/open-pencil/' : '/')
const smylrEmbed = Boolean(process.env.SMYLR_OPENPENCIL_BASE) || base.includes('open-pencil')

export default defineConfig(async ({ command, mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const workspaceCacheKey = createHash('sha256').update(process.cwd()).digest('hex').slice(0, 12)
  return {
    base,
    cacheDir:
      env.OPENPENCIL_VITE_CACHE_DIR?.trim() || join(tmpdir(), 'openpencil-vite', workspaceCacheKey),
    resolve: {
      alias: createOpenPencilAliases(__dirname),
      dedupe: ['@univerjs/core', '@wendellhu/redi', 'react', 'react-dom', 'rxjs']
    },
    define: {
      __OPENPENCIL_APP_VERSION__: JSON.stringify(packageJson.version),
      __OPENPENCIL_LOCAL_AUTHORITY_TOKEN__: JSON.stringify(localWorkspaceAuthorityToken(command)),
      // Skip SW registration for Smylr static embeds (avoids stale board caches).
      __SMYLR_OPENPENCIL_EMBED__: JSON.stringify(smylrEmbed),
      // True when `vite` dev server (not production build) — enables HMR reseed hooks.
      __OPENPENCIL_VITE_DEV__: JSON.stringify(command === 'serve')
    },
    plugins: [
      rawMarkdownPlugin(),
      copyCanvasKitAssetsPlugin(),
      tailwindcss(),
      Icons({ compiler: 'vue3' }),
      Components({ resolvers: [IconsResolver({ prefix: 'icon' })] }),
      openPencilLocalWorkspaceAuthorityPlugin(command, host, {
        localWorkspaceId: env.OPENPENCIL_LOCAL_WORKSPACE_ID?.trim(),
        localWorkspaceRoot: env.OPENPENCIL_LOCAL_WORKSPACE_ROOT?.trim(),
        smylrAppRoot: env.OPENPENCIL_SMYLR_APP_ROOT?.trim()
      }),
      vue(),
      openPencilPwaPlugin(base),
      initialJavaScriptBudgetPlugin()
    ],
    clearScreen: false,
    build: {
      chunkSizeWarningLimit: 2500
    },
    optimizeDeps: {
      // These local source aliases import raw Markdown/Kiwi assets that must pass through
      // rawMarkdownPlugin instead of Rolldown's dependency scanner.
      exclude: ['@open-pencil/core', '@open-pencil/kiwi'],
      // Code Objects and Board capture are loaded on demand. Prebundle their runtimes so
      // the first interaction does not invalidate the dependency graph mid-session.
      include: [
        'html2canvas',
        'mermaid',
        'react',
        'react-dom/client',
        'react/jsx-dev-runtime',
        'recharts'
      ]
    },
    server: {
      ...createDevServerOptions({ host, smylrEmbed }),
      // Keep the tab usable if a non-board module hiccups
      hmr: {
        ...createDevServerOptions({ host, smylrEmbed }).hmr,
        overlay: true
      }
    }
  }
})
