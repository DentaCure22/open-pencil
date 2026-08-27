<script setup lang="ts">
import { inject } from 'vue'

import AiCodeBlock from './AiCodeBlock.vue'
import AiStreamingTextNode from './AiStreamingTextNode.vue'
import { boardObjectLinkContextKey } from './board-object-links'
import { isSafeMarkdownImageUrl, isSafeMarkdownUrl, type AssistantMarkdownNode } from './markdown'

defineOptions({ name: 'AiMarkdownNodes' })

const { nodes, streamingTail = false } = defineProps<{
  nodes: AssistantMarkdownNode[]
  streamingTail?: boolean
}>()

const boardObjectLinks = inject(boardObjectLinkContextKey, null)

function streamsInto(index: number) {
  return streamingTail && index === nodes.length - 1
}

function isTaskItem(node: AssistantMarkdownNode) {
  return typeof node.checked === 'boolean'
}

function tableHeaderRow(node: AssistantMarkdownNode) {
  return node.children?.[0]
}

function tableBodyRows(node: AssistantMarkdownNode) {
  return node.children?.slice(1) ?? []
}

function cellAlign(table: AssistantMarkdownNode, index: number) {
  const align = table.align?.[index]
  return align ? { textAlign: align } : undefined
}
</script>

<template>
  <template v-for="(node, index) in nodes" :key="`${node.type}-${String(index)}`">
    <p v-if="node.type === 'paragraph'">
      <AiMarkdownNodes
        v-if="node.children?.length"
        :nodes="node.children"
        :streaming-tail="streamsInto(index)"
      />
    </p>
    <component
      :is="`h${String(Math.min(4, Math.max(1, node.depth ?? 2)))}`"
      v-else-if="node.type === 'heading'"
    >
      <AiMarkdownNodes
        v-if="node.children?.length"
        :nodes="node.children"
        :streaming-tail="streamsInto(index)"
      />
    </component>
    <ul v-else-if="node.type === 'list' && !node.ordered">
      <AiMarkdownNodes
        v-if="node.children?.length"
        :nodes="node.children"
        :streaming-tail="streamsInto(index)"
      />
    </ul>
    <ol v-else-if="node.type === 'list'">
      <AiMarkdownNodes
        v-if="node.children?.length"
        :nodes="node.children"
        :streaming-tail="streamsInto(index)"
      />
    </ol>
    <li v-else-if="node.type === 'listItem'">
      <input v-if="isTaskItem(node)" type="checkbox" disabled :checked="node.checked === true" />
      <AiMarkdownNodes
        v-if="node.children?.length"
        :nodes="node.children"
        :streaming-tail="streamsInto(index)"
      />
    </li>
    <blockquote v-else-if="node.type === 'blockquote'">
      <AiMarkdownNodes
        v-if="node.children?.length"
        :nodes="node.children"
        :streaming-tail="streamsInto(index)"
      />
    </blockquote>
    <strong v-else-if="node.type === 'strong'">
      <AiMarkdownNodes
        v-if="node.children?.length"
        :nodes="node.children"
        :streaming-tail="streamsInto(index)"
      />
    </strong>
    <em v-else-if="node.type === 'emphasis'">
      <AiMarkdownNodes
        v-if="node.children?.length"
        :nodes="node.children"
        :streaming-tail="streamsInto(index)"
      />
    </em>
    <del v-else-if="node.type === 'delete'">
      <AiMarkdownNodes
        v-if="node.children?.length"
        :nodes="node.children"
        :streaming-tail="streamsInto(index)"
      />
    </del>
    <button
      v-else-if="node.type === 'boardObjectLink' && node.boardObjectId && boardObjectLinks"
      type="button"
      data-test-id="ai-board-object-link"
      :data-board-object-id="node.boardObjectId"
      class="inline rounded-[3px] font-[inherit] leading-[inherit] text-accent underline decoration-accent/30 underline-offset-2 transition-colors hover:decoration-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-component/30"
      @click="boardObjectLinks.open(node.boardObjectId)"
      @focus="boardObjectLinks.hover(node.boardObjectId)"
      @blur="boardObjectLinks.hover(null)"
      @mouseenter="boardObjectLinks.hover(node.boardObjectId)"
      @mouseleave="boardObjectLinks.hover(null)"
    >
      <AiMarkdownNodes
        v-if="node.children?.length"
        :nodes="node.children"
        :streaming-tail="streamsInto(index)"
      />
    </button>
    <a
      v-else-if="node.type === 'link' && isSafeMarkdownUrl(node.url)"
      :href="node.url"
      rel="noreferrer"
      target="_blank"
    >
      <AiMarkdownNodes
        v-if="node.children?.length"
        :nodes="node.children"
        :streaming-tail="streamsInto(index)"
      />
    </a>
    <span v-else-if="node.type === 'link'">
      <AiMarkdownNodes
        v-if="node.children?.length"
        :nodes="node.children"
        :streaming-tail="streamsInto(index)"
      />
    </span>
    <img
      v-else-if="node.type === 'image' && isSafeMarkdownImageUrl(node.url)"
      :src="node.url"
      :alt="node.alt ?? ''"
      :title="node.title || undefined"
    />
    <div v-else-if="node.type === 'table'" class="assistant-markdown-table">
      <table>
        <thead v-if="tableHeaderRow(node)">
          <tr>
            <th
              v-for="(cell, cellIndex) in tableHeaderRow(node)?.children ?? []"
              :key="`th-${String(cellIndex)}`"
              :style="cellAlign(node, cellIndex)"
            >
              <AiMarkdownNodes v-if="cell.children?.length" :nodes="cell.children" />
            </th>
          </tr>
        </thead>
        <tbody v-if="tableBodyRows(node).length">
          <tr v-for="(row, rowIndex) in tableBodyRows(node)" :key="`tr-${String(rowIndex)}`">
            <td
              v-for="(cell, cellIndex) in row.children ?? []"
              :key="`td-${String(cellIndex)}`"
              :style="cellAlign(node, cellIndex)"
            >
              <AiMarkdownNodes v-if="cell.children?.length" :nodes="cell.children" />
            </td>
          </tr>
        </tbody>
      </table>
    </div>
    <tr v-else-if="node.type === 'tableRow'">
      <AiMarkdownNodes v-if="node.children?.length" :nodes="node.children" />
    </tr>
    <th v-else-if="node.type === 'tableHeader'">
      <AiMarkdownNodes v-if="node.children?.length" :nodes="node.children" />
    </th>
    <td v-else-if="node.type === 'tableCell'">
      <AiMarkdownNodes v-if="node.children?.length" :nodes="node.children" />
    </td>
    <AiCodeBlock v-else-if="node.type === 'code'" :code="node.value ?? ''" :language="node.lang" />
    <code v-else-if="node.type === 'inlineCode'">{{ node.value }}</code>
    <br v-else-if="node.type === 'break'" />
    <hr v-else-if="node.type === 'thematicBreak'" />
    <AiStreamingTextNode
      v-else-if="node.type === 'text'"
      :active="streamsInto(index)"
      :text="node.value ?? ''"
    />
    <AiMarkdownNodes v-else-if="node.children?.length" :nodes="node.children" />
    <template v-else-if="node.value">{{ node.value }}</template>
  </template>
</template>
