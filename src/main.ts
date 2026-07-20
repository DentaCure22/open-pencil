if (import.meta.env.DEV) {
  void import('react-grab')
}

import { createHead } from '@unhead/vue/client'
import { createApp } from 'vue'

import './app.css'
import { fadeOutGlobalLoader } from '@/app/editor/canvas/loader-overlay'
import { preloadFonts } from '@/app/editor/fonts'
import { canonicalSmylrOpenPencilUrlFor } from '@/app/smylr-live-inspector/frame-origin'
import { IS_BROWSER, IS_TAURI } from '@/constants'

import App from './App.vue'
import router from './router'

declare const __SMYLR_OPENPENCIL_EMBED__: boolean | undefined

// Smylr /open-pencil embed: never register a service worker (stale caches).
const smylrEmbed = __SMYLR_OPENPENCIL_EMBED__ !== undefined && __SMYLR_OPENPENCIL_EMBED__
const canonicalOpenPencilUrl =
  smylrEmbed && IS_BROWSER ? canonicalSmylrOpenPencilUrlFor(window.location.href) : null

if (canonicalOpenPencilUrl && canonicalOpenPencilUrl !== window.location.href) {
  window.location.replace(canonicalOpenPencilUrl)
} else {
  preloadFonts()
  const head = createHead()
  createApp(App).use(router).use(head).mount('#app')
}

if (smylrEmbed && typeof navigator !== 'undefined' && 'serviceWorker' in navigator) {
  void navigator.serviceWorker.getRegistrations().then((regs) => {
    for (const reg of regs) void reg.unregister()
    return undefined
  })
} else if (!IS_TAURI && !smylrEmbed) {
  void import('virtual:pwa-register').then(({ registerSW }) => {
    registerSW({ immediate: true })
    return undefined
  })
}

// Failsafe: never leave the splash up forever if canvas init stalls.
if (IS_BROWSER) {
  window.setTimeout(() => fadeOutGlobalLoader(), 6000)
}

// Intentionally NO window.location.reload() on dist change.
// Live board edits use Vite HMR + in-place graph updates (`pnpm open-pencil:dev`).
