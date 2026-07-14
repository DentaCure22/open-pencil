import type { SceneNode } from '@open-pencil/scene-graph'

import type { EditorStore } from '@/app/editor/session'

import { createHtmlBoardFrame } from './workspace'

export const HTML_BOARD_STARTER_HTML = `<main class="site" data-openpencil-component="LandingPage" data-openpencil-width="1440" data-openpencil-height="900">
  <nav data-openpencil-component="Navigation"><strong>New project</strong><a href="#content">Explore</a></nav>
  <section id="content" data-openpencil-component="Hero">
    <p class="eyebrow">HTML-first canvas</p>
    <h1>Design the real interface.</h1>
    <p class="lede">Edit standard HTML and CSS, then interact with the result directly on the board.</p>
    <button type="button" aria-pressed="false" data-openpencil-component="PrimaryAction" data-openpencil-prop-label="Start here" data-openpencil-control-label="text" data-openpencil-bind-label="text" data-openpencil-prop-tone="solid" data-openpencil-control-tone="select" data-openpencil-options-tone="solid,soft" data-openpencil-bind-tone="attribute:data-tone" data-openpencil-variant="primary" data-tone="solid">Start here</button>
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
button { margin-top: 24px; border: 0; border-radius: var(--op-control-radius); padding: 14px 20px; background: var(--op-text); color: white; font-weight: 650; }
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
