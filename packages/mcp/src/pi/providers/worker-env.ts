import { applyAntigravityWorkerEnv } from './antigravity/worker-env'

type ProviderWorkerEnvAdapter = (
  env: NodeJS.ProcessEnv,
  eagerToolNames: readonly string[]
) => NodeJS.ProcessEnv

const WORKER_ENV_ADAPTERS: readonly ProviderWorkerEnvAdapter[] = [applyAntigravityWorkerEnv]

export function applyProviderWorkerEnv(
  env: NodeJS.ProcessEnv,
  eagerToolNames: readonly string[]
): NodeJS.ProcessEnv {
  return WORKER_ENV_ADAPTERS.reduce((current, adapter) => adapter(current, eagerToolNames), env)
}
