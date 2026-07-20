import { useFileDialog } from '@vueuse/core'

import { useEditorStore } from '@/app/editor/active-store'
import { placeMediaEvidenceFiles } from '@/app/media-evidence/intake'
import { isTauri } from '@/app/tauri/env'

const MEDIA_ACCEPT =
  '.png,.jpg,.jpeg,.webp,.gif,.avif,.pdf,.mp4,.mov,.webm,.ogv,.mp3,.m4a,.aac,.wav,.flac,.ogg,.oga'

const browserDialog = useFileDialog({
  accept: MEDIA_ACCEPT,
  multiple: true,
  reset: true
})

const store = useEditorStore()

function viewportCenter() {
  return store.screenToCanvas(window.innerWidth / 2, window.innerHeight / 2)
}

async function placeFiles(files: File[]) {
  if (files.length === 0) return
  const point = viewportCenter()
  await placeMediaEvidenceFiles(store, files, point.x, point.y)
}

browserDialog.onChange((files) => {
  if (files) void placeFiles([...files])
})

async function chooseTauriMediaFiles(): Promise<File[]> {
  const [{ open }, { readFile }] = await Promise.all([
    import('@tauri-apps/plugin-dialog'),
    import('@tauri-apps/plugin-fs')
  ])
  const paths = await open({
    filters: [
      {
        name: 'Images, PDF, video, or audio',
        extensions: [
          'png',
          'jpg',
          'jpeg',
          'webp',
          'gif',
          'avif',
          'pdf',
          'mp4',
          'mov',
          'webm',
          'ogv',
          'mp3',
          'm4a',
          'aac',
          'wav',
          'flac',
          'ogg',
          'oga'
        ]
      }
    ],
    multiple: true
  })
  if (!paths) return []
  return Promise.all(
    paths.map(async (path) => {
      const bytes = await readFile(path)
      return new File([bytes], path.split('/').pop() ?? 'media')
    })
  )
}

export async function openMediaEvidenceDialog() {
  if (isTauri()) {
    await placeFiles(await chooseTauriMediaFiles())
    return
  }
  browserDialog.open()
}
