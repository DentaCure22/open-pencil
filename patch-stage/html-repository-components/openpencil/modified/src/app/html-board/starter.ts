import type { SceneNode } from '@open-pencil/scene-graph'
import { ref } from 'vue'

import type { EditorStore } from '@/app/editor/session'

import { createHtmlBoardFrame } from './workspace'

export const htmlBoardComposerRequest = ref(0)

export function requestHtmlBoardComposer() {
  htmlBoardComposerRequest.value += 1
}

export const HTML_BOARD_STARTER_HTML = `<main class="site" data-openpencil-component="LandingPage" data-openpencil-component-id="landing-page-1" data-openpencil-width="1440" data-openpencil-height="900">
  <nav data-openpencil-component="Navigation" data-openpencil-component-id="navigation-1"><strong>New project</strong><a href="#content">Explore</a></nav>
  <section id="content" data-openpencil-component="Hero" data-openpencil-component-id="hero-1">
    <p class="eyebrow">HTML-first canvas</p>
    <h1>Design the real interface.</h1>
    <p class="lede">Edit standard HTML and CSS, then interact with the result directly on the board.</p>
    <div class="hero-actions" data-openpencil-slot="hero-actions" data-openpencil-slot-label="Hero actions" data-openpencil-slot-accepts="ActionButton,TextLink,SmylrButton">
      <button class="op-action" type="button" aria-pressed="false" data-openpencil-component="PrimaryAction" data-openpencil-component-id="primary-action-1" data-openpencil-prop-label="Start here" data-openpencil-control-label="text" data-openpencil-bind-label="text" data-openpencil-prop-tone="solid" data-openpencil-control-tone="select" data-openpencil-options-tone="solid,soft" data-openpencil-bind-tone="attribute:data-tone" data-openpencil-variant="primary" data-tone="solid">Start here</button>
    </div>
  </section>
</main>`

export const HTML_BOARD_STARTER_CSS = `:root {
  color-scheme: light;
  --op-surface: #f5f5f2;
  --op-text: #171717;
  --op-muted: #666666;
  --op-accent: #3159d9;
  --op-control-radius: 10px;
  --op-page-x: 64px;
  --op-font: Inter, system-ui, sans-serif;
  font-family: var(--op-font);
}
* { box-sizing: border-box; }
body { margin: 0; background: var(--op-surface); color: var(--op-text); }
.site { width: 100%; min-height: 100vh; padding: 48px var(--op-page-x); }
nav { display: flex; justify-content: space-between; align-items: center; }
nav a { color: inherit; text-decoration: none; }
section { max-width: 760px; margin-top: 190px; }
.eyebrow { color: var(--op-accent); font-size: 13px; font-weight: 700; text-transform: uppercase; letter-spacing: .08em; }
h1 { margin: 12px 0; font-size: 72px; line-height: .98; letter-spacing: -.05em; }
.lede { max-width: 620px; color: var(--op-muted); font-size: 20px; line-height: 1.5; }
.hero-actions { display: flex; align-items: center; gap: 12px; margin-top: 24px; }
.op-action { display: inline-flex; align-items: center; justify-content: center; min-height: 44px; border: 0; border-radius: var(--op-control-radius); padding: 0 18px; background: var(--op-text); color: white; font: inherit; font-weight: 650; }
button[data-tone="soft"] { background: var(--op-accent); }
button[aria-pressed="true"] { background: var(--op-accent); }
@media (max-width: 600px) {
  .site { padding: 28px 22px; }
  section { margin-top: 120px; }
  h1 { font-size: 48px; }
  .lede { font-size: 17px; }
}`

export const HTML_BOARD_STARTER_JS = `const action = document.querySelector('[data-openpencil-component="PrimaryAction"]')
action?.addEventListener('click', () => {
  const isActive = action.getAttribute('aria-pressed') === 'true'
  const restingLabel = action.getAttribute('data-openpencil-prop-label') || 'Start here'
  action.setAttribute('aria-pressed', String(!isActive))
  action.textContent = isActive ? restingLabel : 'Started'
})`

export function createStarterHtmlBoard(store: EditorStore): SceneNode {
  return createHtmlBoardFrame(
    store,
    HTML_BOARD_STARTER_HTML,
    HTML_BOARD_STARTER_CSS,
    HTML_BOARD_STARTER_JS
  )
}
