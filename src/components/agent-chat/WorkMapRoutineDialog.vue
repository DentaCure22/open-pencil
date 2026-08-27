<script setup lang="ts">
import {
  DialogContent,
  DialogDescription,
  DialogOverlay,
  DialogPortal,
  DialogRoot,
  DialogTitle
} from 'reka-ui'
import { computed, ref, watch } from 'vue'

import {
  defaultWorkMapRoutineFirstRun,
  formatWorkMapRoutineTime,
  isWorkMapRoutineRunning,
  workMapRoutineCadence,
  workMapRoutineIntervalMinutes,
  workMapRoutinesForBot,
  type WorkMapRoutineRepeat
} from '@/app/agent-chat/work-map-routines'
import {
  applyAgentWorkMap,
  getAgentWorkMap,
  runAgentWorkMapRoutine,
  type AgentWorkMap,
  type AgentWorkMapBot,
  type AgentWorkMapOperation,
  type AgentWorkMapRoutine
} from '@/app/agent-chat/work-map'
import { toast } from '@/app/shell/ui'
import Tip from '@/components/ui/Tip.vue'
import { useDialogUI } from '@/components/ui/dialog'

const { bot, botTitle, workMap } = defineProps<{
  bot: AgentWorkMapBot | null
  botTitle: string
  workMap: AgentWorkMap | null
}>()

const emit = defineEmits<{
  close: []
  updated: [workMap: AgentWorkMap]
}>()

const dialog = useDialogUI({ content: 'w-[min(460px,calc(100vw-2rem))]' })
const busy = ref(false)
const prompt = ref('')
const firstRun = ref('')
const repeat = ref<WorkMapRoutineRepeat>('daily')
const briefingObject = ref(false)
const routines = computed(() => (bot ? workMapRoutinesForBot(workMap, bot.id) : []))

watch(
  () => bot?.id,
  (botId) => {
    prompt.value = ''
    firstRun.value = botId ? defaultWorkMapRoutineFirstRun() : ''
    repeat.value = 'daily'
    briefingObject.value = false
  },
  { immediate: true }
)

async function applyOperations(operations: AgentWorkMapOperation[]): Promise<boolean> {
  if (!workMap || busy.value) return false
  busy.value = true
  try {
    emit(
      'updated',
      await applyAgentWorkMap({
        expectedRevision: workMap.revision,
        operations
      })
    )
    return true
  } catch (cause) {
    toast.error(cause instanceof Error ? cause.message : 'Work map update failed')
    return false
  } finally {
    busy.value = false
  }
}

async function submitRoutine() {
  const botId = bot?.id
  const routinePrompt = prompt.value.trim()
  const date = new Date(firstRun.value)
  if (!botId || !routinePrompt || !Number.isFinite(date.getTime())) return
  const everyMinutes = workMapRoutineIntervalMinutes(repeat.value)
  const saved = await applyOperations([
    {
      bot_id: botId,
      create_briefing_object: briefingObject.value,
      ...(everyMinutes ? { every_minutes: everyMinutes } : {}),
      next_run_at: date.toISOString(),
      op: 'create_routine',
      prompt: routinePrompt
    }
  ])
  if (saved) {
    prompt.value = ''
    briefingObject.value = false
  }
}

async function deleteRoutine(routine: AgentWorkMapRoutine) {
  await applyOperations([{ op: 'delete_routine', routine_id: routine.id }])
}

async function toggleRoutineBriefing(routine: AgentWorkMapRoutine) {
  await applyOperations([
    {
      create_briefing_object: !routine.briefingObject,
      op: 'update_routine',
      routine_id: routine.id
    }
  ])
}

async function runRoutineNow(routine: AgentWorkMapRoutine) {
  if (busy.value) return
  busy.value = true
  try {
    emit('updated', await runAgentWorkMapRoutine(routine.id))
    toast.info('Bot run added to Inbox')
  } catch (cause) {
    toast.error(cause instanceof Error ? cause.message : 'Bot routine could not start')
    try {
      emit('updated', await getAgentWorkMap())
    } catch (refreshCause) {
      console.warn('Work Map refresh failed after the routine error', refreshCause)
    }
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <DialogRoot :open="Boolean(bot)" @update:open="!$event && emit('close')">
    <DialogPortal>
      <DialogOverlay :class="dialog.overlay" />
      <DialogContent data-test-id="work-map-routine-dialog" :class="dialog.content">
        <div class="p-4">
          <DialogTitle :class="dialog.title">Schedule {{ botTitle }}</DialogTitle>
          <DialogDescription :class="[dialog.description, 'mt-1']">
            Each run continues this Bot chat and leaves a receipt in Inbox.
          </DialogDescription>

          <div v-if="routines.length" class="mt-4 space-y-1.5">
            <div
              v-for="routine in routines"
              :key="routine.id"
              :data-test-id="`work-map-routine-${routine.id}`"
              class="border-chrome-control-border bg-chrome-control/50 flex items-center gap-2 rounded-[9px] border px-2.5 py-2"
            >
              <span class="min-w-0 flex-1">
                <span class="block truncate text-[11px] font-medium text-surface">{{
                  routine.prompt
                }}</span>
                <span class="mt-0.5 block text-[9.5px] text-muted/70">
                  {{ workMapRoutineCadence(routine) }} ·
                  {{ formatWorkMapRoutineTime(routine.nextRunAt) }}
                </span>
              </span>
              <Tip
                :label="
                  routine.briefingObject
                    ? 'Stop creating briefing objects'
                    : 'Create briefing objects'
                "
              >
                <button
                  type="button"
                  :aria-label="
                    routine.briefingObject
                      ? 'Stop creating briefing objects'
                      : 'Create briefing objects'
                  "
                  :data-test-id="`work-map-toggle-routine-briefing-${routine.id}`"
                  :disabled="busy"
                  class="flex size-7 items-center justify-center rounded-[7px] hover:bg-hover disabled:opacity-35"
                  :class="routine.briefingObject ? 'text-accent' : 'text-muted'"
                  @click="toggleRoutineBriefing(routine)"
                >
                  <icon-lucide-file-text class="size-3.5 stroke-[1.7]" />
                </button>
              </Tip>
              <Tip :label="isWorkMapRoutineRunning(workMap, routine.id) ? 'Running' : 'Run now'">
                <button
                  type="button"
                  aria-label="Run now"
                  :disabled="busy || isWorkMapRoutineRunning(workMap, routine.id)"
                  :data-test-id="`work-map-run-routine-${routine.id}`"
                  class="flex size-7 items-center justify-center rounded-[7px] text-muted hover:bg-hover hover:text-surface disabled:opacity-35"
                  @click="runRoutineNow(routine)"
                >
                  <icon-lucide-play class="size-3.5 stroke-[1.7]" />
                </button>
              </Tip>
              <Tip label="Delete schedule">
                <button
                  type="button"
                  aria-label="Delete schedule"
                  :disabled="busy"
                  :data-test-id="`work-map-delete-routine-${routine.id}`"
                  class="flex size-7 items-center justify-center rounded-[7px] text-muted hover:bg-hover hover:text-surface disabled:opacity-35"
                  @click="deleteRoutine(routine)"
                >
                  <icon-lucide-trash-2 class="size-3.5 stroke-[1.7]" />
                </button>
              </Tip>
            </div>
          </div>

          <form class="mt-4" @submit.prevent="submitRoutine">
            <label class="block text-[10px] font-medium text-muted" for="work-map-routine-prompt">
              What should it do?
            </label>
            <textarea
              id="work-map-routine-prompt"
              v-model="prompt"
              data-test-id="work-map-routine-prompt"
              rows="3"
              placeholder="Review open work and summarize what needs attention."
              class="border-chrome-control-border bg-chrome-control mt-1.5 w-full resize-none rounded-[9px] border px-3 py-2 text-[11px] leading-4 text-surface outline-none placeholder:text-muted/60 focus:border-accent/55 focus:ring-2 focus:ring-accent/15"
            />
            <div class="mt-3 grid grid-cols-[1fr_120px] gap-2">
              <label class="block text-[10px] font-medium text-muted">
                First run
                <input
                  v-model="firstRun"
                  data-test-id="work-map-routine-first-run"
                  type="datetime-local"
                  class="border-chrome-control-border bg-chrome-control mt-1.5 h-9 w-full rounded-[9px] border px-2.5 text-[11px] text-surface outline-none focus:border-accent/55 focus:ring-2 focus:ring-accent/15"
                />
              </label>
              <label class="block text-[10px] font-medium text-muted">
                Repeat
                <select
                  v-model="repeat"
                  data-test-id="work-map-routine-repeat"
                  class="border-chrome-control-border bg-chrome-control mt-1.5 h-9 w-full rounded-[9px] border px-2.5 text-[11px] text-surface outline-none focus:border-accent/55 focus:ring-2 focus:ring-accent/15"
                >
                  <option value="once">Once</option>
                  <option value="hourly">Hourly</option>
                  <option value="daily">Daily</option>
                  <option value="weekly">Weekly</option>
                </select>
              </label>
            </div>
            <label
              class="mt-2 flex min-h-8 cursor-pointer items-center gap-2 rounded-[7px] px-2 text-[10px] text-muted hover:bg-hover/55 hover:text-surface"
            >
              <input
                v-model="briefingObject"
                type="checkbox"
                data-test-id="work-map-routine-briefing-object"
                class="size-3.5 rounded border-chrome-control-border accent-accent"
              />
              <span>Create a briefing object for each successful run</span>
            </label>
            <p class="mt-2 text-[9.5px] leading-4 text-muted/65">
              Scheduled work runs while OpenPencil's local authority is open.
            </p>
            <div class="mt-4 flex justify-end gap-2">
              <button
                type="button"
                class="h-8 rounded-[8px] px-3 text-[11px] text-muted hover:bg-hover hover:text-surface"
                @click="emit('close')"
              >
                Close
              </button>
              <button
                type="submit"
                :disabled="busy || !prompt.trim() || !firstRun"
                class="h-8 rounded-[8px] bg-accent px-3 text-[11px] font-medium text-white disabled:cursor-default disabled:opacity-40"
              >
                Add schedule
              </button>
            </div>
          </form>
        </div>
      </DialogContent>
    </DialogPortal>
  </DialogRoot>
</template>
