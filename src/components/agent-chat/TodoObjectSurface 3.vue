<script setup lang="ts">
import { computed, ref, watch } from 'vue'

import {
  uploadAgentAttachments,
  type AgentPromptAttachment
} from '@/app/agent-chat/attachment-transfer'
import {
  appendDraftAttachments,
  carriesAttachmentDrag,
  readAttachmentDrag
} from '@/app/agent-chat/attachments'
import type { AgentTodoDraft } from '@/app/agent-chat/conversations'
import type { AgentPromptSubmission } from '@/app/agent-chat/models'
import {
  appendAgentTodoBrief,
  updateAgentTodoDraft,
  type AgentTodoBrief,
  type AgentWorkMapTodo,
  type AgentWorkMapTodoStatus
} from '@/app/agent-chat/work-map'
import { resolveBrowserCaptureAttachments } from '@/app/browser-inspector/attachment'
import { toast } from '@/app/shell/ui'
import AiPromptInput from '@/components/ai-elements/AiPromptInput.vue'

const { draft, threadId, todo } = defineProps<{
  draft: AgentTodoDraft | null
  threadId: string
  todo: AgentWorkMapTodo | null
}>()

const emit = defineEmits<{
  'open-related-chat': []
  saved: []
}>()

const statusLabels: Record<AgentWorkMapTodoStatus, string> = {
  in_motion: 'In motion',
  todo: 'Todo'
}

const editing = ref(false)
const saving = ref(false)
const dropping = ref(false)
const composerText = ref('')
const composerAttachments = ref<File[]>([])
const editGoal = ref('')
const editRequest = ref('')
const editOutcome = ref('')
const editPlan = ref('')
const editAcceptance = ref('')

const status = computed<AgentWorkMapTodoStatus>(() => todo?.status ?? 'todo')
const statusLabel = computed(() => statusLabels[status.value])
const requestCopy = computed(() => draft?.brief.context ?? '')
const planSteps = computed(() => {
  const brief = draft?.brief
  if (!brief) return []
  return [brief.suggestedNextStep, ...(brief.openQuestions ?? [])].filter((step): step is string =>
    Boolean(step?.trim())
  )
})
const hasDetails = computed(() => {
  const brief = draft?.brief
  return Boolean(
    requestCopy.value ||
    brief?.desiredOutcome ||
    planSteps.value.length ||
    brief?.acceptance?.length ||
    brief?.references?.length
  )
})

function resetEditor() {
  const brief = draft?.brief
  editGoal.value = brief?.goal ?? ''
  editRequest.value = brief?.context ?? ''
  editOutcome.value = brief?.desiredOutcome ?? ''
  editPlan.value = [brief?.suggestedNextStep, ...(brief?.openQuestions ?? [])]
    .filter(Boolean)
    .join('\n')
  editAcceptance.value = (brief?.acceptance ?? []).join('\n')
}

watch(() => draft?.brief, resetEditor, { deep: true, immediate: true })

function nonEmptyLines(value: string): string[] {
  return value
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
}

async function persistBrief(brief: AgentTodoBrief, attachments: AgentPromptAttachment[] = []) {
  if (!threadId || saving.value) return false
  saving.value = true
  try {
    await updateAgentTodoDraft({ attachments, brief, threadId })
    emit('saved')
    return true
  } catch (cause) {
    toast.error(cause instanceof Error ? cause.message : 'Todo update failed')
    return false
  } finally {
    saving.value = false
  }
}

async function saveEdits() {
  const brief = draft?.brief
  const goal = editGoal.value.trim()
  if (!brief || !goal) return
  const plan = nonEmptyLines(editPlan.value)
  const acceptance = nonEmptyLines(editAcceptance.value)
  const next: AgentTodoBrief = { ...brief, goal }
  const context = editRequest.value.trim()
  const desiredOutcome = editOutcome.value.trim()
  if (context) next.context = context
  else delete next.context
  if (desiredOutcome) next.desiredOutcome = desiredOutcome
  else delete next.desiredOutcome
  if (plan[0]) next.suggestedNextStep = plan[0]
  else delete next.suggestedNextStep
  if (plan.length > 1) next.openQuestions = plan.slice(1)
  else delete next.openQuestions
  if (acceptance.length) next.acceptance = acceptance
  else delete next.acceptance
  if (await persistBrief(next)) editing.value = false
}

async function appendContent(submission: AgentPromptSubmission) {
  const brief = draft?.brief
  if (!brief || (!composerText.value.trim() && !submission.attachments.length)) return
  try {
    const resolved = await resolveBrowserCaptureAttachments(submission.attachments)
    const attachments = await uploadAgentAttachments(resolved.attachments)
    const text = [composerText.value.trim(), resolved.contextPrompt?.trim()]
      .filter(Boolean)
      .join('\n\n')
    const next = appendAgentTodoBrief(brief, { attachments, text })
    if (!(await persistBrief(next, attachments))) return
    composerText.value = ''
    composerAttachments.value = []
  } catch (cause) {
    toast.error(cause instanceof Error ? cause.message : 'Todo update failed')
  }
}

function carriesTodoContent(dataTransfer: DataTransfer | null): boolean {
  if (!dataTransfer) return false
  if ([...dataTransfer.types].includes('application/x-openpencil-work-map-todo')) return false
  return carriesAttachmentDrag(dataTransfer) || [...dataTransfer.types].includes('text/plain')
}

function dragEnter(event: DragEvent) {
  if (!carriesTodoContent(event.dataTransfer)) return
  event.preventDefault()
  event.stopPropagation()
  dropping.value = true
  if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy'
}

function dragLeave(event: DragEvent) {
  const current = event.currentTarget
  const related = event.relatedTarget
  if (current instanceof HTMLElement && related instanceof Node && current.contains(related)) return
  dropping.value = false
}

function dropContent(event: DragEvent) {
  if (!carriesTodoContent(event.dataTransfer)) return
  event.preventDefault()
  event.stopPropagation()
  dropping.value = false
  const files = readAttachmentDrag(event.dataTransfer)
  const result = appendDraftAttachments(composerAttachments.value, files)
  composerAttachments.value = result.attachments
  if (result.error) toast.error(result.error)
  const text = event.dataTransfer?.getData('text/plain').trim()
  if (text) composerText.value = [composerText.value.trim(), text].filter(Boolean).join('\n\n')
}
</script>

<template>
  <section
    class="relative flex min-h-0 flex-1 flex-col overflow-hidden bg-agent-surface"
    data-test-id="workspace-object-surface"
    @dragenter="dragEnter"
    @dragover="dragEnter"
    @dragleave="dragLeave"
    @drop="dropContent"
  >
    <template v-if="draft">
      <header class="shrink-0 px-5 pt-4 pb-3">
        <div class="flex items-center gap-2">
          <div
            class="flex min-w-0 flex-1 items-center gap-2 text-[10px] font-medium tracking-[0.09em] text-muted uppercase"
          >
            <icon-lucide-clock-3 class="size-3.5 shrink-0 stroke-[1.6]" />
            {{ statusLabel }}
          </div>
          <button
            type="button"
            data-test-id="todo-object-edit"
            :aria-label="editing ? 'Cancel editing Todo' : 'Edit Todo'"
            :title="editing ? 'Cancel editing' : 'Edit Todo'"
            class="flex size-7 shrink-0 items-center justify-center rounded-[7px] text-muted transition-colors outline-none hover:bg-hover hover:text-surface focus-visible:ring-2 focus-visible:ring-accent/25"
            @click="editing ? ((editing = false), resetEditor()) : (editing = true)"
          >
            <icon-lucide-x v-if="editing" class="size-3.5 stroke-[1.7]" />
            <icon-lucide-pencil v-else class="size-3.5 stroke-[1.7]" />
          </button>
          <button
            type="button"
            data-test-id="todo-object-related-chat"
            aria-label="Open related chat"
            title="Related chat"
            class="flex size-7 shrink-0 items-center justify-center rounded-[7px] text-accent transition-colors outline-none hover:bg-hover hover:text-surface focus-visible:ring-2 focus-visible:ring-accent/25"
            @click="emit('open-related-chat')"
          >
            <icon-lucide-message-circle class="size-3.5 stroke-[1.7]" />
          </button>
        </div>

        <textarea
          v-if="editing"
          v-model="editGoal"
          data-test-id="todo-object-goal-input"
          aria-label="Todo title"
          rows="2"
          class="mt-3 w-full resize-none rounded-[7px] border border-chrome-control-border bg-transparent px-2.5 py-2 text-[17px] leading-6 font-semibold tracking-[-0.018em] text-surface outline-none focus:border-accent/45"
        />
        <h2
          v-else
          class="mt-3 text-[18px] leading-6 font-semibold tracking-[-0.018em] text-surface"
        >
          {{ draft.brief.goal }}
        </h2>
      </header>

      <div class="scrollbar-panel min-h-0 flex-1 overflow-y-auto px-5">
        <template v-if="editing">
          <label class="block border-b border-chrome-border/70 py-4">
            <span class="text-[11px] font-medium text-surface">Request / notes</span>
            <textarea
              v-model="editRequest"
              data-test-id="todo-object-request-input"
              rows="4"
              placeholder="Add context, notes, or pasted code…"
              class="mt-2 w-full resize-y rounded-[7px] border border-chrome-control-border bg-transparent px-2.5 py-2 text-[11.5px] leading-[1.5] text-surface outline-none placeholder:text-muted/65 focus:border-accent/45"
            />
          </label>
          <label class="block border-b border-chrome-border/70 py-4">
            <span class="text-[11px] font-medium text-surface">Outcome</span>
            <textarea
              v-model="editOutcome"
              data-test-id="todo-object-outcome-input"
              rows="2"
              placeholder="What should be true when this is shaped?"
              class="mt-2 w-full resize-y rounded-[7px] border border-chrome-control-border bg-transparent px-2.5 py-2 text-[11.5px] leading-[1.5] text-surface outline-none placeholder:text-muted/65 focus:border-accent/45"
            />
          </label>
          <label class="block border-b border-chrome-border/70 py-4">
            <span class="text-[11px] font-medium text-surface">Plan</span>
            <textarea
              v-model="editPlan"
              data-test-id="todo-object-plan-input"
              rows="4"
              placeholder="One step per line"
              class="mt-2 w-full resize-y rounded-[7px] border border-chrome-control-border bg-transparent px-2.5 py-2 text-[11.5px] leading-[1.5] text-surface outline-none placeholder:text-muted/65 focus:border-accent/45"
            />
          </label>
          <label class="block py-4">
            <span class="text-[11px] font-medium text-surface">Done when</span>
            <textarea
              v-model="editAcceptance"
              data-test-id="todo-object-acceptance-input"
              rows="4"
              placeholder="One check per line"
              class="mt-2 w-full resize-y rounded-[7px] border border-chrome-control-border bg-transparent px-2.5 py-2 text-[11.5px] leading-[1.5] text-surface outline-none placeholder:text-muted/65 focus:border-accent/45"
            />
          </label>
          <div class="flex justify-end gap-2 pb-4">
            <button
              type="button"
              class="h-7 rounded-[7px] px-2.5 text-[10.5px] text-muted hover:bg-hover hover:text-surface"
              @click="
                editing = false;
                resetEditor()
              "
            >
              Cancel
            </button>
            <button
              type="button"
              data-test-id="todo-object-save"
              :disabled="saving || !editGoal.trim()"
              class="h-7 rounded-[7px] bg-surface px-3 text-[10.5px] font-medium text-panel disabled:opacity-40"
              @click="saveEdits"
            >
              {{ saving ? 'Saving…' : 'Save' }}
            </button>
          </div>
        </template>

        <template v-else>
          <div v-if="requestCopy" class="border-b border-chrome-border/70 py-4">
            <h3 class="text-[11px] font-medium text-surface">Request</h3>
            <p class="mt-2 whitespace-pre-wrap text-[12px] leading-[1.55] text-surface/90">
              {{ requestCopy }}
            </p>
          </div>

          <div v-if="draft.brief.desiredOutcome" class="border-b border-chrome-border/70 py-4">
            <h3 class="text-[11px] font-medium text-surface">Outcome</h3>
            <p class="mt-2 whitespace-pre-wrap text-[12px] leading-[1.55] text-surface/90">
              {{ draft.brief.desiredOutcome }}
            </p>
          </div>

          <div v-if="planSteps.length" class="border-b border-chrome-border/70 py-4">
            <h3 class="text-[11px] font-medium text-surface">Plan</h3>
            <ol class="mt-2.5 space-y-2.5">
              <li
                v-for="(step, index) in planSteps"
                :key="`${String(index)}:${step}`"
                class="flex items-start gap-2.5 text-[11.5px] leading-[1.45] text-surface"
              >
                <span
                  class="mt-px flex size-5 shrink-0 items-center justify-center rounded-full border text-[10px] font-medium tabular-nums"
                  :class="
                    index === 0
                      ? 'border-accent bg-accent text-white'
                      : 'border-chrome-control-border text-muted'
                  "
                >
                  {{ index + 1 }}
                </span>
                <span class="pt-0.5">{{ step }}</span>
              </li>
            </ol>
          </div>

          <div v-if="draft.brief.acceptance?.length" class="border-b border-chrome-border/70 py-4">
            <h3 class="text-[11px] font-medium text-surface">Done when</h3>
            <ul class="mt-2.5 space-y-2.5">
              <li
                v-for="check in draft.brief.acceptance"
                :key="check"
                class="flex items-start gap-2.5 text-[11.5px] leading-[1.45] text-surface"
              >
                <icon-lucide-circle-check
                  class="mt-0.5 size-3.5 shrink-0 stroke-[1.6] text-muted"
                />
                <span>{{ check }}</span>
              </li>
            </ul>
          </div>

          <div v-if="draft.brief.references?.length" class="py-4">
            <h3 class="text-[11px] font-medium text-surface">Evidence</h3>
            <ul class="mt-2 divide-y divide-chrome-border/60">
              <li
                v-for="reference in draft.brief.references"
                :key="`${reference.kind}:${reference.id}`"
                class="flex min-h-10 items-center gap-2.5 py-2 text-[11.5px] text-surface"
                :title="reference.note || reference.id"
              >
                <icon-lucide-image
                  v-if="reference.kind === 'image'"
                  class="size-3.5 shrink-0 stroke-[1.6] text-muted"
                />
                <icon-lucide-paperclip v-else class="size-3.5 shrink-0 stroke-[1.6] text-muted" />
                <span class="min-w-0 flex-1 truncate">{{ reference.label }}</span>
              </li>
            </ul>
          </div>

          <p v-if="!hasDetails" class="py-4 text-[11.5px] leading-5 text-muted">
            Add context, files, or images below. Nothing starts until you move this into work.
          </p>
        </template>
      </div>

      <div class="shrink-0 border-t border-chrome-border/70 px-3 py-3">
        <AiPromptInput
          v-model="composerText"
          v-model:attachments="composerAttachments"
          compact
          :disabled="saving"
          label="Add to Todo"
          placeholder="Add text, files, images, or @references…"
          send-label="Add to Todo"
          @send="appendContent"
        />
      </div>

      <div
        v-if="dropping"
        class="pointer-events-none absolute inset-2 z-20 flex items-center justify-center rounded-[10px] border border-accent/60 bg-agent-surface/90 text-[12px] font-medium text-accent"
      >
        Add to this Todo
      </div>
    </template>

    <div v-else class="flex min-h-0 flex-1 items-center justify-center px-6 text-center">
      <div>
        <icon-lucide-panel-right class="mx-auto size-5 text-muted/70" />
        <p class="mt-3 text-[12px] font-medium text-surface">No Todo selected</p>
        <p class="mt-1 text-[11px] leading-4.5 text-muted">
          Open a Todo from the Work Map or its related chat.
        </p>
      </div>
    </div>
  </section>
</template>
