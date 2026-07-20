import { IS_BROWSER } from '@/constants'

import {
  ObservedHumanSessionAuthority,
  type ObservedHumanReviewClaim,
  type ObservedHumanSessionClaim,
  type ObservedHumanSessionProof,
  type ObservedHumanSessionStartInput,
  type ObservedHumanSessionState,
  type ObservedHumanTaskInteractionInput
} from './authority'

export const HUMAN_SESSION_STATE_EVENT = 'openpencil:human-session-state'

let authority: ObservedHumanSessionAuthority | null = null

function browserAuthority(): ObservedHumanSessionAuthority {
  if (authority) return authority
  if (!IS_BROWSER) {
    throw new TypeError('Observed human sessions require a browser')
  }
  authority = new ObservedHumanSessionAuthority({
    crypto: window.crypto,
    hasFocus: () => document.hasFocus(),
    hasUserActivation: () =>
      navigator.userActivation.isActive || navigator.userActivation.hasBeenActive,
    isAutomated: () => navigator.webdriver,
    isVisible: () => document.visibilityState === 'visible',
    now: () => Date.now(),
    onStateChange: (state) => {
      window.dispatchEvent(new CustomEvent(HUMAN_SESSION_STATE_EVENT, { detail: state }))
    },
    schedule: (callback, delayMs) => {
      const timer = window.setTimeout(callback, delayMs)
      return () => window.clearTimeout(timer)
    }
  })
  return authority
}

export function observedHumanSessionState(): ObservedHumanSessionState {
  return authority?.state() ?? { interactionCount: 0, status: 'idle' }
}

export async function startObservedHumanSession(
  input: ObservedHumanSessionStartInput | string
): Promise<ObservedHumanSessionState> {
  if (typeof input === 'string') {
    throw new TypeError('Observed sessions require an exact PHI-free surface target')
  }
  return browserAuthority().start(input)
}

export function recordObservedTaskInteraction(input: ObservedHumanTaskInteractionInput): void {
  browserAuthority().recordTaskInteraction(input)
}

export async function issueObservedHumanSessionProof(
  claim: ObservedHumanReviewClaim
): Promise<ObservedHumanSessionProof> {
  return browserAuthority().issue(claim)
}

export async function verifyObservedHumanSessionProof(
  proof: ObservedHumanSessionProof,
  expected: ObservedHumanSessionClaim | ObservedHumanReviewClaim
) {
  return browserAuthority().verify(proof, expected)
}

export function commitObservedHumanSessionProof(proofDigest: string): void {
  browserAuthority().commit(proofDigest)
}

export function abortObservedHumanSession(): ObservedHumanSessionState {
  return browserAuthority().abort()
}
