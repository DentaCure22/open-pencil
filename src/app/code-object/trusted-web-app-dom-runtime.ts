import { IS_BROWSER } from '@/constants'

type TrustedWebAppDomRuntime = {
  iframe: HTMLIFrameElement
  runtimeInstanceId: string
}

const runtimes = new Map<string, TrustedWebAppDomRuntime>()
let parkingLot: HTMLDivElement | null = null

type StatePreservingMoveTarget = HTMLElement & {
  moveBefore?: (node: Node, child: Node | null) => void
}

function moveRuntimeElement(target: HTMLElement, iframe: HTMLIFrameElement) {
  const statePreservingTarget = target as StatePreservingMoveTarget
  if (
    iframe.isConnected &&
    target.isConnected &&
    typeof statePreservingTarget.moveBefore === 'function'
  ) {
    statePreservingTarget.moveBefore(iframe, null)
    return
  }
  target.append(iframe)
}

function runtimeParkingLot(): HTMLDivElement | null {
  if (parkingLot?.isConnected) return parkingLot
  if (!IS_BROWSER) return null
  parkingLot = document.createElement('div')
  parkingLot.dataset.openPencilRuntimeParking = 'trusted-web-app'
  parkingLot.style.cssText =
    'position:fixed;left:-10000px;top:-10000px;width:1px;height:1px;overflow:hidden;pointer-events:none;visibility:hidden'
  document.body.append(parkingLot)
  return parkingLot
}

export function trustedWebAppDomRuntimeFor(frameId: string): TrustedWebAppDomRuntime | null {
  const existing = runtimes.get(frameId)
  if (existing) return existing
  if (!IS_BROWSER) return null

  const iframe = document.createElement('iframe')
  const runtime = {
    iframe,
    runtimeInstanceId: globalThis.crypto.randomUUID()
  }
  iframe.dataset.liveFrameId = frameId
  iframe.dataset.runtimeInstanceId = runtime.runtimeInstanceId
  iframe.dataset.testId = 'smylr-trusted-web-app-frame'
  iframe.loading = 'lazy'
  iframe.title = 'Smylr production app'
  runtimes.set(frameId, runtime)
  return runtime
}

export function attachTrustedWebAppDomRuntime(
  frameId: string,
  host: HTMLElement
): TrustedWebAppDomRuntime | null {
  const runtime = trustedWebAppDomRuntimeFor(frameId)
  if (!runtime) return null
  if (runtime.iframe.parentElement !== host) moveRuntimeElement(host, runtime.iframe)
  return runtime
}

export function parkTrustedWebAppDomRuntime(frameId: string) {
  const runtime = runtimes.get(frameId)
  const target = runtimeParkingLot()
  if (!runtime || !target) return
  moveRuntimeElement(target, runtime.iframe)
}

export function disposeTrustedWebAppDomRuntime(frameId: string) {
  const runtime = runtimes.get(frameId)
  if (!runtime) return false
  runtime.iframe.remove()
  runtimes.delete(frameId)
  return true
}
