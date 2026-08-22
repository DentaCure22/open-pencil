import type { BoardIconKey } from '@/app/sidebar-workspace/icons'

export interface BoardSwitcherItem {
  icon?: BoardIconKey
  label: string
  pageId: string
  projectName: string
}

export interface BoardSwitcherProject {
  boards: BoardSwitcherItem[]
  children: BoardSwitcherProject[]
  id: string
  name: string
}
