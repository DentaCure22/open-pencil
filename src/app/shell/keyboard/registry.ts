import { tinykeys } from 'tinykeys'
import type { KeyBindingMap } from 'tinykeys'
import { onScopeDispose } from 'vue'

import { editorCommandMetadata } from '@open-pencil/vue'
import type { EditorCommandId } from '@open-pencil/vue'

import { codeObjectViewportInsets, isCodeObjectFrame } from '@/app/code-object/model'
import { executeClipboardCommand } from '@/app/editor/clipboard/system'
import { TOOL_SHORTCUTS } from '@/app/editor/session'
import {
  activateNarratedTraceAnnotationTool,
  NARRATED_TRACE_ANNOTATION_SHORTCUTS,
  setNarratedTraceAnnotationTool,
  showTracePanel,
  TRACE_KEYBINDING
} from '@/app/narrated-trace'
import { isEditing } from '@/app/shell/keyboard/focus'
import { bindSpaceHandTool } from '@/app/shell/keyboard/space-tool'
import type {
  KeyboardShortcutOptions,
  KeyboardShortcutRunOptions
} from '@/app/shell/keyboard/types'
import { appMenuTinykeysShortcut } from '@/app/shell/menu/shortcut'

type ShortcutAction = (options: KeyboardShortcutRunOptions) => void

type ShortcutDefinition = {
  allowWhenEditing?: boolean
  allowWhenLoading?: boolean
  id: string
  keys: string | string[]
  run: ShortcutAction
}

function commandShortcut(
  command: EditorCommandId,
  keys = editorCommandMetadata(command).keybinding
): ShortcutDefinition | null {
  return keys ? { id: command, keys, run: ({ runCommand }) => runCommand(command) } : null
}

function commandShortcuts(...commands: EditorCommandId[]): ShortcutDefinition[] {
  return commands.flatMap((command) => {
    const shortcut = commandShortcut(command)
    return shortcut ? [shortcut] : []
  })
}

function shouldIgnoreShortcut(event: KeyboardEvent, options: KeyboardShortcutOptions) {
  return (
    isEditing(event) ||
    options.inputFocused.value ||
    !!options.store.state.editingTextId ||
    !!options.store.state.scrubInputFocused
  )
}

function bindShortcut(
  bindings: KeyBindingMap,
  keys: string | string[],
  run: (event: KeyboardEvent) => void
) {
  for (const key of Array.isArray(keys) ? keys : [keys]) bindings[key] = run
}

function bindToolShortcuts(bindings: KeyBindingMap, options: KeyboardShortcutRunOptions) {
  for (const [code, tool] of Object.entries(TOOL_SHORTCUTS)) {
    if (!tool) continue
    bindings[code] = (event: KeyboardEvent) => {
      event.preventDefault()
      options.spaceTool.resetToolBeforeSpace()
      setNarratedTraceAnnotationTool('none')
      options.store.setTool(tool)
    }
  }
}

function bindNarratedTraceToolShortcuts(
  bindings: KeyBindingMap,
  options: KeyboardShortcutRunOptions
) {
  for (const tool of ['ink', 'focus'] as const) {
    const shortcut = NARRATED_TRACE_ANNOTATION_SHORTCUTS[tool]
    bindings[shortcut.keybinding] = (event: KeyboardEvent) => {
      event.preventDefault()
      options.spaceTool.resetToolBeforeSpace()
      void activateNarratedTraceAnnotationTool(options.store, tool)
    }
  }
}

function zoomToSelection(options: KeyboardShortcutRunOptions) {
  const selectedNodes = [...options.store.state.selectedIds].map((id) =>
    options.store.graph.getNode(id)
  )
  let viewportInsets: ReturnType<typeof codeObjectViewportInsets> | undefined
  if (selectedNodes.some(isCodeObjectFrame)) {
    viewportInsets = codeObjectViewportInsets()
  }
  options.store.zoomToSelection(viewportInsets)
}

export function registerKeyboardShortcuts(options: KeyboardShortcutOptions) {
  const spaceTool = bindSpaceHandTool(
    options.inputFocused,
    options.store,
    () => options.enabled() && !options.store.state.loading
  )
  const runOptions = (event: KeyboardEvent): KeyboardShortcutRunOptions => ({
    ...options,
    keyEvent: event,
    spaceTool
  })

  const shortcuts: ShortcutDefinition[] = [
    ...commandShortcuts(
      'selection.createComponent',
      'selection.detachInstance',
      'selection.createComponentSet',
      'selection.toggleVisibility',
      'selection.toggleLock',
      'selection.flipHorizontal',
      'selection.flipVertical'
    ),
    {
      id: 'export-selection-png',
      keys: appMenuTinykeysShortcut('export-selection') ?? '$mod+Shift+KeyE',
      run: ({ actions }) => actions.exportSelectionPng()
    },
    {
      id: 'save-as',
      keys: appMenuTinykeysShortcut('save-as') ?? '$mod+Shift+KeyS',
      run: ({ store }) => void store.saveFigFileAs()
    },
    ...commandShortcuts('selection.ungroup', 'edit.redo'),
    {
      allowWhenLoading: true,
      id: 'toggle-ui',
      keys: appMenuTinykeysShortcut('toggle-ui') ?? '$mod+Backslash',
      run: ({ actions }) => actions.toggleUI()
    },
    { id: 'toggle-ai', keys: '$mod+KeyJ', run: ({ actions }) => actions.toggleAI() },
    {
      allowWhenEditing: true,
      allowWhenLoading: true,
      id: 'open-trace',
      keys: TRACE_KEYBINDING,
      run: showTracePanel
    },
    {
      allowWhenLoading: true,
      id: 'close-tab',
      keys: appMenuTinykeysShortcut('close') ?? '$mod+KeyW',
      run: ({ closeActiveTab }) => closeActiveTab()
    },
    {
      allowWhenLoading: true,
      id: 'new-tab',
      keys: ['$mod+KeyN', '$mod+KeyT'],
      run: ({ createTab }) => createTab()
    },
    ...commandShortcuts('edit.undo', 'selection.duplicate', 'selection.selectAll'),
    ...commandShortcuts('view.zoom100', 'view.zoomFit').map((shortcut) => ({
      ...shortcut,
      allowWhenLoading: true
    })),
    {
      allowWhenLoading: true,
      id: 'view.zoomSelection',
      keys: editorCommandMetadata('view.zoomSelection').keybinding ?? [],
      run: zoomToSelection
    },
    {
      id: 'save',
      keys: appMenuTinykeysShortcut('save') ?? '$mod+KeyS',
      run: ({ store }) => void store.saveFigFile()
    },
    {
      id: 'open-file',
      keys: appMenuTinykeysShortcut('open') ?? '$mod+KeyO',
      run: ({ openFileDialog }) => openFileDialog()
    },
    ...commandShortcuts('selection.group'),
    {
      id: 'toggle-auto-layout',
      keys: 'Shift+KeyA',
      run: ({ actions }) => actions.toggleAutoLayout()
    },
    ...commandShortcuts('selection.bringToFront', 'selection.sendToBack'),
    { id: 'delete-backspace', keys: 'Backspace', run: ({ actions }) => actions.smartDelete(false) },
    { id: 'delete', keys: 'Delete', run: ({ actions }) => actions.smartDelete(false) },
    { id: 'delete-alt', keys: 'Alt+Delete', run: ({ actions }) => actions.smartDelete(true) },
    { id: 'enter', keys: 'Enter', run: ({ actions }) => actions.confirmOrEnterText() },
    {
      allowWhenLoading: true,
      id: 'escape',
      keys: 'Escape',
      run: ({ actions }) => actions.escapeOrDeselect()
    }
  ]

  const bindings: KeyBindingMap = {}
  const editingSafeBindings = new Set<string>()
  const loadingSafeBindings = new Set<string>()
  bindToolShortcuts(bindings, runOptions(new KeyboardEvent('keydown')))
  bindNarratedTraceToolShortcuts(bindings, runOptions(new KeyboardEvent('keydown')))
  bindShortcut(bindings, '$mod+KeyC', (event) => {
    event.preventDefault()
    void executeClipboardCommand(options.store, 'copy')
  })

  for (const shortcut of shortcuts) {
    if (shortcut.allowWhenEditing) {
      for (const keys of Array.isArray(shortcut.keys) ? shortcut.keys : [shortcut.keys]) {
        editingSafeBindings.add(keys)
      }
    }
    if (shortcut.allowWhenLoading) {
      for (const keys of Array.isArray(shortcut.keys) ? shortcut.keys : [shortcut.keys]) {
        loadingSafeBindings.add(keys)
      }
    }
    bindShortcut(bindings, shortcut.keys, (event) => {
      event.preventDefault()
      shortcut.run(runOptions(event))
    })
  }

  const unsubscribe = tinykeys(
    window,
    Object.fromEntries(
      Object.entries(bindings).map(([keys, handler]) => [
        keys,
        (event: KeyboardEvent) => {
          if (!options.enabled()) return
          if (options.store.state.loading && !loadingSafeBindings.has(keys)) return
          if (shouldIgnoreShortcut(event, options) && !editingSafeBindings.has(keys)) return
          handler(event)
        }
      ])
    )
  )

  onScopeDispose(unsubscribe)
}
