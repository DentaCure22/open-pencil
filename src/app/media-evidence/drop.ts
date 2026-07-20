import { useEventListener } from '@vueuse/core'
import { ref, type Ref } from 'vue'

import type { Editor } from '@open-pencil/core/editor'

import { placeMediaEvidenceFiles } from '@/app/media-evidence/intake'
import { isSupportedMediaFile, mediaIntakeKind } from '@/app/media-evidence/source'

function supportedFiles(files: FileList | null): File[] {
  return files ? [...files].filter(isSupportedMediaFile) : []
}

function hasSupportedFiles(event: DragEvent): boolean {
  if (!event.dataTransfer?.types.includes('Files')) return false
  return [...event.dataTransfer.items].some((item) => {
    if (item.kind !== 'file') return false
    const file = item.getAsFile()
    return file
      ? isSupportedMediaFile(file)
      : Boolean(item.type && mediaIntakeKind({ name: '', type: item.type }))
  })
}

export function extractMediaEvidenceFilesFromClipboard(event: ClipboardEvent): File[] {
  return supportedFiles(event.clipboardData?.files ?? null)
}

export function useMediaEvidenceDrop(canvasRef: Ref<HTMLCanvasElement | null>, editor: Editor) {
  const isDraggingOver = ref(false)

  useEventListener(canvasRef, 'dragover', (event: DragEvent) => {
    if (!hasSupportedFiles(event)) return
    event.preventDefault()
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy'
    isDraggingOver.value = true
  })

  useEventListener(canvasRef, 'dragenter', (event: DragEvent) => {
    if (!hasSupportedFiles(event)) return
    event.preventDefault()
    isDraggingOver.value = true
  })

  useEventListener(canvasRef, 'dragleave', () => {
    isDraggingOver.value = false
  })

  useEventListener(canvasRef, 'drop', (event: DragEvent) => {
    const files = supportedFiles(event.dataTransfer?.files ?? null)
    if (files.length === 0) return
    event.preventDefault()
    isDraggingOver.value = false

    const canvas = canvasRef.value
    if (!canvas) return
    const rect = canvas.getBoundingClientRect()
    const point = editor.screenToCanvas(event.clientX - rect.left, event.clientY - rect.top)
    void placeMediaEvidenceFiles(editor, files, point.x, point.y)
  })

  return { isDraggingOver }
}
