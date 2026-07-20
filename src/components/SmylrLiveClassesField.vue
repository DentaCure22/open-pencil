<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'

import PanelSection from '@/components/ui/PanelSection.vue'
import Tip from '@/components/ui/Tip.vue'

const { activeClasses, suggestions } = defineProps<{
  /** Classes currently on the selection (after draft add/remove). */
  activeClasses: string[]
  /** Searchable catalog (Smylr utilities + common helpers). */
  suggestions: string[]
}>()

const emit = defineEmits<{
  add: [className: string]
  remove: [className: string]
}>()

const query = ref('')
const open = ref(false)
const rootRef = ref<HTMLElement | null>(null)
const inputRef = ref<HTMLInputElement | null>(null)
const highlight = ref(0)

const normalizedActive = computed(() => new Set(activeClasses.map((c) => c.trim()).filter(Boolean)))

const filteredSuggestions = computed(() => {
  const q = query.value.trim().toLowerCase()
  const pool = suggestions
    .map((s) => s.trim())
    .filter(Boolean)
    .filter((s, i, arr) => arr.indexOf(s) === i)
    .filter((s) => !normalizedActive.value.has(s))

  if (!q) return pool.slice(0, 12)

  const starts: string[] = []
  const includes: string[] = []
  for (const item of pool) {
    const lower = item.toLowerCase()
    if (lower.startsWith(q)) starts.push(item)
    else if (lower.includes(q)) includes.push(item)
  }
  return [...starts, ...includes].slice(0, 16)
})

const canCreateCustom = computed(() => {
  const q = query.value.trim()
  if (!q) return false
  if (normalizedActive.value.has(q)) return false
  return !suggestions.some((s) => s === q)
})

watch(filteredSuggestions, () => {
  highlight.value = 0
})

function openDropdown() {
  open.value = true
}

function closeDropdown() {
  open.value = false
  highlight.value = 0
}

function pick(className: string) {
  const value = className.trim()
  if (!value) return
  emit('add', value)
  query.value = ''
  highlight.value = 0
  void nextTick(() => inputRef.value?.focus())
}

function removeClass(className: string) {
  emit('remove', className)
}

function onKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape') {
    event.preventDefault()
    closeDropdown()
    return
  }

  if (event.key === 'ArrowDown') {
    event.preventDefault()
    open.value = true
    if (filteredSuggestions.value.length === 0) return
    highlight.value = (highlight.value + 1) % filteredSuggestions.value.length
    return
  }

  if (event.key === 'ArrowUp') {
    event.preventDefault()
    open.value = true
    if (filteredSuggestions.value.length === 0) return
    highlight.value =
      (highlight.value - 1 + filteredSuggestions.value.length) % filteredSuggestions.value.length
    return
  }

  if (event.key === 'Enter') {
    event.preventDefault()
    const list = filteredSuggestions.value
    if (open.value && list[highlight.value]) {
      pick(list[highlight.value])
      return
    }
    const q = query.value.trim()
    if (q) pick(q)
  }

  if (event.key === 'Backspace' && !query.value && activeClasses.length > 0) {
    removeClass(activeClasses[activeClasses.length - 1])
  }
}

function onDocumentPointerDown(event: PointerEvent) {
  const root = rootRef.value
  if (!root) return
  if (event.target instanceof Node && root.contains(event.target)) return
  closeDropdown()
}

onMounted(() => {
  document.addEventListener('pointerdown', onDocumentPointerDown, true)
})

onUnmounted(() => {
  document.removeEventListener('pointerdown', onDocumentPointerDown, true)
})
</script>

<template>
  <PanelSection
    label="Classes"
    data-test-id="smylr-live-classes"
    :ui="{ label: 'font-medium text-surface' }"
  >
    <div ref="rootRef" class="mt-1.5 flex flex-col gap-1.5">
      <!-- Search / add -->
      <div class="relative">
        <div
          class="border-border bg-input flex min-h-8 items-center gap-1.5 rounded-md border px-2"
          :class="open ? 'ring-accent/40 ring-1' : ''"
        >
          <icon-lucide-search class="size-3.5 shrink-0 text-muted" />
          <input
            ref="inputRef"
            v-model="query"
            type="text"
            data-test-id="smylr-live-classes-search"
            class="placeholder:text-muted min-w-0 flex-1 bg-transparent py-1.5 text-[11px] text-surface outline-none"
            placeholder="Search or add a class…"
            autocomplete="off"
            spellcheck="false"
            @focus="openDropdown"
            @input="openDropdown"
            @keydown="onKeydown"
          />
          <kbd
            v-if="!query"
            class="text-muted hidden shrink-0 rounded border border-border px-1 text-[9px] sm:inline"
          >
            /
          </kbd>
        </div>

        <!-- Dropdown -->
        <div
          v-if="open && (filteredSuggestions.length > 0 || canCreateCustom || query.trim())"
          data-test-id="smylr-live-classes-dropdown"
          class="border-border bg-panel absolute inset-x-0 top-[calc(100%+4px)] z-20 max-h-48 overflow-y-auto rounded-md border py-1 shadow-lg"
        >
          <button
            v-for="(item, index) in filteredSuggestions"
            :key="item"
            type="button"
            data-test-id="smylr-live-classes-option"
            class="flex w-full items-center gap-2 px-2 py-1.5 text-left text-[11px]"
            :class="
              index === highlight ? 'bg-accent/15 text-surface' : 'text-surface hover:bg-hover'
            "
            @mouseenter="highlight = index"
            @mousedown.prevent="pick(item)"
          >
            <icon-lucide-plus class="size-3 shrink-0 text-muted" />
            <span class="min-w-0 flex-1 truncate font-mono">{{ item }}</span>
          </button>

          <button
            v-if="canCreateCustom"
            type="button"
            data-test-id="smylr-live-classes-create"
            class="text-muted hover:bg-hover flex w-full items-center gap-2 border-t border-border px-2 py-1.5 text-left text-[11px]"
            @mousedown.prevent="pick(query.trim())"
          >
            <icon-lucide-corner-down-left class="size-3 shrink-0" />
            <span>
              Add
              <span class="font-mono text-surface">{{ query.trim() }}</span>
            </span>
          </button>

          <div
            v-else-if="filteredSuggestions.length === 0"
            class="text-muted px-2 py-2 text-center text-[11px]"
          >
            No matches
          </div>
        </div>
      </div>

      <!-- Active classes as compact removable tags -->
      <div
        v-if="activeClasses.length > 0"
        class="flex flex-wrap gap-1"
        data-test-id="smylr-live-classes-active"
      >
        <Tip v-for="cls in activeClasses" :key="cls" :label="`Remove ${cls}`">
          <button
            type="button"
            data-test-id="smylr-live-class-chip"
            class="group/chip border-border bg-hover/60 hover:border-accent/40 hover:bg-hover flex max-w-full items-center gap-1 rounded-md border px-1.5 py-0.5 text-[10px] text-surface transition-colors"
            :aria-label="`Remove ${cls}`"
            @click="removeClass(cls)"
          >
            <span class="min-w-0 truncate font-mono">{{ cls }}</span>
            <icon-lucide-x class="size-2.5 shrink-0 text-muted group-hover/chip:text-surface" />
          </button>
        </Tip>
      </div>
      <p v-else class="text-[10px] leading-4 text-muted">
        No utility classes on this selection yet. Search above to add one.
      </p>
    </div>
  </PanelSection>
</template>
