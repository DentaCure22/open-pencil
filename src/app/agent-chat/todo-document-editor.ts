export type TodoDocumentEditorHandlers = {
  acceptsDrop(dataTransfer: DataTransfer | null): boolean
  onDrop(dataTransfer: DataTransfer | null): void
  onDropActive(active: boolean): void
  onInput(): void
  onLeave(): void
}

export function installTodoDocumentEditor(
  document: Document,
  handlers: TodoDocumentEditorHandlers
): () => void {
  document.body.contentEditable = 'true'
  document.body.spellcheck = true
  const style = document.createElement('style')
  style.dataset.openpencilTodoEditorStyle = 'true'
  style.textContent = `
    :root { container-type: inline-size; }
    *, *::before, *::after { box-sizing: border-box; }
    html, body { width: 100%; min-width: 0; min-height: 100%; overflow-x: hidden; }
    body { max-width: 100%; outline: none; caret-color: #3b82f6; overflow-wrap: anywhere; }
    body:focus-visible { outline: none; }
    main, section, article, div { min-width: 0; max-width: 100%; }
    img, picture, video, canvas, svg, iframe { max-width: 100%; height: auto; }
    pre, table { display: block; max-width: 100%; overflow-x: auto; }
    [data-todo-reference] { border-radius: 8px; }
    [data-todo-reference]:hover { background: #7f7f7f14; }
    ::selection { background: #3b82f63d; }
  `
  document.head.append(style)

  const input = () => handlers.onInput()
  const focusout = () => handlers.onLeave()
  const dragenter = (event: DragEvent) => {
    if (!handlers.acceptsDrop(event.dataTransfer)) return
    event.preventDefault()
    handlers.onDropActive(true)
  }
  const dragover = (event: DragEvent) => {
    if (!handlers.acceptsDrop(event.dataTransfer)) return
    event.preventDefault()
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy'
  }
  const dragleave = () => handlers.onDropActive(false)
  const drop = (event: DragEvent) => {
    if (!handlers.acceptsDrop(event.dataTransfer)) return
    event.preventDefault()
    event.stopPropagation()
    handlers.onDropActive(false)
    handlers.onDrop(event.dataTransfer)
  }

  document.addEventListener('input', input)
  document.addEventListener('focusout', focusout)
  document.addEventListener('dragenter', dragenter)
  document.addEventListener('dragover', dragover)
  document.addEventListener('dragleave', dragleave)
  document.addEventListener('drop', drop)
  return () => {
    document.removeEventListener('input', input)
    document.removeEventListener('focusout', focusout)
    document.removeEventListener('dragenter', dragenter)
    document.removeEventListener('dragover', dragover)
    document.removeEventListener('dragleave', dragleave)
    document.removeEventListener('drop', drop)
  }
}
