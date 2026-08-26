<script setup lang="ts">
import { useElementVisibility, useEventListener, templateRef } from '@vueuse/core'
import { computed, nextTick, onBeforeUnmount, ref, shallowRef, watch } from 'vue'
import type { AnimationMixer, Object3D, PerspectiveCamera, Scene, WebGLRenderer } from 'three'
import type { OrbitControls } from 'three/addons/controls/OrbitControls.js'

import type { SceneNode } from '@open-pencil/scene-graph'

import { useEditorStore } from '@/app/editor/active-store'
import {
  commitSpatialMediaCamera,
  initializeSpatialMediaCamera,
  storeSpatialMediaPreview
} from '@/app/spatial-media/intake'
import { disposeObject3D, disposeWebGLRenderer } from '@/app/spatial-media/runtime/dispose'
import { loadSpatialAsset } from '@/app/spatial-media/runtime/load'
import type {
  SpatialCameraState,
  SpatialMediaSource,
  SpatialRuntimeStats
} from '@/app/spatial-media/types'

type ViewerState = 'error' | 'idle' | 'loading' | 'ready'
type RenderLoopState = 'idle' | 'paused' | 'running'

const { interactive, node, previewUrl, source } = defineProps<{
  interactive: boolean
  node: SceneNode
  previewUrl: string
  source: SpatialMediaSource
}>()

const store = useEditorStore()
const rootRef = templateRef<HTMLElement>('rootRef')
const canvasHostRef = templateRef<HTMLElement>('canvasHostRef')
const visible = useElementVisibility(rootRef)
const viewerState = ref<ViewerState>('idle')
const renderLoopState = ref<RenderLoopState>('paused')
const errorMessage = ref('')
const stats = shallowRef<SpatialRuntimeStats | null>(null)

let renderer: WebGLRenderer | null = null
let scene: Scene | null = null
let root: Object3D | null = null
let camera: PerspectiveCamera | null = null
let controls: OrbitControls | null = null
let mixer: AnimationMixer | null = null
let resizeObserver: ResizeObserver | null = null
let generation = 0
let previousFrameTime = 0

const active = computed(() => interactive && visible.value)
const statusMessage = computed(() => {
  if (viewerState.value === 'error') return errorMessage.value
  if (viewerState.value === 'loading') return `Loading ${source.fileName}`
  return 'Select the source object to load its interactive 3D viewer.'
})

function tuple(vector: { x: number; y: number; z: number }): [number, number, number] {
  return [vector.x, vector.y, vector.z]
}

function cameraState(): SpatialCameraState | null {
  if (!camera || !controls) return null
  return { position: tuple(camera.position), target: tuple(controls.target) }
}

function applyCamera(state: SpatialCameraState): void {
  if (!camera || !controls || !renderer || !scene) return
  camera.position.set(...state.position)
  controls.target.set(...state.target)
  camera.updateProjectionMatrix()
  controls.update()
  renderer.render(scene, camera)
}

async function fitView(commit: boolean): Promise<void> {
  if (!root || !camera || !controls || !renderer) return
  const { Box3, Vector3 } = await import('three')
  if (!root || !camera || !controls || !renderer || !scene) return
  const bounds = new Box3().setFromObject(root)
  if (bounds.isEmpty()) return
  const center = bounds.getCenter(new Vector3())
  const size = bounds.getSize(new Vector3())
  const radius = Math.max(size.length() / 2, 0.01)
  const distance = Math.max(radius / Math.sin((camera.fov * Math.PI) / 360), radius * 1.5)
  const direction = camera.position.clone().sub(controls.target)
  if (direction.lengthSq() < 0.0001) direction.set(1, 0.65, 1)
  direction.normalize()
  controls.target.copy(center)
  camera.position.copy(center).addScaledVector(direction, distance * 1.15)
  camera.near = Math.max(distance / 1000, 0.001)
  camera.far = Math.max(distance * 100, 100)
  camera.updateProjectionMatrix()
  controls.update()
  renderer.render(scene, camera)
  const state = cameraState()
  if (!state) return
  if (commit) commitSpatialMediaCamera(store, node.id, state, 'Fit 3D camera')
  else initializeSpatialMediaCamera(store, node.id, state)
}

async function resetView(): Promise<void> {
  const home = source.homeCamera
  if (!home) {
    await fitView(true)
    return
  }
  applyCamera(home)
  const state = cameraState()
  if (state) commitSpatialMediaCamera(store, node.id, state, 'Reset 3D camera')
}

function commitControls(): void {
  const state = cameraState()
  if (state) commitSpatialMediaCamera(store, node.id, state)
}

function resize(): void {
  if (!renderer || !camera || !canvasHostRef.value) return
  const width = Math.max(1, canvasHostRef.value.clientWidth)
  const height = Math.max(1, canvasHostRef.value.clientHeight)
  renderer.setSize(width, height, false)
  camera.aspect = width / height
  camera.updateProjectionMatrix()
  if (scene) renderer.render(scene, camera)
}

async function retainPreview(expectedGeneration: number): Promise<void> {
  if (source.previewHash || !renderer) return
  const blob = await new Promise<Blob | null>((resolve) => {
    renderer?.domElement.toBlob(resolve, 'image/webp', 0.82)
  })
  if (!blob || expectedGeneration !== generation || source.previewHash) return
  storeSpatialMediaPreview(store, node.id, new Uint8Array(await blob.arrayBuffer()))
}

function renderFrame(time: number): void {
  if (!renderer || !scene || !camera || !mixer) return
  const delta = Math.min(0.1, Math.max(0, (time - previousFrameTime) / 1000))
  previousFrameTime = time
  mixer.update(delta)
  renderer.render(scene, camera)
}

function disposeViewer(nextState: RenderLoopState = 'paused'): void {
  generation += 1
  resizeObserver?.disconnect()
  resizeObserver = null
  controls?.dispose()
  controls = null
  mixer?.stopAllAction()
  mixer = null
  if (root) disposeObject3D(root)
  root = null
  scene = null
  camera = null
  if (renderer) disposeWebGLRenderer(renderer)
  renderer = null
  renderLoopState.value = nextState
  if (viewerState.value !== 'error') viewerState.value = 'idle'
  stats.value = null
}

async function startViewer(): Promise<void> {
  disposeViewer('paused')
  const expectedGeneration = generation
  const bytes = store.graph.images.get(source.assetHash)
  const canvasHost = canvasHostRef.value
  if (!bytes || !canvasHost) {
    viewerState.value = 'error'
    errorMessage.value = 'The retained 3D source bytes are unavailable.'
    return
  }
  viewerState.value = 'loading'
  errorMessage.value = ''
  try {
    const [loaded, three, controlsModule] = await Promise.all([
      loadSpatialAsset(bytes, source.format),
      import('three'),
      import('three/addons/controls/OrbitControls.js')
    ])
    if (expectedGeneration !== generation || !active.value) {
      disposeObject3D(loaded.root)
      return
    }
    root = loaded.root
    stats.value = loaded.stats
    scene = new three.Scene()
    scene.background = new three.Color('#09080d')
    scene.add(root)
    scene.add(new three.HemisphereLight('#f7f2ff', '#171122', 2.1))
    const rim = new three.DirectionalLight('#c4b5fd', 3.4)
    rim.position.set(-3, 4, 5)
    scene.add(rim)
    camera = new three.PerspectiveCamera(42, 1, 0.01, 10_000)
    camera.position.set(1, 0.65, 1)
    renderer = new three.WebGLRenderer({
      alpha: false,
      antialias: true,
      powerPreference: 'high-performance'
    })
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
    renderer.outputColorSpace = three.SRGBColorSpace
    renderer.domElement.dataset.testId = 'spatial-media-webgl-canvas'
    renderer.domElement.setAttribute('aria-label', `Interactive 3D view of ${source.fileName}`)
    canvasHost.append(renderer.domElement)
    controls = new controlsModule.OrbitControls(camera, renderer.domElement)
    controls.enableDamping = false
    controls.screenSpacePanning = true
    controls.addEventListener('change', () => {
      if (renderer && scene && camera) renderer.render(scene, camera)
    })
    controls.addEventListener('end', commitControls)
    resizeObserver = new ResizeObserver(resize)
    resizeObserver.observe(canvasHost)
    resize()
    if (source.camera) applyCamera(source.camera)
    else await fitView(false)
    if (loaded.animations.length > 0) {
      mixer = new three.AnimationMixer(root)
      for (const clip of loaded.animations) mixer.clipAction(clip).play()
      previousFrameTime = performance.now()
      renderer.setAnimationLoop(renderFrame)
      renderLoopState.value = 'running'
    } else {
      renderer.render(scene, camera)
      renderLoopState.value = 'idle'
    }
    viewerState.value = 'ready'
    await nextTick()
    await retainPreview(expectedGeneration)
  } catch (error) {
    disposeViewer('paused')
    viewerState.value = 'error'
    errorMessage.value =
      error instanceof Error ? error.message : 'The 3D source could not be loaded.'
  }
}

watch(
  [active, () => source.assetHash],
  ([shouldRun]) => {
    if (shouldRun) void startViewer()
    else disposeViewer('paused')
  },
  { immediate: true }
)

useEventListener(window, 'pagehide', () => disposeViewer('paused'))
onBeforeUnmount(() => disposeViewer('paused'))
</script>

<template>
  <article
    ref="rootRef"
    class="relative size-full overflow-hidden bg-[#09080d]"
    data-test-id="spatial-media-gltf-viewer"
    :data-interactive="interactive"
    :data-element-visible="visible"
    :data-runtime-state="viewerState"
    :data-render-loop="renderLoopState"
    @contextmenu.stop.prevent
  >
    <header
      class="absolute inset-x-0 top-0 z-20 flex h-8 items-center justify-between gap-3 border-b border-white/10 bg-[#111018]/92 px-3 backdrop-blur-sm"
    >
      <div class="flex min-w-0 items-center gap-2">
        <span class="min-w-0 truncate text-[11px] font-medium text-[#f1eef8]">{{
          source.fileName
        }}</span>
        <span
          class="shrink-0 rounded-full border border-[#a78bfa]/25 px-1.5 py-0.5 text-[8px] font-bold tracking-[0.08em] text-[#b9a8ef]"
        >
          {{ source.format.toUpperCase() }} · SOURCE
        </span>
      </div>
      <div class="flex shrink-0 items-center gap-1">
        <button
          type="button"
          class="rounded-md px-2 py-1 text-[9px] font-semibold text-[#cbc5d8] hover:bg-white/8 hover:text-white focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[#a78bfa]"
          aria-label="Fit 3D asset in view"
          data-test-id="spatial-media-fit"
          @click.stop="fitView(true)"
        >
          Fit
        </button>
        <button
          type="button"
          class="rounded-md px-2 py-1 text-[9px] font-semibold text-[#cbc5d8] hover:bg-white/8 hover:text-white focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[#a78bfa]"
          aria-label="Reset 3D camera"
          data-test-id="spatial-media-reset"
          @click.stop="resetView"
        >
          Reset
        </button>
      </div>
    </header>

    <div
      ref="canvasHostRef"
      class="absolute inset-x-0 top-8 bottom-0 [&>canvas]:block [&>canvas]:size-full"
    />
    <img
      v-if="previewUrl && viewerState !== 'ready'"
      :src="previewUrl"
      :alt="`Frozen preview of ${source.fileName}`"
      class="pointer-events-none absolute inset-x-0 top-8 bottom-0 h-[calc(100%-2rem)] w-full object-contain"
    />

    <div
      v-if="viewerState !== 'ready'"
      class="pointer-events-none absolute inset-x-0 top-8 bottom-0 z-10 flex flex-col items-center justify-center gap-2 bg-[#0b0a0f]/88 px-8 text-center"
      :role="viewerState === 'error' ? 'alert' : 'status'"
      aria-live="polite"
      data-test-id="spatial-media-status"
    >
      <IconlyIcon name="danger" v-if="viewerState === 'error'" class="size-5 text-[#f3a2a2]" />
      <icon-lucide-loader-circle
        v-else-if="viewerState === 'loading'"
        class="size-5 animate-spin text-[#a78bfa]"
      />
      <icon-lucide-box v-else class="size-5 text-[#a78bfa]" />
      <span class="max-w-[380px] text-[10px] leading-4 text-[#c9c4d3]">{{ statusMessage }}</span>
    </div>

    <div
      v-if="stats && viewerState === 'ready'"
      class="pointer-events-none absolute bottom-2 left-2 z-10 rounded-md border border-white/8 bg-[#0d0c12]/75 px-2 py-1 text-[8px] tracking-[0.05em] text-[#aaa4b5] backdrop-blur-sm"
    >
      {{ stats.triangles.toLocaleString() }} TRI · {{ stats.animations }} ANIM
    </div>
  </article>
</template>
