<script setup lang="ts">
import { refAutoReset, useClipboard } from '@vueuse/core'

const { code, filename, language } = defineProps<{
  code: string
  filename?: string
  language?: string
}>()
const copied = refAutoReset(false, 1_500)
const { copy } = useClipboard()

async function copyCode() {
  await copy(code)
  copied.value = true
}
</script>

<template>
  <figure
    data-test-id="ai-code-block"
    class="my-1.5 overflow-hidden rounded-[6px] border border-border bg-input"
  >
    <figcaption
      class="flex h-7 items-center gap-2 border-b border-border px-2 font-mono text-[8px] text-muted"
    >
      <span class="min-w-0 flex-1 truncate">{{ filename ?? language ?? 'code' }}</span>
      <button
        type="button"
        :aria-label="copied ? 'Code copied' : 'Copy code'"
        class="flex size-5 items-center justify-center rounded hover:bg-hover hover:text-surface"
        @click="copyCode"
      >
        <icon-lucide-check v-if="copied" class="size-3" />
        <icon-lucide-copy v-else class="size-3" />
      </button>
    </figcaption>
    <pre class="max-h-64 overflow-auto overscroll-contain p-2 text-[9px] leading-relaxed"><code
      :class="language ? `language-${language}` : undefined"
    >{{ code }}</code></pre>
  </figure>
</template>
