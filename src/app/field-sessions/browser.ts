import { IS_BROWSER } from '@/constants'

export const FIELD_RUN_HANDOFF_EVENT = 'openpencil:field-run-handoff'

export type FieldRunHandoffEventDetail = {
  runCode: string
}

export function requestPreparedFieldRunHandoff(runCode: string): void {
  if (!IS_BROWSER) throw new TypeError('Prepared field-run handoff requires a browser')
  window.dispatchEvent(
    new CustomEvent<FieldRunHandoffEventDetail>(FIELD_RUN_HANDOFF_EVENT, {
      detail: { runCode }
    })
  )
}
