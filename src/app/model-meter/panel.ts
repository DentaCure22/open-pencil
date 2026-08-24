import { ref } from 'vue'

export const modelMeterPanelOpenEpoch = ref(0)

export function showModelMeterPanel(): void {
  modelMeterPanelOpenEpoch.value += 1
}
