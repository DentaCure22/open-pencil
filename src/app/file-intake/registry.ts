import type { Editor } from '@open-pencil/core/editor'

export type BoardFileIntakeAdapter = {
  id: string
  matches: (file: Pick<File, 'name' | 'size' | 'type'>) => boolean
  placeFiles: (editor: Editor, files: File[], cx: number, cy: number) => Promise<string[]>
}

export class BoardFileIntakeRegistry {
  private readonly adapters: BoardFileIntakeAdapter[] = []

  register(adapter: BoardFileIntakeAdapter): () => void {
    if (this.adapters.some((candidate) => candidate.id === adapter.id)) {
      throw new Error(`Board file intake adapter is already registered: ${adapter.id}`)
    }
    this.adapters.push(adapter)
    return () => {
      const index = this.adapters.indexOf(adapter)
      if (index !== -1) this.adapters.splice(index, 1)
    }
  }

  find(file: Pick<File, 'name' | 'size' | 'type'>): BoardFileIntakeAdapter | null {
    return this.adapters.find((adapter) => adapter.matches(file)) ?? null
  }
}

export const boardFileIntakeRegistry = new BoardFileIntakeRegistry()
