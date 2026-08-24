<script setup lang="ts">
import AiCodeBlock from './AiCodeBlock.vue'
import { isSafeMarkdownImageUrl, isSafeMarkdownUrl, type AssistantMarkdownNode } from './markdown'

defineOptions({ name: 'AiMarkdownNodes' })

defineProps<{
  nodes: AssistantMarkdownNode[]
}>()

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
      <AiMarkdownNodes v-if="node.children?.length" :nodes="node.children" />
    </p>
    <component
      :is="`h${String(Math.min(4, Math.max(1, node.depth ?? 2)))}`"
      v-else-if="node.type === 'heading'"
    >
      <AiMarkdownNodes v-if="node.children?.length" :nodes="node.children" />
    </component>
    <ul v-else-if="node.type === 'list' && !node.ordered">
      <AiMarkdownNodes v-if="node.children?.length" :nodes="node.children" />
    </ul>
    <ol v-else-if="node.type === 'list'">
      <AiMarkdownNodes v-if="node.children?.length" :nodes="node.children" />
    </ol>
    <li v-else-if="node.type === 'listItem'">
      <input v-if="isTaskItem(node)" type="checkbox" disabled :checked="node.checked === true" />
      <AiMarkdownNodes v-if="node.children?.length" :nodes="node.children" />
    </li>
    <blockquote v-else-if="node.type === 'blockquote'">
      <AiMarkdownNodes v-if="node.children?.length" :nodes="node.children" />
    </blockquote>
    <strong v-else-if="node.type === 'strong'">
      <AiMarkdownNodes v-if="node.children?.length" :nodes="node.children" />
    </strong>
    <em v-else-if="node.type === 'emphasis'">
      <AiMarkdownNodes v-if="node.children?.length" :nodes="node.children" />
    </em>
    <del v-else-if="node.type === 'delete'">
      <AiMarkdownNodes v-if="node.children?.length" :nodes="node.children" />
    </del>
    <a
      v-else-if="node.type === 'link' && isSafeMarkdownUrl(node.url)"
      :href="node.url"
      rel="noreferrer"
      target="_blank"
    >
      <AiMarkdownNodes v-if="node.children?.length" :nodes="node.children" />
    </a>
    <span v-else-if="node.type === 'link'">
      <AiMarkdownNodes v-if="node.children?.length" :nodes="node.children" />
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
    <template v-else-if="node.type === 'text'">{{ node.value }}</template>
    <AiMarkdownNodes v-else-if="node.children?.length" :nodes="node.children" />
    <template v-else-if="node.value">{{ node.value }}</template>
  </template>
</template>
