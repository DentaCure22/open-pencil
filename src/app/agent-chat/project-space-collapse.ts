import { useLocalStorage } from '@vueuse/core'

const collapsedDirectories = useLocalStorage<Record<string, boolean>>(
  'open-pencil:work-map-collapsed-board-directories-v1',
  {}
)

export function useWorkMapBoardDirectoryCollapse() {
  function toggle(projectId: string) {
    collapsedDirectories.value = {
      ...collapsedDirectories.value,
      [projectId]: collapsedDirectories.value[projectId] !== true
    }
  }

  return { collapsedDirectories, toggle }
}
