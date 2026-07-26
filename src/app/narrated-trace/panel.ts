import { ref } from 'vue'

export const TRACE_KEYBINDING = '$mod+Alt+KeyT'
export const TRACE_SHORTCUT = 'MOD+ALT+T'

export const tracePanelOpenEpoch = ref(0)

export function showTracePanel() {
  tracePanelOpenEpoch.value += 1
}
