import { valibotSchema } from '@ai-sdk/valibot'
import { tool } from 'ai'
import * as v from 'valibot'

import { computeAllLayouts } from '@open-pencil/core/layout'
import { CORE_TOOLS, toolsToAI } from '@open-pencil/core/tools'
import type { StepBudget, ToolLogEntry } from '@open-pencil/core/tools'
import type { SceneNode } from '@open-pencil/scene-graph'

import { makeFigmaFromStore } from '@/app/automation/bridge/figma-factory'
import { getActiveEditorStore } from '@/app/editor/active-store'
import type { EditorStore } from '@/app/editor/active-store'
import { ensureGraphFonts } from '@/app/editor/fonts'
import { normalizeLiveInspectorStylePatch } from '@/app/smylr-live-inspector/patch'
import {
  liveInspectorPatchDraftFor,
  previewLiveInspectorDraft,
  selectedLiveInspectorNode
} from '@/app/smylr-live-inspector/session'

export const MAX_AGENT_STEPS = 50

export interface StepUsage {
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
  timestamp: number
}

class RunState {
  toolLog: ToolLogEntry[] = []
  stepUsages: StepUsage[] = []
  currentSteps = 0

  recordStep(usage: StepUsage): void {
    this.stepUsages.push(usage)
    this.currentSteps++
  }

  resetSteps(): void {
    this.currentSteps = 0
  }

  hitLimit(): boolean {
    return this.currentSteps >= MAX_AGENT_STEPS
  }

  clear(): void {
    this.toolLog = []
    this.stepUsages = []
    this.currentSteps = 0
  }
}

const runStates = new WeakMap<EditorStore, RunState>()

function getRunState(store?: EditorStore): RunState {
  const target = store ?? getActiveEditorStore()
  const existing = runStates.get(target)
  if (existing) return existing
  const created = new RunState()
  runStates.set(target, created)
  return created
}

export function getToolLogEntries(store?: EditorStore): ToolLogEntry[] {
  return getRunState(store).toolLog
}

export function getStepUsages(store?: EditorStore): StepUsage[] {
  return getRunState(store).stepUsages
}

export function recordStepUsage(usage: StepUsage, store?: EditorStore): void {
  getRunState(store).recordStep(usage)
}

export function resetRunSteps(store?: EditorStore): void {
  getRunState(store).resetSteps()
}

export function didHitStepLimit(store?: EditorStore): boolean {
  return getRunState(store).hitLimit()
}

export function clearToolLogEntries(store?: EditorStore): void {
  getRunState(store).clear()
}

export function createAITools(store: EditorStore) {
  let beforeSnapshot: Map<string, SceneNode> | null = null
  const runState = getRunState(store)

  const canvasTools = toolsToAI(
    CORE_TOOLS,
    {
      getFigma: () => makeFigmaFromStore(store),
      onBeforeExecute: (def) => {
        if (def.mutates) {
          beforeSnapshot = store.snapshotPage()
        }
      },
      onAfterExecute: async (def) => {
        if (def.mutates) {
          const pageId = store.state.currentPageId
          const pageNode = store.graph.getNode(pageId)
          if (pageNode) await ensureGraphFonts(store.graph, pageNode.childIds)
          computeAllLayouts(store.graph, pageId)
          store.requestRender()
          if (beforeSnapshot) {
            const before = beforeSnapshot
            const after = store.snapshotPage()
            store.pushUndoEntry({
              label: `AI: ${def.name}`,
              forward: () => store.restorePageFromSnapshot(after),
              inverse: () => store.restorePageFromSnapshot(before)
            })
            beforeSnapshot = null
          }
        }
      },
      onFlashNodes: (nodeIds) => {
        store.renderer?.aiClearActive()
        if (nodeIds.length > 0) {
          store.aiFlashDone(nodeIds)
        }
      },
      onToolLog: (entry) => {
        runState.toolLog.push(entry)
      },
      getStepBudget: (): StepBudget => ({
        current: runState.currentSteps,
        max: MAX_AGENT_STEPS
      })
    },
    { v, valibotSchema, tool }
  )

  const inspectLiveContainer = tool({
    description:
      'Inspect the currently selected live Smylr app container before editing it. Use this instead of canvas node tools when a live container is selected.',
    inputSchema: valibotSchema(v.object({})),
    execute: async () => {
      const node = selectedLiveInspectorNode.value
      if (!node) return { error: 'No live Smylr container is selected.' }
      const draft = liveInspectorPatchDraftFor(node.id)
      return {
        id: node.id,
        label: node.label,
        tagName: node.tagName,
        component: node.source?.componentName,
        sourceFile: node.source?.filePath,
        classes: node.className?.split(/\s+/).filter(Boolean) ?? [],
        tokenHints: node.tokenHints ?? [],
        effectiveStyles: { ...node.computedStyle, ...draft?.styles },
        liveChanges: draft ?? null
      }
    }
  })

  const editLiveContainer = tool({
    description:
      'Immediately edit the selected live Smylr app container on the canvas. Pass CSS properties and/or utility-token class additions/removals. No Save or Preview step is required.',
    inputSchema: valibotSchema(
      v.object({
        styles: v.optional(v.record(v.string(), v.string()), {}),
        add: v.optional(v.array(v.string()), []),
        remove: v.optional(v.array(v.string()), []),
        note: v.optional(v.string())
      })
    ),
    execute: async ({
      styles,
      add,
      remove,
      note
    }: {
      styles: Record<string, string>
      add: string[]
      remove: string[]
      note?: string
    }) => {
      const node = selectedLiveInspectorNode.value
      if (!node) return { error: 'No live Smylr container is selected.' }
      const current = liveInspectorPatchDraftFor(node.id)
      const added = new Set(current?.add ?? [])
      const removed = new Set(current?.remove ?? [])
      for (const token of add.map((value) => value.trim()).filter(Boolean)) {
        removed.delete(token)
        added.add(token)
      }
      for (const token of remove.map((value) => value.trim()).filter(Boolean)) {
        added.delete(token)
        removed.add(token)
      }
      const mergedStyles = normalizeLiveInspectorStylePatch({
        ...current?.styles,
        ...styles
      })
      if (added.size === 0 && removed.size === 0 && Object.keys(mergedStyles).length === 0) {
        return { error: 'No live style or token changes were provided.' }
      }
      const draft = {
        add: [...added],
        nodeId: node.id,
        note: note?.trim() || node.label,
        remove: [...removed],
        source: node.source,
        styles: mergedStyles
      }
      const updatedOnCanvas = previewLiveInspectorDraft(draft)
      return {
        id: node.id,
        label: node.label,
        updatedOnCanvas,
        liveChanges: draft
      }
    }
  })

  return {
    ...canvasTools,
    inspect_live_container: inspectLiveContainer,
    edit_live_container: editLiveContainer
  }
}

export type AITools = ReturnType<typeof createAITools>
