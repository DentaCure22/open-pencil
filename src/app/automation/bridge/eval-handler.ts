import type { FigmaAPI } from '@open-pencil/core/figma-api'

import { LIVE_APP_EVAL_DISABLED_MESSAGE } from '@/app/automation/bridge/exact-target'
import type { AutomationTarget } from '@/app/automation/bridge/target'

type FigmaFactory = (store: AutomationTarget['store'], pageId?: string) => FigmaAPI

export function createAutomationEvalHandler(_makeFigma: FigmaFactory) {
  return async function handleEval(_target: AutomationTarget, _args: unknown): Promise<unknown> {
    throw new Error(LIVE_APP_EVAL_DISABLED_MESSAGE)
  }
}
