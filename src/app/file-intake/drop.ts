import { useDropZone } from '@vueuse/core'
import type { Ref } from 'vue'

import type { Editor } from '@open-pencil/core/editor'

import { toast } from '@/app/shell/ui'

import { placeFileIntakeFiles } from './intake'

function filesFromList(files: FileList | null): File[] {
  return files ? [...files] : []
}

export function extractFilesFromClipboard(event: ClipboardEvent): File[] {
  return filesFromList(event.clipboardData?.files ?? null)
}

function announceFallback(count: number) {
  if (count === 0) return
  toast.warning(
    count === 1
      ? 'Preview unavailable. The original file was preserved as a downloadable source.'
      : `${count} files have no board preview. Their original bytes were preserved for download.`
  )
}

export async function placeFilesWithFallbackMessage(
  editor: Editor,
  files: File[],
  cx: number,
  cy: number
) {
  const result = await placeFileIntakeFiles(editor, files, cx, cy)
  announceFallback(result.sourceObjectIds.length)
  return result
}

export function useFileIntakeDrop(canvasRef: Ref<HTMLCanvasElement | null>, editor: Editor) {
  const { isOverDropZone } = useDropZone(canvasRef, {
    checkValidity: (items) => [...items].some((item) => item.kind === 'file'),
    onDrop: (files, event) => {
      const canvas = canvasRef.value
      if (!canvas || !files || files.length === 0) return
      const bounds = canvas.getBoundingClientRect()
      const point = editor.screenToCanvas(event.clientX - bounds.left, event.clientY - bounds.top)
      void placeFilesWithFallbackMessage(editor, files, point.x, point.y)
    },
    onOver: (_files, event) => {
      if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy'
    }
  })

  return { isDraggingOver: isOverDropZone }
}
