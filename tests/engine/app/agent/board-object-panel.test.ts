import { describe, expect, test } from 'bun:test'

describe('Board Object panel', () => {
  test('renders any Board object in the right Object panel while chat stays left', async () => {
    const [
      panel,
      objectNavigation,
      boardSurface,
      nativeSurface,
      codeSurface,
      panelState,
      rightPanelState,
      workspace,
      overlays,
      layerTree,
      layerActions,
      selectionTools,
      canvasMenu,
      nativeAction,
      editorCanvas
    ] = await Promise.all([
      Bun.file('src/components/agent-chat/AgentChatsPanel.vue').text(),
      Bun.file('src/app/agent-chat/panel-object-navigation.ts').text(),
      Bun.file('src/components/agent-chat/BoardObjectPanelSurface.vue').text(),
      Bun.file('src/components/agent-chat/NativeObjectPanelSurface.vue').text(),
      Bun.file('src/components/agent-chat/CodeObjectPanelSurface.vue').text(),
      Bun.file('src/app/agent-chat/panel.ts').text(),
      Bun.file('src/app/agent-chat/right-panel.ts').text(),
      Bun.file('src/components/ai-elements/AiRightPanelWorkspace.vue').text(),
      Bun.file('src/components/canvas/CodeObjectOverlays.vue').text(),
      Bun.file('src/components/LayerTree/LayerTree.vue').text(),
      Bun.file('src/components/LayerTree/LayerTreeActions.vue').text(),
      Bun.file('src/components/Toolbar/SelectionToolControls.vue').text(),
      Bun.file('src/components/canvas/CanvasMenu.vue').text(),
      Bun.file('src/components/canvas/NativeObjectActionOverlay.vue').text(),
      Bun.file('src/components/EditorCanvas.vue').text()
    ])

    expect(panelState).toContain("'conversation' | 'list'")
    expect(panelState).not.toContain("'conversation' | 'list' | 'plan'")
    expect(panelState).not.toContain('agentChatsPanelPlanObjectId')
    expect(panelState).toContain("=== 'plan') agentChatsPanelView.value = 'list'")
    expect(rightPanelState).toContain('objectId?: string')
    expect(rightPanelState).not.toContain('codeObjectId?: string')
    expect(objectNavigation).toContain("openAgentRightPanel('object', {")
    expect(objectNavigation).toContain('const todo = options.selectedWorkMapTodo.value')
    expect(objectNavigation).toContain('objectId: todo.planObjectId')
    expect(panel).toContain('data-test-id="agent-selected-plan-object"')
    expect(panel).toContain('@click="openSelectedPlan"')
    expect(panel).not.toContain('agent-selected-plan"')
    expect(panel).not.toContain('PlanSidebarSurface')

    expect(workspace).toContain('import BoardObjectPanelSurface')
    expect(workspace).toContain('<BoardObjectPanelSurface v-else-if="objectId"')
    expect(workspace).toContain(':object-id="objectId"')

    expect(boardSurface).toContain("objectKind = ref<'code' | 'native' | 'missing'>")
    expect(boardSurface).toContain('cachedCodeObjectDocument(node)')
    expect(boardSurface).toContain('watch(() => objectId, refreshObjectKind)')
    expect(boardSurface).toContain('<CodeObjectPanelSurface')
    expect(boardSurface).toContain('<NativeObjectPanelSurface')

    expect(nativeSurface).toContain('renderNodesToImage(')
    expect(nativeSurface).toContain('renderNodesToSVG(')
    expect(nativeSurface).toContain('new Blob([bytes.slice().buffer]')
    expect(nativeSurface).toContain('watch(() => objectId, refreshObject)')
    expect(nativeSurface).toContain('data-test-id="native-object-name"')
    expect(nativeSurface).toContain('data-test-id="native-object-preview"')
    expect(nativeSurface).toContain('data-test-id="native-object-show-on-board"')
    expect(nativeSurface).toContain('data-test-id="native-object-back-to-layers"')
    expect(nativeSurface).toContain("openAgentRightPanel('layers')")
    expect(nativeSurface).toContain('store.zoomToNode(objectId, editorViewportInsets())')
    expect(nativeSurface).not.toContain('updateNodeWithUndo(objectId')
    expect(nativeSurface).not.toContain('grid grid-cols-4')
    expect(nativeSurface).not.toContain('data-test-id="native-object-text"')
    expect(nativeSurface).not.toContain('{{ objectType }}')

    expect(codeSurface).toContain('runtime.renderCodeObject(')
    expect(codeSurface).toContain('updateCodeObjectState(store, objectId, state)')
    expect(codeSurface).toContain('interactionEnabled: true')
    expect(codeSurface).toContain('data-test-id="code-object-panel-host"')

    expect(overlays).not.toContain("openAgentRightPanel('object', {")
    expect(overlays).not.toContain('data-test-id="code-object-frame-chrome"')
    expect(overlays).not.toContain('data-test-id="code-object-frame-title"')
    expect(nativeAction).toContain('data-test-id="open-native-object"')
    expect(nativeAction).toContain("openAgentRightPanel('object', { objectId: current.id })")
    expect(nativeAction).toContain('cachedCodeObjectDocument(node)')
    expect(nativeAction).toContain('HOVER_GRACE_MS = 180')
    expect(editorCanvas).toContain('<NativeObjectActionOverlay />')
    expect(layerTree).toContain("openAgentRightPanel('object', { objectId: nodeId })")
    expect(layerActions).toContain('data-test-id="layer-open-object"')
    expect(selectionTools).toContain('data-test-id="selection-open-object"')
    expect(canvasMenu).toContain('data-test-id="context-open-object"')
  })
})
