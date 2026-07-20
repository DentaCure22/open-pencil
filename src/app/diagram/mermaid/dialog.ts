import { ref } from 'vue'

export const mermaidDialogOpen = ref(false)

export function openMermaidDialog(): void {
  mermaidDialogOpen.value = true
}

export function closeMermaidDialog(): void {
  mermaidDialogOpen.value = false
}
