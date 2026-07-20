import { randomUUID } from 'node:crypto'
import process from 'node:process'

import { automationPlugin } from '../src/app/automation/bridge/vite-plugin'

const devAutomationAuthToken = process.env.OPENPENCIL_DEV_TOKEN ?? randomUUID()
const localAutomationDisabled = process.env.OPENPENCIL_DISABLE_LOCAL_AUTOMATION === '1'

export function localAutomationToken(command: string): string | null {
  return command === 'serve' && !localAutomationDisabled ? devAutomationAuthToken : null
}

export function automationCorsOrigin(host: string | undefined): string {
  return host ? `http://${host}:1420` : 'http://localhost:1420'
}

export function openPencilAutomationPlugin(command: string, host: string | undefined) {
  const authToken = localAutomationToken(command)
  return authToken ? automationPlugin(authToken, automationCorsOrigin(host)) : false
}
