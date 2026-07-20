import { ref } from 'vue'

export const DENTAL_FLOW_FRAMES = [
  { id: 'current', label: 'Current' },
  { id: 'exam-setup', label: 'Exam setup' },
  { id: 'active-charting', label: 'Active charting' },
  { id: 'review', label: 'Review' }
] as const

export const selectedDentalFlowFrameId = ref<string>('current')

export function selectDentalFlowFrame(id: string) {
  selectedDentalFlowFrameId.value = id
  window.dispatchEvent(new CustomEvent('smylr:dental-flow-focus', { detail: { stepId: id } }))
}
