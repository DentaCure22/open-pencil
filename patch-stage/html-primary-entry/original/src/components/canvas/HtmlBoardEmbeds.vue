<script setup lang="ts">
import { useEventListener } from '@vueuse/core'
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'

import { useEditorStore } from '@/app/editor/active-store'
import {
  HTML_BOARD_BRIDGE_KIND,
  htmlBoardDocument,
  htmlBoardElementSelection,
  htmlBoardSrcdoc,
  htmlBoardWorkflowStatusLabel,
  isHtmlBoardFrame
} from '@/app/html-board/workspace'
import { liveFrameCanvasStyle, liveFrameHeaderStyle } from '@/app/smylr-production/frame-transform'

import type { HtmlBoardMode } from '@/app/html-board/workspace'
import type { SceneNode } from '@open-pencil/scene-graph'

const store = useEditorStore()
const modeByFrame = ref<Record<string, HtmlBoardMode>>({})
const syncTick = ref(0)
const bridgePorts = new Map<string, MessagePort>()
const iframeElements = new Map<string, HTMLIFrameElement>()
let unsubscribe: Array<() => void> = []

type UnknownRecord = { [key: string]: unknown }

const boards = computed(() => {
  void syncTick.value
  void store.state.currentPageId
  void store.state.sceneVersion
  return store.graph.getChildren(store.state.currentPageId).filter(isHtmlBoardFrame)
})

onMounted(() => {
  const sync = () => {
    syncTick.value += 1
  }
  unsubscribe = [
    store.onEditorEvent('graph:replaced', sync),
    store.onEditorEvent('page:changed', sync),
    store.onEditorEvent('node:updated', sync),
    store.onEditorEvent('viewport:changed', sync)
  ]
})

onUnmounted(() => {
  for (const stop of unsubscribe) stop()
  unsubscribe = []
  for (const port of bridgePorts.values()) port.close()
  bridgePorts.clear()
  iframeElements.clear()
})

watch(boards, (nextBoards) => {
  const boardIds = new Set(nextBoards.map((candidate) => candidate.id))
  modeByFrame.value = Object.fromEntries(
    Object.entries(modeByFrame.value).filter(([frameId]) => boardIds.has(frameId))
  )
  for (const frameId of iframeElements.keys()) {
    if (!boardIds.has(frameId)) iframeElements.delete(frameId)
  }
  for (const [frameId, port] of bridgePorts) {
    if (!boardIds.has(frameId)) {
      port.close()
      bridgePorts.delete(frameId)
    }
  }
  if (htmlBoardElementSelection.value && !boardIds.has(htmlBoardElementSelection.value.boardId)) {
    htmlBoardElementSelection.value = null
  }
  void nextTick(() => {
    for (const board of nextBoards) syncMode(board.id)
  })
})

function modeFor(frameId: string): HtmlBoardMode {
  return modeByFrame.value[frameId] ?? 'design'
}

function boardStatus(board: SceneNode) {
  const status = htmlBoardDocument(board).workflow.status
  return status === 'production' ? 'Production' : htmlBoardWorkflowStatusLabel(status)
}

function boardStatusClass(board: SceneNode) {
  const status = htmlBoardDocument(board).workflow.status
  if (status === 'production') return 'bg-emerald-400/15 text-emerald-200'
  if (status === 'in-review') return 'bg-amber-400/15 text-amber-200'
  return 'bg-violet-400/15 text-violet-200'
}

function setMode(frameId: string, mode: HtmlBoardMode) {
  modeByFrame.value = { ...modeByFrame.value, [frameId]: mode }
  store.select([frameId])
  if (mode !== 'inspect' && htmlBoardElementSelection.value?.boardId === frameId) {
    htmlBoardElementSelection.value = null
  }
  syncMode(frameId)
}

function setIframeElement(value: unknown) {
  if (value instanceof HTMLIFrameElement) {
    const frameId = value.dataset.htmlBoardId
    if (frameId) iframeElements.set(frameId, value)
  }
}

function sendBridgeMessage(frameId: string, message: UnknownRecord) {
  const payload = { ...message, kind: HTML_BOARD_BRIDGE_KIND }
  const port = bridgePorts.get(frameId)
  if (port) {
    port.postMessage(payload)
    return
  }
  iframeElements.get(frameId)?.contentWindow?.postMessage(payload, '*')
}

function syncMode(frameId: string) {
  sendBridgeMessage(frameId, { action: 'set-mode', mode: modeFor(frameId) })
  const selection = htmlBoardElementSelection.value
  if (selection?.boardId === frameId && modeFor(frameId) === 'inspect') {
    sendBridgeMessage(frameId, { action: 'set-selection', selector: selection.selector })
  }
}

function handleIframeLoad(frameId: string, event: Event) {
  if (!(event.currentTarget instanceof HTMLIFrameElement)) return
  const iframe = event.currentTarget
  iframeElements.set(frameId, iframe)
  bridgePorts.get(frameId)?.close()
  const channel = new MessageChannel()
  bridgePorts.set(frameId, channel.port1)
  channel.port1.onmessage = (portEvent) => handleBridgePayload(frameId, portEvent.data)
  channel.port1.start()
  iframe.contentWindow?.postMessage(
    { action: 'connect', kind: HTML_BOARD_BRIDGE_KIND },
    '*',
    [channel.port2]
  )
}

function textValue(value: unknown, maxLength = 180): string {
  return typeof value === 'string' ? value.slice(0, maxLength) : ''
}

function numberValue(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

function isUnknownRecord(value: unknown): value is UnknownRecord {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function handleBridgePayload(frameId: string, data: unknown) {
  if (!isUnknownRecord(data)) return
  const message = data
  if (!message || message.kind !== HTML_BOARD_BRIDGE_KIND) return
  const board = boards.value.find((candidate) => candidate.id === frameId)
  if (!board) return
  if (message.action === 'ready') {
    syncMode(frameId)
    return
  }
  if (message.action !== 'selection' || modeFor(board.id) !== 'inspect') return
  if (!isUnknownRecord(message.payload)) return

  const payload = message.payload
  const sourceRect = isUnknownRecord(payload.rect) ? payload.rect : {}
  const sourceStyles = isUnknownRecord(payload.styles) ? payload.styles : {}
  const sourceComponentProps = isUnknownRecord(payload.componentProps) ? payload.componentProps : {}
  const styles = Object.fromEntries(
    Object.entries(sourceStyles)
      .slice(0, 24)
      .map(([key, value]) => [key.slice(0, 40), textValue(value, 160)])
  )
  const componentProps = Object.fromEntries(
    Object.entries(sourceComponentProps)
      .slice(0, 16)
      .map(([key, value]) => [key.slice(0, 48), textValue(value, 160)])
  )
  htmlBoardElementSelection.value = {
    boardId: board.id,
    className: textValue(payload.className),
    componentName: textValue(payload.componentName, 80),
    componentProps,
    componentVariant: textValue(payload.componentVariant, 80),
    id: textValue(payload.id),
    rect: {
      height: numberValue(sourceRect.height),
      width: numberValue(sourceRect.width),
      x: numberValue(sourceRect.x),
      y: numberValue(sourceRect.y)
    },
    selector: textValue(payload.selector, 280),
    styles,
    tagName: textValue(payload.tagName, 40),
    text: textValue(payload.text)
  }
  store.select([board.id])
}

function handleBridgeMessage(event: MessageEvent) {
  if (!isUnknownRecord(event.data)) return
  const board = boards.value.find(
    (candidate) => iframeElements.get(candidate.id)?.contentWindow === event.source
  )
  if (board) handleBridgePayload(board.id, event.data)
}

useEventListener(window, 'message', handleBridgeMessage)
</script>

<template>
  <div
    v-for="board in boards"
    :key="board.id"
    data-test-id="html-board-embed"
    class="pointer-events-none absolute top-0 left-0 z-[5]"
    :style="liveFrameCanvasStyle(store, board)"
  >
    <div
      class="pointer-events-auto absolute left-1/2 z-[7] flex items-center gap-1.5 rounded-full border border-white/10 bg-[#17171a]/95 px-2 py-1 text-[11px] text-white shadow-lg backdrop-blur"
      :style="liveFrameHeaderStyle(store.state.zoom)"
      @pointerdown.stop
    >
      <span class="rounded-full bg-[#3159d9] px-1.5 py-0.5 text-[9px] font-bold tracking-wide">HTML</span>
      <span class="max-w-36 truncate px-1 text-white/70">{{ board.name }}</span>
      <span class="rounded-full px-1.5 py-0.5 text-[9px] font-medium" :class="boardStatusClass(board)">
        {{ boardStatus(board) }}
      </span>
      <span class="text-[10px] tabular-nums text-white/45">r{{ htmlBoardDocument(board).revision }}</span>
      <div class="ml-0.5 flex items-center rounded-full bg-white/8 p-0.5" aria-label="HTML board mode">
        <button
          v-for="mode in ['design', 'inspect', 'interact'] as const"
          :key="mode"
          type="button"
          class="rounded-full px-2 py-0.5 font-medium capitalize transition"
          :class="modeFor(board.id) === mode ? 'bg-white text-black' : 'text-white/60 hover:text-white'"
          :data-test-id="`html-board-mode-${mode}`"
          @click.stop="setMode(board.id, mode)"
        >
          {{ mode }}
        </button>
      </div>
    </div>
    <div class="absolute inset-0 overflow-hidden rounded-xl bg-white shadow-lg">
      <iframe
        :key="`${board.id}:${modeFor(board.id) === 'inspect' ? 'inspect' : 'runtime'}`"
        :ref="setIframeElement"
        :class="modeFor(board.id) === 'design' ? 'pointer-events-none' : 'pointer-events-auto'"
        :name="`openpencil-${modeFor(board.id)}`"
        :srcdoc="htmlBoardSrcdoc(board)"
        :title="`${board.name} interactive design`"
        class="size-full border-0 bg-white"
        :data-html-board-id="board.id"
        data-test-id="html-board-frame"
        sandbox="allow-forms allow-modals allow-popups allow-scripts"
        @load="handleIframeLoad(board.id, $event)"
      />
    </div>
  </div>
</template>
