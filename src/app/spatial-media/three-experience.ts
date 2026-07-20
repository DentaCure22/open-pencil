import { computeImageHash } from '@open-pencil/scene-graph/images'

import type { EditorStore } from '@/app/editor/active-store'
import { createHtmlBoardFrame, type HtmlBoardArtifactMetadata } from '@/app/html-board/workspace'

// Generated from the pinned package because its ESM entry imports a sibling
// module that cannot resolve from an opaque-origin Blob URL.
import THREE_RUNTIME_SOURCE from './runtime/three-r184.iife.min.js?raw'
import { threeExperiencePluginData } from './source'
import type { ThreeExperienceMetadata } from './types'

export const THREE_RUNTIME_ID = 'bundled:three@0.184.0'
export const THREE_RUNTIME_SHA256 =
  '8630fa41f662ab5384934657338686b3b946400e19c9ecec2428e0730e2c6a21'
const EXPERIENCE_WIDTH = 960
const EXPERIENCE_HEIGHT = 600

export type ThreeExperienceDefinition = {
  frozenPreviewSvg?: string
  sceneSource: string
  sourceId: string
  sourceRevision: number
  title: string
}

export type ThreeExperienceDocument = {
  css: string
  html: string
  js: string
  metadata: ThreeExperienceMetadata
}

export const THREE_EXPERIENCE_FIXTURE_SOURCE = `function createExperience(THREE, stage) {
  const scene = new THREE.Scene()
  scene.background = new THREE.Color('#0c0a12')
  const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 100)
  camera.position.set(0, 0.15, 5.3)
  const geometry = new THREE.TorusKnotGeometry(0.9, 0.28, 144, 20)
  const material = new THREE.MeshStandardMaterial({ color: '#8b5cf6', metalness: 0.34, roughness: 0.24 })
  const subject = new THREE.Mesh(geometry, material)
  scene.add(subject)
  scene.add(new THREE.HemisphereLight('#f5f3ff', '#160c2b', 2.2))
  const rim = new THREE.DirectionalLight('#ff8066', 4)
  rim.position.set(-3, 2, 4)
  scene.add(rim)
  stage.setAttribute('aria-label', 'Interactive violet torus knot scene')
  return {
    camera,
    scene,
    update(deltaSeconds) {
      subject.rotation.x += deltaSeconds * 0.16
      subject.rotation.y += deltaSeconds * 0.28
    }
  }
}`

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => {
    const entities: Record<string, string> = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;'
    }
    return entities[character] ?? ''
  })
}

function defaultFrozenPreview(title: string): string {
  const safeTitle = escapeHtml(title)
  return `<svg viewBox="0 0 960 600" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Frozen preview of ${safeTitle}">
  <defs>
    <radialGradient id="preview-bg" cx="50%" cy="42%" r="62%"><stop stop-color="#251741"/><stop offset="1" stop-color="#08070b"/></radialGradient>
    <linearGradient id="preview-form" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#b8a0ff"/><stop offset=".55" stop-color="#7956e8"/><stop offset="1" stop-color="#ff7d67"/></linearGradient>
    <filter id="preview-glow"><feGaussianBlur stdDeviation="22"/></filter>
  </defs>
  <rect width="960" height="600" fill="url(#preview-bg)"/>
  <ellipse cx="480" cy="452" rx="185" ry="34" fill="#000" opacity=".42" filter="url(#preview-glow)"/>
  <g transform="translate(480 292) rotate(-18)">
    <path fill="none" stroke="#8e65ff" stroke-width="88" stroke-linecap="round" opacity=".22" filter="url(#preview-glow)" d="M-150-38c20-154 251-154 276-10S-33 177-120 91 9-153 151-94"/>
    <path fill="none" stroke="url(#preview-form)" stroke-width="56" stroke-linecap="round" d="M-150-38c20-154 251-154 276-10S-33 177-120 91 9-153 151-94"/>
    <path fill="none" stroke="#f4f0ff" stroke-width="7" stroke-linecap="round" opacity=".65" d="M-130-58c45-112 210-117 242-12"/>
  </g>
</svg>`
}

function artifactMetadata(
  definition: ThreeExperienceDefinition,
  sourceHash: string
): HtmlBoardArtifactMetadata {
  return {
    artifactId: `three-experience-${definition.sourceId}`,
    diagramType: 'three-js-experience',
    editingModel: 'source-backed-sandbox',
    kind: 'interactive-spatial-media',
    renderFormat: 'webgl-with-frozen-svg-fallback',
    renderer: 'three.js-r184-bundled-local',
    source: definition.sourceId,
    sourceHash,
    title: definition.title
  }
}

function experienceHtml(definition: ThreeExperienceDefinition, sourceHash: string): string {
  const artifact = JSON.stringify(artifactMetadata(definition, sourceHash)).replace(/</g, '\\u003c')
  const preview = definition.frozenPreviewSvg ?? defaultFrozenPreview(definition.title)
  const title = escapeHtml(definition.title)
  const sourceId = escapeHtml(definition.sourceId)
  return `<html><head>
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline' blob:; style-src 'unsafe-inline'; img-src data: blob:; connect-src 'none'; font-src 'none'; media-src 'none'; worker-src 'none'; child-src 'none'">
  <script type="application/json" data-openpencil-artifact>${artifact}</script>
  </head><body><main class="experience" data-openpencil-component="ThreeExperience" data-openpencil-component-id="three-experience-${sourceId}" data-openpencil-width="${EXPERIENCE_WIDTH}" data-openpencil-height="${EXPERIENCE_HEIGHT}">
  <div class="source-bar">
    <span class="source-name">${title}</span>
    <span class="truth-badge" data-runtime-status>Frozen preview · source retained</span>
  </div>
  <section class="stage" data-three-stage aria-label="Frozen preview of ${title}">
    <div class="frozen-preview" data-frozen-preview>${preview}</div>
    <div class="permission-card" data-permission-card>
      <span class="permission-kicker">THREE.JS EXPERIENCE · BUNDLED OFFLINE RUNTIME</span>
      <strong>Start the authored scene?</strong>
      <p>Runs only after your click in an opaque-origin sandbox. The pinned Three.js r184 module is bundled locally; the frozen preview remains until the first WebGL frame.</p>
      <button type="button" data-start-three aria-label="Start interactive Three.js scene">Start interactive scene</button>
    </div>
  </section>
</main></body></html>`
}

const EXPERIENCE_CSS = `:root { color-scheme: dark; font-family: Inter, ui-sans-serif, system-ui, sans-serif; }
* { box-sizing: border-box; }
body { overflow: hidden; background: #08070b; color: #f5f2ff; }
button { font: inherit; }
.experience { position: relative; width: 100%; height: 100vh; min-height: 600px; overflow: hidden; background: #08070b; }
.source-bar { position: absolute; z-index: 5; inset: 0 0 auto; display: flex; height: 40px; align-items: center; justify-content: space-between; border-bottom: 1px solid #ffffff17; padding: 0 16px; background: #0b0910e8; backdrop-filter: blur(12px); }
.source-name { overflow: hidden; color: #ede9fe; font-size: 12px; font-weight: 650; letter-spacing: -.01em; text-overflow: ellipsis; white-space: nowrap; }
.truth-badge { border: 1px solid #a78bfa4d; border-radius: 999px; padding: 4px 8px; color: #c4b5fd; font-size: 10px; font-weight: 700; letter-spacing: .04em; text-transform: uppercase; }
.stage { position: absolute; inset: 40px 0 0; overflow: hidden; background: #08070b; }
.stage canvas, .frozen-preview, .frozen-preview svg { position: absolute; inset: 0; display: block; width: 100%; height: 100%; }
.frozen-preview { transition: opacity 260ms ease; }
.frozen-preview[data-hidden] { opacity: 0; pointer-events: none; }
.permission-card { position: absolute; z-index: 4; right: 22px; bottom: 22px; width: min(370px, calc(100% - 44px)); border: 1px solid #ffffff24; border-radius: 16px; padding: 16px; background: #111018e8; box-shadow: 0 18px 64px #0009; backdrop-filter: blur(16px); }
.permission-card[data-hidden] { display: none; }
.permission-kicker { display: block; margin-bottom: 8px; color: #a78bfa; font-size: 9px; font-weight: 800; letter-spacing: .11em; }
.permission-card strong { display: block; font-size: 16px; letter-spacing: -.02em; }
.permission-card p { margin: 7px 0 13px; color: #aaa4b5; font-size: 11px; line-height: 1.5; }
.permission-card button { min-height: 36px; border: 1px solid #a78bfa80; border-radius: 9px; padding: 0 13px; background: #7c3aed; color: white; cursor: pointer; font-size: 11px; font-weight: 750; }
.permission-card button:focus-visible { outline: 2px solid #ddd6fe; outline-offset: 3px; }
.permission-card button:disabled { cursor: wait; opacity: .65; }`

function experienceJs(definition: ThreeExperienceDefinition): string {
  return `(() => {
  const RUNTIME_SOURCE = ${JSON.stringify(THREE_RUNTIME_SOURCE)}
  const SOURCE = ${JSON.stringify(definition.sceneSource)}
  const stage = document.querySelector('[data-three-stage]')
  const start = document.querySelector('[data-start-three]')
  const card = document.querySelector('[data-permission-card]')
  const preview = document.querySelector('[data-frozen-preview]')
  const status = document.querySelector('[data-runtime-status]')
  let cleanup = null
  let starting = false
  let phase = 'idle'

  const setStatus = (value) => { if (status) status.textContent = value }
  const loadClassicScript = (source, exportKey) => new Promise((resolve, reject) => {
    const objectUrl = URL.createObjectURL(new Blob([source], { type: 'text/javascript' }))
    const script = document.createElement('script')
    const finish = () => {
      script.remove()
      URL.revokeObjectURL(objectUrl)
    }
    script.src = objectUrl
    script.addEventListener('error', () => {
      finish()
      reject(new Error('Bundled sandbox script could not be evaluated'))
    }, { once: true })
    script.addEventListener('load', () => {
      const value = globalThis[exportKey]
      Reflect.deleteProperty(globalThis, exportKey)
      finish()
      if (value) resolve(value)
      else reject(new Error('Bundled sandbox script did not expose its result'))
    }, { once: true })
    document.head.append(script)
  })
  const disposeMaterial = (material) => {
    for (const value of Object.values(material)) {
      if (value && value.isTexture) value.dispose()
    }
    material.dispose()
  }
  const disposeScene = (scene) => scene.traverse((object) => {
    object.geometry?.dispose()
    const materials = Array.isArray(object.material) ? object.material : [object.material]
    for (const material of materials) if (material) disposeMaterial(material)
  })

  async function startExperience() {
    if (!stage || !start || starting || cleanup) return
    starting = true
    start.disabled = true
    setStatus('Starting bundled Three.js r184…')
    try {
      phase = 'evaluating bundled runtime'
      const THREE = await loadClassicScript(RUNTIME_SOURCE, '__OPENPENCIL_THREE_RUNTIME__')
      phase = 'evaluating authored source'
      const authoredScriptSource = ${JSON.stringify("'use strict'; {\n")} + SOURCE + ${JSON.stringify("\nglobalThis.__OPENPENCIL_THREE_EXPERIENCE__ = typeof createExperience === 'function' ? createExperience : null;\n}")}
      const authoredFactory = await loadClassicScript(authoredScriptSource, '__OPENPENCIL_THREE_EXPERIENCE__')
      if (typeof authoredFactory !== 'function') throw new Error('Source must define createExperience(THREE, stage)')
      const authored = authoredFactory(THREE, stage)
      if (!authored?.scene || !authored?.camera) throw new Error('Source did not return a Three.js scene and camera')
      const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, powerPreference: 'high-performance' })
      renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2))
      renderer.outputColorSpace = THREE.SRGBColorSpace
      stage.prepend(renderer.domElement)
      let frame = 0
      let visible = true
      let previousTime = performance.now()
      const resize = () => {
        const width = Math.max(1, stage.clientWidth)
        const height = Math.max(1, stage.clientHeight)
        renderer.setSize(width, height, false)
        if (authored.camera.isPerspectiveCamera) authored.camera.aspect = width / height
        authored.camera.updateProjectionMatrix?.()
      }
      const draw = (time) => {
        frame = 0
        if (!visible || document.hidden) return
        const delta = Math.min(.1, Math.max(0, (time - previousTime) / 1000))
        previousTime = time
        authored.update?.(delta, time / 1000)
        renderer.render(authored.scene, authored.camera)
        if (preview) preview.dataset.hidden = ''
        if (card) card.dataset.hidden = ''
        setStatus('Interactive · source live')
        frame = requestAnimationFrame(draw)
      }
      const schedule = () => {
        if (frame || !visible || document.hidden) return
        previousTime = performance.now()
        frame = requestAnimationFrame(draw)
      }
      const intersection = new IntersectionObserver(([entry]) => {
        visible = Boolean(entry?.isIntersecting)
        if (!visible && frame) { cancelAnimationFrame(frame); frame = 0 }
        schedule()
      })
      const resizeObserver = new ResizeObserver(resize)
      const visibility = () => {
        if (document.hidden && frame) { cancelAnimationFrame(frame); frame = 0 }
        schedule()
      }
      intersection.observe(stage)
      resizeObserver.observe(stage)
      document.addEventListener('visibilitychange', visibility)
      resize()
      schedule()
      cleanup = () => {
        if (frame) cancelAnimationFrame(frame)
        intersection.disconnect()
        resizeObserver.disconnect()
        document.removeEventListener('visibilitychange', visibility)
        authored.dispose?.()
        disposeScene(authored.scene)
        renderer.dispose()
        renderer.forceContextLoss?.()
        renderer.domElement.remove()
      }
    } catch (error) {
      cleanup?.()
      cleanup = null
      start.disabled = false
      setStatus('Frozen preview · interactive start failed')
      start.textContent = 'Retry interactive scene'
      if (card) card.removeAttribute('data-hidden')
      console.error('Three.js experience start failed:', phase, error)
    } finally {
      starting = false
    }
  }
  start?.addEventListener('click', startExperience)
  window.addEventListener('pagehide', () => cleanup?.(), { once: true })
})()`
}

export function buildThreeExperienceDocument(
  definition: ThreeExperienceDefinition
): ThreeExperienceDocument {
  if (!definition.sourceId.trim()) throw new Error('Three.js experience sourceId is required.')
  if (!Number.isSafeInteger(definition.sourceRevision) || definition.sourceRevision < 1) {
    throw new Error('Three.js experience sourceRevision must be a positive integer.')
  }
  if (!definition.sceneSource.includes('createExperience')) {
    throw new Error('Three.js experience source must define createExperience(THREE, stage).')
  }
  const sourceHash = computeImageHash(new TextEncoder().encode(definition.sceneSource))
  const metadata: ThreeExperienceMetadata = {
    permission: {
      execution: 'explicit-user-start',
      hostAccess: 'opaque-origin',
      network: 'none',
      sourceCode: 'sandboxed'
    },
    runtimeIntegrity: `sha256-${THREE_RUNTIME_SHA256}`,
    runtimeUrl: THREE_RUNTIME_ID,
    sourceHash,
    sourceId: definition.sourceId,
    sourceRevision: definition.sourceRevision
  }
  return {
    css: EXPERIENCE_CSS,
    html: experienceHtml(definition, sourceHash),
    js: experienceJs(definition),
    metadata
  }
}

export function createThreeExperience(store: EditorStore, definition: ThreeExperienceDefinition) {
  const document = buildThreeExperienceDocument(definition)
  const frame = createHtmlBoardFrame(store, document.html, document.css, document.js, {
    frameName: definition.title
  })
  store.graph.updateNode(frame.id, {
    pluginData: threeExperiencePluginData(frame.pluginData, document.metadata)
  })
  store.requestRender()
  return store.graph.getNode(frame.id) ?? frame
}
