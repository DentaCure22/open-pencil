import { useEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'

import type { EarthSignalsState } from '../model'

type EarthSignalsProps = {
  onStateChange: (state: EarthSignalsState) => void
  state: EarthSignalsState
}

type DragState = {
  latitude: number
  longitude: number
  pointerId: number
  x: number
  y: number
}

type GlobeRuntime = {
  dispose: () => void
  group: THREE.Group
  render: () => void
  setAutoRotate: (value: boolean) => void
}

const CONTINENT_ELLIPSES = [
  { latitude: 46, longitude: -104, radiusLatitude: 23, radiusLongitude: 42 },
  { latitude: 25, longitude: -90, radiusLatitude: 17, radiusLongitude: 22 },
  { latitude: -14, longitude: -60, radiusLatitude: 35, radiusLongitude: 19 },
  { latitude: 51, longitude: 14, radiusLatitude: 12, radiusLongitude: 22 },
  { latitude: 8, longitude: 20, radiusLatitude: 36, radiusLongitude: 22 },
  { latitude: 47, longitude: 74, radiusLatitude: 23, radiusLongitude: 57 },
  { latitude: 18, longitude: 80, radiusLatitude: 19, radiusLongitude: 22 },
  { latitude: 37, longitude: 128, radiusLatitude: 17, radiusLongitude: 27 },
  { latitude: -25, longitude: 134, radiusLatitude: 15, radiusLongitude: 22 }
] as const

function longitudeDistance(a: number, b: number) {
  return Math.abs(((((a - b + 180) % 360) + 360) % 360) - 180)
}

function isLand(latitude: number, longitude: number) {
  return CONTINENT_ELLIPSES.some((continent) => {
    const x = longitudeDistance(longitude, continent.longitude) / continent.radiusLongitude
    const y = (latitude - continent.latitude) / continent.radiusLatitude
    return x * x + y * y <= 1
  })
}

function spherePoint(latitude: number, longitude: number, radius: number) {
  const lat = THREE.MathUtils.degToRad(latitude)
  const lon = THREE.MathUtils.degToRad(longitude)
  const cosLat = Math.cos(lat)
  return new THREE.Vector3(
    radius * cosLat * Math.cos(lon),
    radius * Math.sin(lat),
    radius * cosLat * Math.sin(lon)
  )
}

function landGeometry() {
  const positions: number[] = []
  for (let latitude = -58; latitude <= 72; latitude += 2.4) {
    for (let longitude = -180; longitude < 180; longitude += 2.4) {
      if (!isLand(latitude, longitude)) continue
      const point = spherePoint(latitude, longitude, 1.014)
      positions.push(point.x, point.y, point.z)
    }
  }
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  return geometry
}

function starGeometry() {
  const positions: number[] = []
  for (let index = 0; index < 320; index += 1) {
    const longitude = (index * 137.508) % 360
    const latitude = ((index * 47.123) % 150) - 75
    const radius = 4.2 + ((index * 17) % 90) / 100
    const point = spherePoint(latitude, longitude, radius)
    positions.push(point.x, point.y, point.z)
  }
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  return geometry
}

function disposeRenderable(object: THREE.Object3D) {
  if (
    !(object instanceof THREE.Mesh) &&
    !(object instanceof THREE.Points) &&
    !(object instanceof THREE.LineSegments)
  ) {
    return
  }
  object.geometry.dispose()
  const materials = Array.isArray(object.material) ? object.material : [object.material]
  for (const material of materials) material.dispose()
}

function createGlobeScene(canvas: HTMLCanvasElement): GlobeRuntime {
  const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, canvas })
  renderer.setClearColor(0x000000, 0)
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
  renderer.outputColorSpace = THREE.SRGBColorSpace

  const scene = new THREE.Scene()
  const camera = new THREE.PerspectiveCamera(34, 1, 0.1, 100)
  camera.position.set(0, 0, 4.55)

  const globe = new THREE.Group()
  scene.add(globe)

  globe.add(
    new THREE.Mesh(
      new THREE.SphereGeometry(1, 64, 48),
      new THREE.MeshPhysicalMaterial({
        color: 0x071d2a,
        metalness: 0.14,
        roughness: 0.44,
        sheen: 0.8,
        sheenColor: 0x2be5d1
      })
    )
  )

  globe.add(
    new THREE.LineSegments(
      new THREE.WireframeGeometry(new THREE.SphereGeometry(1.006, 24, 16)),
      new THREE.LineBasicMaterial({ color: 0x3cb8b2, opacity: 0.15, transparent: true })
    )
  )

  globe.add(
    new THREE.Points(
      landGeometry(),
      new THREE.PointsMaterial({
        color: 0x8df4d5,
        depthWrite: false,
        opacity: 0.92,
        size: 0.026,
        sizeAttenuation: true,
        transparent: true
      })
    )
  )

  const marker = new THREE.Mesh(
    new THREE.SphereGeometry(0.035, 18, 18),
    new THREE.MeshBasicMaterial({ color: 0xffa16b })
  )
  marker.position.copy(spherePoint(31, -97, 1.045))
  globe.add(marker)

  const markerHalo = new THREE.Mesh(
    new THREE.TorusGeometry(0.078, 0.006, 10, 48),
    new THREE.MeshBasicMaterial({
      color: 0xffb07d,
      opacity: 0.75,
      transparent: true
    })
  )
  markerHalo.position.copy(marker.position)
  markerHalo.lookAt(new THREE.Vector3(0, 0, 0))
  globe.add(markerHalo)

  const atmosphere = new THREE.Mesh(
    new THREE.SphereGeometry(1.08, 64, 48),
    new THREE.MeshBasicMaterial({
      blending: THREE.AdditiveBlending,
      color: 0x2bd7d0,
      opacity: 0.055,
      side: THREE.BackSide,
      transparent: true
    })
  )
  globe.add(atmosphere)

  const orbit = new THREE.Mesh(
    new THREE.TorusGeometry(1.34, 0.004, 8, 160),
    new THREE.MeshBasicMaterial({
      color: 0x75dcd2,
      opacity: 0.28,
      transparent: true
    })
  )
  orbit.rotation.x = THREE.MathUtils.degToRad(67)
  orbit.rotation.z = THREE.MathUtils.degToRad(-12)
  scene.add(orbit)

  scene.add(
    new THREE.Points(
      starGeometry(),
      new THREE.PointsMaterial({ color: 0xa8fff0, opacity: 0.32, size: 0.012, transparent: true })
    )
  )

  const keyLight = new THREE.DirectionalLight(0x9ffff0, 4.4)
  keyLight.position.set(-3, 3, 5)
  scene.add(keyLight)
  const rimLight = new THREE.DirectionalLight(0x346bff, 2.2)
  rimLight.position.set(4, -1, -3)
  scene.add(rimLight)
  scene.add(new THREE.AmbientLight(0x29465d, 1.4))

  function render() {
    const width = Math.max(canvas.clientWidth, 1)
    const height = Math.max(canvas.clientHeight, 1)
    const pixelWidth = Math.round(width * renderer.getPixelRatio())
    const pixelHeight = Math.round(height * renderer.getPixelRatio())
    if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
      renderer.setSize(width, height, false)
      camera.aspect = width / height
      camera.updateProjectionMatrix()
    }
    renderer.render(scene, camera)
  }

  let autoRotate = false
  let frame = 0
  function animate() {
    frame = window.requestAnimationFrame(animate)
    if (autoRotate) globe.rotation.y += 0.0012
    orbit.rotation.z += 0.0006
    const pulse = 1 + Math.sin(performance.now() / 420) * 0.09
    markerHalo.scale.setScalar(pulse)
    render()
  }
  animate()

  const observer = new ResizeObserver(render)
  observer.observe(canvas)

  function dispose() {
    window.cancelAnimationFrame(frame)
    observer.disconnect()
    scene.traverse(disposeRenderable)
    renderer.dispose()
  }
  return {
    dispose,
    group: globe,
    render,
    setAutoRotate: (value) => {
      autoRotate = value
    }
  }
}

function regionForLongitude(longitude: number) {
  if (longitude < -35) return 'Americas'
  if (longitude < 55) return 'Europe · Africa'
  return 'Asia · Pacific'
}

function signedDegrees(value: number) {
  const rounded = Math.round(value)
  return `${rounded > 0 ? '+' : ''}${rounded}°`
}

export function EarthSignals({ onStateChange, state }: EarthSignalsProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const runtimeRef = useRef<GlobeRuntime | null>(null)
  const dragRef = useRef<DragState | null>(null)
  const currentRef = useRef(state)
  const onStateChangeRef = useRef(onStateChange)
  const [viewState, setViewState] = useState(state)
  const [rendererReady, setRendererReady] = useState(false)

  useEffect(() => {
    onStateChangeRef.current = onStateChange
  }, [onStateChange])

  useEffect(() => {
    if (dragRef.current) return
    currentRef.current = state
    setViewState(state)
    const runtime = runtimeRef.current
    if (runtime) {
      runtime.setAutoRotate(state.autoRotate)
      runtime.group.rotation.x = THREE.MathUtils.degToRad(state.latitude)
      runtime.group.rotation.y = THREE.MathUtils.degToRad(state.longitude)
      runtime.render()
    }
  }, [state])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return undefined
    const runtime = createGlobeScene(canvas)
    runtimeRef.current = runtime
    runtime.setAutoRotate(currentRef.current.autoRotate)
    runtime.group.rotation.x = THREE.MathUtils.degToRad(currentRef.current.latitude)
    runtime.group.rotation.y = THREE.MathUtils.degToRad(currentRef.current.longitude)
    runtime.render()
    setRendererReady(true)
    return () => {
      runtime.dispose()
      runtimeRef.current = null
    }
  }, [])

  const region = useMemo(() => regionForLongitude(viewState.longitude), [viewState.longitude])
  const signalStrength = Math.round(
    74 + Math.cos(THREE.MathUtils.degToRad(viewState.longitude)) * 17
  )

  function applyRotation(latitude: number, longitude: number) {
    const next = { autoRotate: false, latitude, longitude }
    currentRef.current = next
    setViewState(next)
    const runtime = runtimeRef.current
    if (!runtime) return
    runtime.group.rotation.x = THREE.MathUtils.degToRad(latitude)
    runtime.group.rotation.y = THREE.MathUtils.degToRad(longitude)
    runtime.render()
  }

  function beginDrag(event: React.PointerEvent<HTMLCanvasElement>) {
    if (event.button !== 0) return
    const runtime = runtimeRef.current
    const latitude = runtime
      ? THREE.MathUtils.radToDeg(runtime.group.rotation.x)
      : currentRef.current.latitude
    const longitude = runtime
      ? THREE.MathUtils.radToDeg(runtime.group.rotation.y)
      : currentRef.current.longitude
    applyRotation(latitude, longitude)
    event.currentTarget.setPointerCapture(event.pointerId)
    dragRef.current = {
      latitude,
      longitude,
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY
    }
  }

  function moveDrag(event: React.PointerEvent<HTMLCanvasElement>) {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    const latitude = Math.min(70, Math.max(-70, drag.latitude + (event.clientY - drag.y) * 0.24))
    const longitude = drag.longitude + (event.clientX - drag.x) * 0.34
    applyRotation(latitude, longitude)
  }

  function endDrag(event: React.PointerEvent<HTMLCanvasElement>) {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    dragRef.current = null
    event.currentTarget.releasePointerCapture(event.pointerId)
    onStateChangeRef.current(currentRef.current)
  }

  function toggleRotation() {
    const next = { ...currentRef.current, autoRotate: !currentRef.current.autoRotate }
    currentRef.current = next
    setViewState(next)
    runtimeRef.current?.setAutoRotate(next.autoRotate)
    onStateChangeRef.current(next)
  }

  return (
    <main
      data-test-id="code-object-earth-signals"
      className="relative size-full select-none overflow-hidden font-sans text-[#f4f7f8]"
    >
      <div className="pointer-events-none absolute inset-[9%] rounded-full bg-[radial-gradient(circle,rgba(26,195,178,0.13),rgba(6,18,27,0.16)_46%,transparent_72%)] blur-xl" />

      <div className="absolute inset-0 flex items-center justify-center">
        <canvas
          ref={canvasRef}
          aria-label="Interactive globe. Drag to rotate."
          className="size-full cursor-grab touch-none active:cursor-grabbing"
          data-test-id="code-object-globe-canvas"
          onPointerCancel={endDrag}
          onPointerDown={beginDrag}
          onPointerMove={moveDrag}
          onPointerUp={endDrag}
        />
      </div>

      <header className="pointer-events-none absolute top-7 left-8 z-10">
        <div className="flex items-center gap-2 text-[9px] font-semibold tracking-[0.22em] text-[#75dfd2] uppercase">
          <span className="size-1.5 rounded-full bg-[#75dfd2] shadow-[0_0_12px_rgba(117,223,210,0.9)]" />
          Live earth signals
        </div>
        <h1 className="mt-2 text-[25px] leading-none font-medium tracking-[-0.035em]">
          Earth signals
        </h1>
      </header>

      <div className="pointer-events-none absolute bottom-7 left-8 flex items-center gap-3 text-[9px] font-medium tracking-[0.18em] text-white/38 uppercase">
        <span className="h-px w-8 bg-white/24" />
        {rendererReady ? 'Drag to rotate' : 'Starting WebGL'}
        <span className="text-[#75dfd2]/80" data-test-id="code-object-longitude">
          {signedDegrees(viewState.longitude)}
        </span>
      </div>

      <div className="pointer-events-none absolute top-7 right-8 flex items-center gap-4 text-right">
        <div>
          <div className="text-[8px] font-semibold tracking-[0.16em] text-white/32 uppercase">
            Region
          </div>
          <div className="mt-1 text-[13px] font-medium text-white/76">{region}</div>
        </div>
        <span className="h-7 w-px bg-white/12" />
        <div>
          <div className="text-[8px] font-semibold tracking-[0.16em] text-white/32 uppercase">
            Signal
          </div>
          <div className="mt-1 text-[13px] font-medium text-[#ffad79]">{signalStrength}%</div>
        </div>
      </div>

      <button
        type="button"
        aria-pressed={viewState.autoRotate}
        className="absolute right-8 bottom-7 z-10 flex h-8 items-center gap-2 rounded-full border border-white/[0.09] bg-[#071018]/75 px-3 text-[9px] font-medium text-white/58 shadow-[0_8px_30px_rgba(0,0,0,0.22)] backdrop-blur-md transition-colors hover:bg-[#0b1721]/90 hover:text-white"
        data-test-id="code-object-auto-rotate"
        onClick={toggleRotation}
      >
        <span
          className={`size-1.5 rounded-full ${
            viewState.autoRotate ? 'bg-[#75dfd2]' : 'bg-white/25'
          }`}
        />
        Ambient rotation
      </button>
    </main>
  )
}
