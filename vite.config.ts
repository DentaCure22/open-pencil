import process from 'node:process'

import tailwindcss from '@tailwindcss/vite'
import vue from '@vitejs/plugin-vue'
import IconsResolver from 'unplugin-icons/resolver'
import Icons from 'unplugin-icons/vite'
import Components from 'unplugin-vue-components/vite'
import { defineConfig } from 'vite'

import packageJson from './package.json'
import { createOpenPencilAliases } from './vite/aliases'
import { localAutomationToken, openPencilAutomationPlugin } from './vite/automation'
import { copyCanvasKitAssetsPlugin } from './vite/canvaskit-assets'
import { openPencilPwaPlugin } from './vite/pwa'
import { rawMarkdownPlugin } from './vite/raw-markdown'
import { createDevServerOptions } from './vite/server'

const host = process.env.TAURI_DEV_HOST
const base =
  process.env.SMYLR_OPENPENCIL_BASE ?? (process.argv.includes('build') ? '/open-pencil/' : '/')
const smylrEmbed = Boolean(process.env.SMYLR_OPENPENCIL_BASE) || base.includes('open-pencil')

export default defineConfig(async ({ command }) => ({
  base,
  resolve: {
    alias: createOpenPencilAliases(__dirname),
    dedupe: ['@univerjs/core', '@wendellhu/redi', 'react', 'react-dom', 'rxjs']
  },
  define: {
    __OPENPENCIL_APP_VERSION__: JSON.stringify(packageJson.version),
    __OPENPENCIL_LOCAL_AUTOMATION_TOKEN__: JSON.stringify(localAutomationToken(command)),
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
    openPencilAutomationPlugin(command, host),
    vue(),
    openPencilPwaPlugin(base)
  ],
  clearScreen: false,
  build: {
    chunkSizeWarningLimit: 2500
  },
  optimizeDeps: {
    // These local source aliases import raw Markdown/Kiwi assets that must pass through
    // rawMarkdownPlugin instead of Rolldown's dependency scanner.
    exclude: ['@open-pencil/core', '@open-pencil/kiwi']
  },
  server: {
    ...createDevServerOptions({ host, smylrEmbed }),
    // Keep the tab usable if a non-board module hiccups
    hmr: {
      ...createDevServerOptions({ host, smylrEmbed }).hmr,
      overlay: true
    }
  }
}))
