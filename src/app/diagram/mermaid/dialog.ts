import { ref } from 'vue'

export const mermaidDialogOpen = ref(false)
export const mermaidDialogTarget = ref<{ ownerId?: string; source: string } | null>(null)

export function openMermaidDialog(): void {
  mermaidDialogTarget.value = null
  mermaidDialogOpen.value = true
}

export function openMermaidDiagramEditor(ownerId: string, source: string): void {
  mermaidDialogTarget.value = { ownerId, source }
  mermaidDialogOpen.value = true
}

export function openMermaidDiagramUpgrade(source: string): void {
  mermaidDialogTarget.value = { source }
  mermaidDialogOpen.value = true
}

export function closeMermaidDialog(): void {
  mermaidDialogOpen.value = false
}
