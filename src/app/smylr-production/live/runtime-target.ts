import { smylrOpenPencilFrameUrlFor } from '@/app/smylr-live-inspector/frame-origin'

export type SmylrLiveRuntimeTarget = {
  isFlowScreen: boolean
  route: string
  state: string
}

export type SmylrLiveRuntimeTargetInput = {
  flowNodeKind?: string
  route: string
  state: string
}

export type SmylrLiveRuntimeUrlInput = {
  baseUrl: string
  openPencilHref: string
  target: SmylrLiveRuntimeTarget
}

export function smylrLiveRuntimeTargetFor(
  input: SmylrLiveRuntimeTargetInput
): SmylrLiveRuntimeTarget {
  return {
    isFlowScreen: input.flowNodeKind === 'screen',
    route: input.route,
    state: input.state
  }
}

export function smylrLiveRuntimeLabelFor(target: SmylrLiveRuntimeTarget) {
  return target.isFlowScreen ? `${target.route} · ${target.state}` : target.route
}

export function smylrLiveRuntimeUrlFor({
  baseUrl,
  openPencilHref,
  target
}: SmylrLiveRuntimeUrlInput) {
  return smylrOpenPencilFrameUrlFor({
    baseUrl,
    openPencilHref,
    params: {
      'smylr-flow-state': target.isFlowScreen ? target.state : 'shared-page-runtime',
      'smylr-openpencil-transport': 'post-message'
    },
    route: target.route
  })
}
