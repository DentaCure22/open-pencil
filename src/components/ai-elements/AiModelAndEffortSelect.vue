<script setup lang="ts">
import {
  DropdownMenuContent,
  DropdownMenuItemIndicator,
  DropdownMenuLabel,
  DropdownMenuPortal,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuRoot,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from 'reka-ui'
import { computed, onMounted } from 'vue'

import {
  AGENT_PROVIDER_USAGE,
  AGENT_MODELS,
  conversationEffort,
  conversationModel,
  effortLabel,
  GLOBAL_MODEL_SCOPE,
  refreshAgentModels,
  refreshAgentProviderUsage,
  selectConversationEffort,
  selectConversationModel,
  type AgentReasoningEffort
} from '@/app/agent-chat/models'

const { iconOnly = false, scope } = defineProps<{
  iconOnly?: boolean
  scope?: string
}>()
const modelScope = computed(() => scope || GLOBAL_MODEL_SCOPE)
const groups = computed(() => [...new Set(AGENT_MODELS.map((model) => model.group))])
const selectedModel = computed(() => conversationModel(modelScope.value))
const selectedEffort = computed(() => conversationEffort(modelScope.value))

onMounted(() => void refreshAgentModels())

function updateModel(value: unknown) {
  if (typeof value === 'string') selectConversationModel(modelScope.value, value)
}

function updateEffort(value: unknown) {
  if (
    typeof value === 'string' &&
    selectedModel.value.efforts.includes(value as AgentReasoningEffort)
  ) {
    selectConversationEffort(modelScope.value, value as AgentReasoningEffort)
  }
}

function refreshProviderUsage(open: boolean) {
  if (!open) return
  for (const group of groups.value) void refreshAgentProviderUsage(group)
}

function remainingLabel(group: string): string {
  const usage = AGENT_PROVIDER_USAGE[group]
  return usage ? `${Math.round(usage.remainingPercent)}% left` : ''
}
</script>

<template>
  <DropdownMenuRoot :modal="false" @update:open="refreshProviderUsage">
    <DropdownMenuTrigger as-child>
      <button
        type="button"
        data-test-id="agent-model-trigger"
        :aria-label="iconOnly ? 'Model: ' + selectedModel.label : undefined"
        class="flex min-w-0 items-center justify-end gap-1 font-medium text-surface outline-none hover:bg-hover focus-visible:ring-2 focus-visible:ring-accent/40 data-[state=open]:bg-hover"
        :class="
          iconOnly
            ? 'size-8 justify-center rounded-full p-0'
            : 'h-8 w-full max-w-full rounded-full px-2.5 text-[11px]'
        "
      >
        <icon-lucide-sparkles v-if="iconOnly" class="size-4 shrink-0" />
        <template v-else>
          <span class="truncate">{{ selectedModel.label }}</span>
          <IconlyIcon name="arrow-down" class="size-3.5 shrink-0 text-muted" />
        </template>
      </button>
    </DropdownMenuTrigger>

    <DropdownMenuPortal>
      <DropdownMenuContent
        data-test-id="agent-model-menu"
        align="end"
        side="top"
        :side-offset="8"
        class="z-[140] max-h-[min(620px,70vh)] w-[244px] overflow-y-auto overscroll-contain rounded-[13px] border border-border/90 bg-chrome-raised/98 p-1.5 text-surface shadow-[0_18px_48px_rgba(0,0,0,0.38)] backdrop-blur-xl outline-none"
        @close-auto-focus.prevent
      >
        <DropdownMenuLabel class="px-2.5 py-1.5 text-[11px] font-medium text-muted">
          Model
        </DropdownMenuLabel>
        <DropdownMenuRadioGroup :model-value="selectedModel.id" @update:model-value="updateModel">
          <template v-for="(group, groupIndex) in groups" :key="group">
            <DropdownMenuSeparator v-if="groupIndex" class="my-1 h-px bg-border/70" />
            <DropdownMenuLabel
              class="flex items-center justify-between gap-3 px-2.5 py-1 text-[9px] font-semibold uppercase tracking-[0.08em] text-muted/80"
            >
              <span>{{ group }}</span>
              <span
                v-if="remainingLabel(group)"
                data-test-id="agent-provider-usage"
                class="shrink-0 font-medium tracking-normal text-muted/65 normal-case tabular-nums"
              >
                {{ remainingLabel(group) }}
              </span>
            </DropdownMenuLabel>
            <DropdownMenuRadioItem
              v-for="model in AGENT_MODELS.filter((item) => item.group === group)"
              :key="model.id"
              :value="model.id"
              class="relative flex h-8 cursor-default items-center rounded-[8px] px-2.5 pr-8 text-[12px] outline-none data-[highlighted]:bg-hover data-[state=checked]:text-surface"
            >
              <span class="truncate">{{ model.label }}</span>
              <DropdownMenuItemIndicator class="absolute right-2.5">
                <icon-lucide-check class="size-3.5 text-accent" />
              </DropdownMenuItemIndicator>
            </DropdownMenuRadioItem>
          </template>
        </DropdownMenuRadioGroup>

        <DropdownMenuSeparator class="my-1.5 h-px bg-border/70" />
        <DropdownMenuLabel class="px-2.5 py-1.5 text-[11px] font-medium text-muted">
          Effort
        </DropdownMenuLabel>
        <DropdownMenuRadioGroup :model-value="selectedEffort" @update:model-value="updateEffort">
          <DropdownMenuRadioItem
            v-for="effort in selectedModel.efforts"
            :key="effort"
            :value="effort"
            class="relative flex h-8 cursor-default items-center rounded-[8px] px-2.5 pr-8 text-[12px] outline-none data-[highlighted]:bg-hover"
          >
            {{ effortLabel(effort) }}
            <DropdownMenuItemIndicator class="absolute right-2.5">
              <icon-lucide-check class="size-3.5 text-accent" />
            </DropdownMenuItemIndicator>
          </DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenuPortal>
  </DropdownMenuRoot>
</template>
