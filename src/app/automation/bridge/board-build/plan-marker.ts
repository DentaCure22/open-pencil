import type { BoardBuildPlanInput } from './types'

const PLAN_MARKER_PLUGIN_ID = 'openpencil.agent-tools'
const PLAN_MARKER_PLUGIN_KEY = 'board-build-plan-artifact'

export function planArtifactPluginData(
  input: BoardBuildPlanInput,
  alias: string,
  inputDigest: string,
  route: string
) {
  return [
    {
      key: PLAN_MARKER_PLUGIN_KEY,
      pluginId: PLAN_MARKER_PLUGIN_ID,
      value: JSON.stringify({
        alias,
        inputDigest,
        requestId: input.requestId,
        route,
        version: 1
      })
    }
  ]
}
