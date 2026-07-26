import { VitePWA } from 'vite-plugin-pwa'

function rootedPath(base: string, path: string) {
  return `${base.replace(/\/$/, '')}/${path.replace(/^\//, '')}`
}

/**
 * Smylr serves OpenPencil under /open-pencil/. A service worker there keeps
 * stale boards until hard-refresh. For Smylr embeds we keep the PWA plugin
 * (virtual:pwa-register still resolves) but self-destroy any old SW and do
 * not inject a new one.
 */
export function openPencilPwaPlugin(base: string) {
  const smylrEmbed = Boolean(process.env.SMYLR_OPENPENCIL_BASE) || base.includes('open-pencil')

  return VitePWA({
    // Self-destroy for Smylr so previous dist SWs stop caching forever.
    selfDestroying: smylrEmbed,
    registerType: 'autoUpdate',
    injectRegister: smylrEmbed ? false : 'auto',
    devOptions: { enabled: false },
    workbox: {
      maximumFileSizeToCacheInBytes: 12 * 1024 * 1024,
      globPatterns: smylrEmbed ? [] : ['**/*.{js,css,html,wasm,png,ico,ttf,webmanifest}'],
      navigateFallback: smylrEmbed ? undefined : rootedPath(base, 'index.html')
    },
    manifest: {
      name: 'OpenPencil',
      short_name: 'OpenPencil',
      description: 'Open-source design editor',
      display: 'standalone',
      orientation: 'any',
      start_url: base,
      scope: base,
      theme_color: '#1e1e1e',
      background_color: '#1e1e1e',
      categories: ['design', 'productivity'],
      icons: [
        {
          src: rootedPath(base, 'pwa-192.png'),
          sizes: '192x192',
          type: 'image/png',
          purpose: 'any'
        },
        {
          src: rootedPath(base, 'pwa-512.png'),
          sizes: '512x512',
          type: 'image/png',
          purpose: 'any'
        },
        {
          src: rootedPath(base, 'pwa-maskable-512.png'),
          sizes: '512x512',
          type: 'image/png',
          purpose: 'maskable'
        }
      ]
    }
  })
}
