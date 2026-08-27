/*
 * React island adapted from T3 Code's sidebar thread status presentation at
 * 5d7665396083d285132d67038813862a93337ca5 (MIT, T3 Tools Inc.).
 * See THIRD_PARTY_NOTICES.md.
 */
import { memo } from 'react'

import type { T3ThreadStatus } from './t3-chat-chrome.logic'

export default memo(function T3ThreadStatusIndicator({ status }: { status: T3ThreadStatus }) {
  return (
    <span
      aria-label={status.label}
      className="t3-thread-status"
      data-pulse={status.pulse ? 'true' : 'false'}
      data-test-id={status.label === 'Completed' ? 'agent-thread-finished-marker' : undefined}
      data-tone={status.tone}
      role="status"
    >
      <span
        aria-hidden="true"
        className={status.pulse ? 't3-thread-status-spinner' : 't3-thread-status-dot'}
      />
    </span>
  )
})
