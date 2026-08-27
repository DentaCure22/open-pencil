import { useLocalStorage } from '@vueuse/core'
import { ref } from 'vue'

import { toast } from '@/app/shell/ui'

import {
  applyAgentWorkMap,
  getAgentWorkMap,
  type AgentWorkMap,
  type AgentWorkMapOperation
} from './work-map'

const workMap = ref<AgentWorkMap | null>(null)
const busy = ref(false)
const openProjects = useLocalStorage<Record<string, boolean>>(
  'open-pencil:work-map-open-projects-v1',
  {}
)

export function expandAgentWorkMapProjectDirectory(projectId: string) {
  const expanded = { ...openProjects.value }
  const projectsById = new Map(
    (workMap.value?.projects ?? []).map((project) => [project.id, project] as const)
  )
  const visited = new Set<string>()
  let currentId: string | undefined = projectId
  while (currentId && !visited.has(currentId)) {
    visited.add(currentId)
    expanded[currentId] = true
    currentId = projectsById.get(currentId)?.parentId
  }
  openProjects.value = expanded
}

export function createAgentWorkMapRequestId(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  const values = crypto.getRandomValues(new Uint32Array(2))
  return `work-map-${String(Date.now())}-${String(values[0])}-${String(values[1])}`
}

export function useAgentWorkMapPersistence() {
  async function load() {
    try {
      const next = await getAgentWorkMap()
      workMap.value = next
      if (next.projects.length && !Object.values(openProjects.value).some(Boolean)) {
        const firstRoot = next.projects.find((project) => !project.parentId) ?? next.projects[0]
        openProjects.value = { [firstRoot.id]: true }
      }
    } catch {
      workMap.value = null
    }
  }

  async function applyOperations(operations: AgentWorkMapOperation[]) {
    if (!operations.length || busy.value) return false
    busy.value = true
    try {
      workMap.value = await applyAgentWorkMap({
        expectedRevision: workMap.value?.revision ?? 0,
        operations,
        requestId: createAgentWorkMapRequestId()
      })
      return true
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : 'Work map update failed')
      await load()
      return false
    } finally {
      busy.value = false
    }
  }

  async function placeChat(threadId: string, projectId: string | null) {
    await applyOperations([{ op: 'place_chat', project_id: projectId, thread_id: threadId }])
  }

  function replace(next: AgentWorkMap) {
    workMap.value = next
  }

  return { applyOperations, busy, load, openProjects, placeChat, replace, workMap }
}
