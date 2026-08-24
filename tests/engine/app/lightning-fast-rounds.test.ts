import { describe, expect, test } from 'bun:test'

describe('lightning-fast improvement rounds', () => {
  test('reuses one Board stringify for hash, workspace write, and history', async () => {
    const [store, jsonFile] = await Promise.all([
      Bun.file('packages/mcp/src/local-workspace-authority/store.ts').text(),
      Bun.file('packages/mcp/src/local-workspace-authority/json-file.ts').text()
    ])
    expect(jsonFile).toContain('export async function writeSerializedJsonFile')
    expect(store).toContain('function serializeDocument')
    expect(store).toContain('function serializeAuthorityState')
    expect(store).toContain('function cloneIdentity')
    expect(store).toContain('function historyDocument')
    expect(store).toContain('deferHistory: true')
    expect(store).toContain('deferDocument: true')
    expect(store).toContain('enqueueHistoryWrite')
    expect(store).not.toContain('structuredClone(metadata.identity)')
    expect(store).not.toContain('structuredClone(state.identity)')
  })

  test('skips mermaid compilation and walks only the current Board', async () => {
    const [store, presence, persist] = await Promise.all([
      Bun.file('packages/mcp/src/local-workspace-authority/store.ts').text(),
      Bun.file('packages/mcp/src/local-workspace-authority/mermaid-presence.ts').text(),
      Bun.file('src/app/smylr-production/document-state.ts').text()
    ])
    expect(store).toContain('documentMayNeedMermaidMaterialization')
    expect(presence).toContain('document?.mermaidPresent === false')
    expect(presence).toContain('mermaidFingerprint')
    expect(persist).toContain('mermaidFingerprint')
    expect(persist).toContain('mermaidPresent')
    expect(store).toContain('materializeDocument(incoming, current.document)')
    expect(store).toContain("await import('./mermaid-materialization')")
    expect(store).toContain('document.graph.getNode(pageId)?.childIds')
    expect(store).toContain('root?.childIds')
    expect(store).not.toContain('document.source.nodes.flatMap')
  })

  test('keeps fill-only paints from wiping absolute positions', async () => {
    const pipeline = await Bun.file('packages/core/src/canvas/renderer/pipeline.ts').text()
    expect(pipeline).not.toContain('graph.clearAbsPosCache()')
    expect(pipeline).toContain('overlays.hoveredNodeId &&')
    expect(pipeline).toContain('overlays.hoveredNodeId !== overlays.nodeEditState?.nodeId &&')
    expect(pipeline).toContain('!overlays.hoverChromeOwnerIds?.has(overlays.hoveredNodeId)')
    expect(pipeline).toContain('if (selectedIds.size > 0)')
    expect(pipeline).toContain('if (r.profiler.hudVisible)')
    expect(pipeline).toContain('r.scenePictureBounds')
    expect(pipeline).toContain('if (r.labelCache.getAllSections().length > 0)')
  })

  test('stops deep-watching chat transcripts and idle history polls', async () => {
    const [surface, history, editor] = await Promise.all([
      Bun.file('src/components/ai-elements/AiConversationSurface.vue').text(),
      Bun.file('src/app/agent-chat/history-store.ts').text(),
      Bun.file('src/views/EditorView.vue').text()
    ])
    expect(surface).toContain('function annotationLayoutSignature')
    expect(surface).not.toContain('deep: true')
    expect(history).toContain('visibilitychange')
    expect(history).toContain("document?.visibilityState !== 'hidden'")
    expect(editor).toContain('800,')
    expect(editor).toContain('maxWait: 2500')
  })

  test('restores the startup JavaScript budget and compact page index', async () => {
    const [config, pageIndex, subtree, scene] = await Promise.all([
      Bun.file('vite.config.ts').text(),
      Bun.file('packages/mcp/src/local-workspace-authority/page-index.ts').text(),
      Bun.file('packages/core/src/editor/clipboard/subtree-history.ts').text(),
      Bun.file('packages/core/src/canvas/scene.ts').text()
    ])
    expect(config).toContain('initialJavaScriptBudgetPlugin()')
    expect(pageIndex).toContain('{ space: 0 }')
    expect(subtree).toContain('cloneSceneNode(node)')
    expect(subtree).not.toContain('structuredClone(node)')
    expect(scene).toContain('node.clipsContent || node.childIds.length === 0')
  })

  test('caches presented world matrices for hover and hit-testing', async () => {
    const [coordinate, graph] = await Promise.all([
      Bun.file('packages/scene-graph/src/coordinate.ts').text(),
      Bun.file('packages/scene-graph/src/index.ts').text()
    ])
    expect(coordinate).toContain('presentedWorldMatrixCache')
    expect(coordinate).toContain('presentedInverseWorldMatrixCache')
    expect(coordinate).toContain('function rememberPresentedWorldMatrix')
    expect(coordinate).toContain('export function getInverseWorldMatrix')
    expect(graph).toContain('clearWorldMatrixCache(this)')
    expect(graph).toContain('presentedNodeIds()')
  })

  test('keeps move, pan, and save off the isolation and persist hot paths', async () => {
    const [scene, events, persist, session, canvas, overlays, jsonFile, authority] =
      await Promise.all([
        Bun.file('packages/core/src/canvas/scene.ts').text(),
        Bun.file('packages/core/src/editor/graph-events.ts').text(),
        Bun.file('src/app/smylr-production/document-state.ts').text(),
        Bun.file('src/app/workspace-document/local-authority/session.ts').text(),
        Bun.file('src/components/EditorCanvas.vue').text(),
        Bun.file('src/components/canvas/CodeObjectOverlays.vue').text(),
        Bun.file('packages/mcp/src/local-workspace-authority/json-file.ts').text(),
        Bun.file('packages/mcp/src/local-workspace-authority/store.ts').text()
      ])
    expect(session).toContain('void saveSmylrProductionDocument(store)')
    expect(scene).toContain('needsNodeCompositingLayer')
    expect(scene).toContain("node.type === 'GROUP'")
    expect(scene).toContain('r.skipSceneNodeIds?.has(nodeId)')
    const pipeline = await Bun.file('packages/core/src/canvas/renderer/pipeline.ts').text()
    expect(pipeline).toContain('renderPositionPreview')
    expect(pipeline).toContain('previewPresentedNodeIds')
    expect(pipeline).toContain("setScenePictureMode('preview', 'position-preview')")
    expect(pipeline).toContain("setScenePictureMode('preview', 'backing')")
    expect(pipeline).toContain('punchPresentedRestBounds')
    expect(pipeline).toContain('r.ck.BlendMode.Clear')
    expect(pipeline).not.toContain(
      'r.fillPaint.setColor(r.ck.Color4f(r.pageColor.r, r.pageColor.g, r.pageColor.b, 1))'
    )
    expect(pipeline).not.toContain('function ensurePreviewBasePicture')
    expect(events).toContain('NODE_PICTURE_STABLE_KEYS')
    expect(events).toContain('function invalidateStructure')
    expect(events).toContain('if (!targeted) renderer.clearSubtreePictureCache()')
    expect(persist).not.toContain("'render:requested'")
    const editor = await Bun.file('src/views/EditorView.vue').text()
    expect(editor).not.toContain(
      "onEditorEvent('graph:replaced', scheduleSmylrDocumentPersistence)"
    )
    expect(canvas).toContain('CANVAS_GRID_POSITION')
    expect(canvas).not.toContain('BASE_GRID_STEP')
    expect(overlays).toContain('useEditorNodeOverlayStyle')
    expect(overlays).toContain('void syncTick.value')
    expect(overlays).toContain('cachedCodeObjectDocument')
    expect(overlays).not.toContain("store.onEditorEvent('node:previewUpdated'")
    expect(overlays).not.toContain("store.onEditorEvent('tool:changed', sync)")
    expect(jsonFile).not.toContain('chmod')
    expect(authority).not.toContain('bestEffortEnsureWorkspaceIndex(state, true)')
  })

  test('skips default-blob hydrate, overlay rescans, and descendant-bounds walks on the hot path', async () => {
    const [defaults, overlays, overlayList, document, jsonl, graph, scene] = await Promise.all([
      Bun.file('packages/scene-graph/src/node-defaults.ts').text(),
      Bun.file('src/components/canvas/CodeObjectOverlays.vue').text(),
      Bun.file('src/app/code-object/overlays.ts').text(),
      Bun.file('packages/mcp/src/local-workspace-authority/document.ts').text(),
      Bun.file('packages/mcp/src/local-workspace-authority/workspace-jsonl-index.ts').text(),
      Bun.file('packages/scene-graph/src/index.ts').text(),
      Bun.file('packages/core/src/canvas/scene.ts').text()
    ])
    expect(defaults).toContain('export function hasSceneNodeRuntimeDefaults')
    expect(defaults).toContain('if (hasSceneNodeRuntimeDefaults(node)) return node')
    expect(overlayList).toContain('export function overlayListNeedsRescan')
    expect(overlayList).toContain('for (const childId of parent.childIds)')
    expect(overlayList).not.toContain('graph.getChildren')
    expect(overlays).toContain('if (overlayListNeedsRescan(changes)) sync()')
    expect(document).toContain('options?.hydrate === false')
    expect(jsonl).toContain('readAuthorityBoardDocument(source.document, { hydrate: false })')
    expect(jsonl).toContain('export function patchWorkspaceJsonlIndex')
    expect(jsonl).toContain('prepareWorkspaceJsonlIndex(source, previous)')
    expect(graph).toContain('descendantVisualBoundsCache')
    expect(graph).toContain('getDescendantVisualBounds(id: string)')
    expect(scene).toContain('graph.getDescendantVisualBounds(nodeId)')
    expect(scene).not.toContain('computeDescendantVisualBounds(')
  })

  test('paints chat chrome first and hydrates transcripts in small idle batches', async () => {
    const [overlays, window, history, hydration] = await Promise.all([
      Bun.file('src/components/canvas/CodeObjectOverlays.vue').text(),
      Bun.file('src/components/ai-elements/conversation-window.ts').text(),
      Bun.file('src/app/agent-chat/history-store.ts').text(),
      Bun.file('src/app/agent-chat/transcript-hydration.ts').text()
    ])
    expect(overlays).toContain('conversationSurfacesReady')
    expect(overlays).toContain('bg-agent-surface shadow-agent-card')
    expect(window).toContain('CONVERSATION_WINDOW_UNMEASURED_PAINT_LIMIT = 2')
    expect(window).toContain('if (viewport <= 0)')
    expect(hydration).toContain('export function nextTranscriptHydrationBatch')
    expect(hydration).toContain('TRANSCRIPT_HYDRATION_BATCH = 2')
    expect(history).toContain('nextTranscriptHydrationBatch')
    expect(history).toContain('sameAgentConversationHistory')
    expect(history).toContain('scheduleRemainingHydration')
    expect(history).not.toContain('[...transcriptRetainers.keys()].map(async (threadId)')
    const [board, surface] = await Promise.all([
      Bun.file('src/components/agent-terminal/AgentConversationBoardSurface.vue').text(),
      Bun.file('src/components/ai-elements/AiConversationSurface.vue').text()
    ])
    expect(board).toContain('planBoardTranscriptRetain')
    expect(board).toContain(':chapter-rail-ready="interactionEnabled"')
    expect(surface).toContain('chapterRailReady = true')
    expect(surface).toContain('v-if="chapterRailReady"')
  })

  test('skips unchanged Board images and warms the workspace index from disk', async () => {
    const [session, plan, store, images, jsonl] = await Promise.all([
      Bun.file('src/app/workspace-document/local-authority/session.ts').text(),
      Bun.file('src/app/smylr-production/document-persistence/plan.ts').text(),
      Bun.file('packages/mcp/src/local-workspace-authority/store.ts').text(),
      Bun.file('packages/mcp/src/local-workspace-authority/unchanged-images.ts').text(),
      Bun.file('packages/mcp/src/local-workspace-authority/workspace-jsonl-index.ts').text()
    ])
    expect(plan).toContain('export function omitUnchangedAuthorityImages')
    expect(session).toContain('omitUnchangedAuthorityImages')
    expect(session).toContain('createAuthorityImageSignatureMemory')
    expect(images).toContain('export function restoreUnchangedAuthorityImages')
    expect(store).toContain('restoreUnchangedAuthorityPages(request.document, current.document)')
    expect(session).toContain('omitUnchangedAuthorityPages')
    expect(session).toContain('createAuthorityPageTreeMemory')
    expect(plan).toContain('export function omitUnchangedAuthorityPages')
    expect(jsonl).toContain('export async function readWorkspaceJsonlIndex')
    expect(jsonl).toContain('const loaded = await readWorkspaceJsonlIndex(rootPath)')
  })

  test('keeps idle page hops from poisoning profiler frame times', async () => {
    const [stats, profiler] = await Promise.all([
      Bun.file('packages/core/src/profiler/frame/stats.ts').text(),
      Bun.file('packages/core/src/profiler/render-profiler.ts').text()
    ])
    expect(stats).toContain('MAX_COUNTED_FRAME_GAP_MS = 250')
    expect(stats).toContain('if (gap <= 0 || gap > MAX_COUNTED_FRAME_GAP_MS)')
    expect(profiler).toContain('if (visible) this.stats.reset()')
  })

  test('paints the visible Board first instead of recording the whole cache', async () => {
    const backing = await Bun.file('packages/core/src/canvas/renderer/retained-backing.ts').text()
    expect(backing).toContain('function liveRenderVisibleScene')
    expect(backing).toContain('continueSceneBackingBuild')
    expect(backing).toContain(
      'if (!r.sceneBackingBuild || graph.hasNodePositionPresentations()) return false'
    )
    expect(backing).not.toContain('recordSceneBacking(r, graph, sceneVersion)')
  })
})
