export type EditorHistoryDelegate = {
  redo(): boolean
  undo(): boolean
}

export function createEditorHistoryDelegation() {
  let binding: { delegate: EditorHistoryDelegate; owner: symbol } | null = null

  function bind(delegate: EditorHistoryDelegate): () => void {
    const owner = Symbol('editor-history-delegate')
    binding = { delegate, owner }
    return () => {
      if (binding?.owner === owner) binding = null
    }
  }

  function run(action: keyof EditorHistoryDelegate): boolean {
    return binding?.delegate[action]() ?? false
  }

  return { bind, run }
}
