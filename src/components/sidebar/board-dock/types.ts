import type { BoardIconKey } from '@/app/sidebar-workspace/icons'

export type BoardSwitcherItem = {
  icon?: BoardIconKey
  label: string
  pageId: string
  projectName: string
}

export type BoardSwitcherProject = {
  boards: BoardSwitcherItem[]
  id: string
  name: string
}
