import { ref } from 'vue'

import type { SceneNode } from '@open-pencil/scene-graph'

import type { EditorStore } from '@/app/editor/session'

import { createHtmlBoardFrame } from './workspace'

export const htmlBoardComposerRequest = ref(0)

export function requestHtmlBoardComposer() {
  htmlBoardComposerRequest.value += 1
}

export const HTML_BOARD_STARTER_HTML = `<main class="site" data-openpencil-component="LandingPage" data-openpencil-component-id="landing-page-1" data-openpencil-width="1440" data-openpencil-height="900">
  <nav data-openpencil-component="Navigation" data-openpencil-component-id="navigation-1" data-openpencil-slot="navigation-status" data-openpencil-slot-label="Navigation status" data-openpencil-slot-accepts="SmylrAvatar,SmylrBadge,SmylrDropdownMenu">
    <a class="brand" href="#content"><span class="brand-mark" aria-hidden="true"></span>Studio 24</a>
    <div class="nav-meta"><span>Chicago · 09:42 PM</span><a href="#schedule">Tonight ↘</a></div>
  </nav>
  <section id="content" class="hero" data-openpencil-component="Hero" data-openpencil-component-id="hero-1" data-openpencil-slot="hero-content" data-openpencil-slot-label="Hero content" data-openpencil-slot-accepts="SmylrAccordion,SmylrAlert,SmylrCalendar,SmylrCard,SmylrProgress,SmylrSeparator,SmylrTable,SmylrTabs,SmylrTooltip">
    <div class="hero-copy">
      <p class="eyebrow">Independent listening room</p>
      <h1>Sound,<br><em>shaped</em> after dark.</h1>
      <p class="lede">A small room for records, live sets, and the kind of listening that changes when the lights go low.</p>
      <div class="hero-actions" data-openpencil-slot="hero-actions" data-openpencil-slot-label="Hero controls" data-openpencil-slot-accepts="ActionButton,TextLink,SmylrButton,SmylrCheckbox,SmylrInput,SmylrRadioGroup,SmylrSelect,SmylrSlider,SmylrSwitch,SmylrTextarea">
        <button class="op-action" type="button" aria-pressed="false" data-openpencil-component="PrimaryAction" data-openpencil-component-id="primary-action-1" data-openpencil-prop-label="Reserve a seat" data-openpencil-control-label="text" data-openpencil-bind-label="text" data-openpencil-prop-tone="solid" data-openpencil-control-tone="select" data-openpencil-options-tone="solid,soft" data-openpencil-bind-tone="attribute:data-tone" data-openpencil-variant="primary" data-tone="solid">Reserve a seat</button>
        <a class="text-link" href="#schedule">See tonight's set</a>
      </div>
    </div>
    <div class="artwork" role="img" aria-label="Abstract coral and violet sound waves around a record">
      <div class="artwork-label"><span>Now playing</span><strong>Velvet Transit · Side A</strong></div>
      <div class="record"><span></span></div>
      <div class="signal signal-one"></div>
      <div class="signal signal-two"></div>
    </div>
  </section>
  <footer id="schedule">
    <span><b>01</b> Doors · 8:30 PM</span>
    <span><b>02</b> West Loop · Chicago</span>
    <span><b>03</b> Twenty-four seats</span>
  </footer>
</main>`

export const HTML_BOARD_STARTER_CSS = `:root {
  color-scheme: dark;
  --op-surface: #15131b;
  --op-text: #f5f0e8;
  --op-muted: #aaa4b3;
  --op-accent: #ff7256;
  --op-violet: #9879ff;
  --op-control-radius: 999px;
  --op-page-x: 52px;
  --op-font: Inter, ui-sans-serif, system-ui, sans-serif;
  font-family: var(--op-font);
}
* { box-sizing: border-box; }
html { scroll-behavior: smooth; }
body { margin: 0; background: var(--op-surface); color: var(--op-text); }
a { color: inherit; }
.site {
  width: 100%;
  min-height: 100vh;
  overflow: hidden;
  padding: 34px var(--op-page-x) 28px;
  background:
    radial-gradient(circle at 14% 48%, #9879ff1f, transparent 27%),
    var(--op-surface);
}
nav { display: flex; min-height: 44px; align-items: center; justify-content: space-between; }
.brand { display: inline-flex; align-items: center; gap: 10px; font-size: 15px; font-weight: 700; letter-spacing: -.02em; text-decoration: none; }
.brand-mark { width: 16px; height: 16px; border: 4px solid var(--op-accent); border-radius: 50%; box-shadow: 8px 0 0 -4px var(--op-violet); }
.nav-meta { display: flex; align-items: center; gap: 30px; color: var(--op-muted); font-size: 12px; letter-spacing: .04em; text-transform: uppercase; }
.nav-meta a { color: var(--op-text); font-weight: 700; text-decoration: none; }
.hero { display: grid; min-height: 700px; grid-template-columns: minmax(0, .9fr) minmax(480px, 1.1fr); align-items: center; gap: 66px; padding: 22px 0 18px; }
.hero-copy { position: relative; z-index: 1; }
.eyebrow { margin: 0 0 24px; color: var(--op-accent); font-size: 12px; font-weight: 750; letter-spacing: .14em; text-transform: uppercase; }
h1 { max-width: 680px; margin: 0; font-size: clamp(74px, 7.5vw, 112px); line-height: .86; letter-spacing: -.075em; }
h1 em { color: var(--op-accent); font-style: normal; font-weight: inherit; }
.lede { max-width: 510px; margin: 30px 0 0; color: var(--op-muted); font-size: 18px; line-height: 1.55; }
.hero-actions { display: flex; align-items: center; gap: 22px; margin-top: 34px; }
.op-action { display: inline-flex; min-height: 48px; align-items: center; justify-content: center; border: 1px solid transparent; border-radius: var(--op-control-radius); padding: 0 22px; background: var(--op-text); color: #17141c; font: inherit; font-size: 14px; font-weight: 750; transition: transform .2s ease, background .2s ease; }
.op-action:hover { transform: translateY(-2px); }
.op-action:focus-visible, .text-link:focus-visible, nav a:focus-visible { outline: 2px solid var(--op-violet); outline-offset: 4px; }
button[data-tone="soft"], button[aria-pressed="true"] { background: var(--op-accent); }
.text-link { color: var(--op-text); font-size: 13px; font-weight: 650; text-underline-offset: 5px; }
#content > .op-live-component { display: flex; margin-top: 28px; }
.artwork { position: relative; min-height: 610px; overflow: hidden; border: 1px solid #ffffff21; border-radius: 32px; background: linear-gradient(145deg, #252036 0%, #6f3966 44%, #ef765c 100%); box-shadow: inset 0 1px #ffffff29, 0 34px 90px #00000052; isolation: isolate; }
.artwork::before { position: absolute; inset: 9% 9% auto auto; width: 68%; aspect-ratio: 1; border: 1px solid #ffffff59; border-radius: 50%; box-shadow: 0 0 0 70px #ffffff0e, 0 0 0 140px #ffffff09; content: ''; }
.artwork::after { position: absolute; right: -9%; bottom: -18%; width: 66%; aspect-ratio: 1; border-radius: 50%; background: radial-gradient(circle at 35% 28%, #ffd6a5 0%, #ff7958 31%, #6d285e 72%); filter: blur(2px); content: ''; }
.record { position: absolute; z-index: 2; top: 14%; left: 12%; width: 47%; aspect-ratio: 1; border-radius: 50%; background: repeating-radial-gradient(circle, #19151f 0 9px, #292231 10px 12px); box-shadow: 20px 26px 60px #1c102166; }
.record::before { position: absolute; inset: 31%; border-radius: 50%; background: var(--op-accent); box-shadow: inset 0 0 0 18px #f3b0a2; content: ''; }
.record span { position: absolute; inset: 48%; z-index: 1; border-radius: 50%; background: var(--op-text); }
.signal { position: absolute; z-index: 3; width: 190px; height: 190px; border: 2px solid #f5f0e8b8; border-radius: 44% 56% 62% 38% / 42% 39% 61% 58%; transform: rotate(20deg); }
.signal-one { right: 9%; top: 12%; }
.signal-two { right: 24%; bottom: 10%; width: 110px; height: 110px; border-color: #f5f0e86b; transform: rotate(-24deg); }
.artwork-label { position: absolute; z-index: 4; right: 28px; bottom: 26px; display: grid; gap: 5px; min-width: 230px; border-top: 1px solid #ffffff66; padding-top: 14px; }
.artwork-label span { color: #ffffffb3; font-size: 10px; letter-spacing: .14em; text-transform: uppercase; }
.artwork-label strong { font-size: 14px; letter-spacing: -.01em; }
footer { display: grid; grid-template-columns: repeat(3, 1fr); border-top: 1px solid #ffffff21; padding-top: 22px; color: var(--op-muted); font-size: 12px; letter-spacing: .03em; }
footer span { display: flex; gap: 18px; }
footer b { color: var(--op-accent); font-weight: 750; }
@media (max-width: 820px) {
  :root { --op-page-x: 24px; }
  .nav-meta span { display: none; }
  .hero { grid-template-columns: 1fr; gap: 40px; padding-top: 70px; }
  h1 { font-size: clamp(62px, 16vw, 92px); }
  .artwork { min-height: 500px; }
  footer { grid-template-columns: 1fr; gap: 12px; margin-top: 36px; }
}
@media (max-width: 520px) {
  .site { padding-top: 22px; }
  .hero { padding-top: 56px; }
  .hero-actions { align-items: flex-start; flex-direction: column; }
  .artwork { min-height: 410px; border-radius: 24px; }
}`

export const HTML_BOARD_STARTER_JS = `const action = document.querySelector('[data-openpencil-component="PrimaryAction"]')
action?.addEventListener('click', () => {
  const isActive = action.getAttribute('aria-pressed') === 'true'
  const restingLabel = action.getAttribute('data-openpencil-prop-label') || 'Reserve a seat'
  action.setAttribute('aria-pressed', String(!isActive))
  action.textContent = isActive ? restingLabel : 'Seat reserved'
})`

export function createStarterHtmlBoard(store: EditorStore): SceneNode {
  return createHtmlBoardFrame(
    store,
    HTML_BOARD_STARTER_HTML,
    HTML_BOARD_STARTER_CSS,
    HTML_BOARD_STARTER_JS
  )
}
