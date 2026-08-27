<script setup lang="ts">
import { computed, ref } from 'vue'

import type { AgentWorkMapSurfaceController } from '@/app/agent-chat/work-map-surface-controller'
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
  type AgentWorkMapBot,
  type AgentWorkMapOperation,
  type AgentWorkMapRoutine
} from '@/app/agent-chat/work-map'
import { toast } from '@/app/shell/ui'
import Tip from '@/components/ui/Tip.vue'

const {
  bots,
  controller,
  directoryId,
  scheduleBot = null
} = defineProps<{
  bots: AgentWorkMapBot[]
  controller: AgentWorkMapSurfaceController
  directoryId: string
  scheduleBot?: AgentWorkMapBot | null
}>()

const {
  isWorkMapScheduledOpen,
  openBot,
  openWorkMapScheduled,
  toggleWorkMapScheduled,
  updateWorkMap,
  workMap
} = controller
const composerOpen = ref(false)
const busy = ref(false)
const launchingRoutineId = ref<string | null>(null)
const prompt = ref('')
const firstRun = ref(defaultWorkMapRoutineFirstRun())
const repeat = ref<WorkMapRoutineRepeat>('daily')
const briefingObject = ref(false)
const routines = computed(() => bots.flatMap((bot) => workMapRoutinesForBot(workMap.value, bot.id)))

function openScheduledComposer() {
  openWorkMapScheduled(directoryId)
  composerOpen.value = true
}

async function applyOperations(operations: AgentWorkMapOperation[]): Promise<boolean> {
  const current = workMap.value
  if (!current || busy.value) return false
  busy.value = true
  try {
    updateWorkMap(
      await applyAgentWorkMap({
        expectedRevision: current.revision,
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

async function submitSchedule() {
  const bot = scheduleBot
  const schedulePrompt = prompt.value.trim()
  const date = new Date(firstRun.value)
  if (!bot || !schedulePrompt || !Number.isFinite(date.getTime())) return
  const everyMinutes = workMapRoutineIntervalMinutes(repeat.value)
  const saved = await applyOperations([
    {
      bot_id: bot.id,
      create_briefing_object: briefingObject.value,
      ...(everyMinutes ? { every_minutes: everyMinutes } : {}),
      next_run_at: date.toISOString(),
      op: 'create_routine',
      prompt: schedulePrompt
    }
  ])
  if (!saved) return
  prompt.value = ''
  briefingObject.value = false
  firstRun.value = defaultWorkMapRoutineFirstRun()
  composerOpen.value = false
}

async function deleteSchedule(routine: AgentWorkMapRoutine) {
  await applyOperations([{ op: 'delete_routine', routine_id: routine.id }])
}

async function toggleScheduleBriefing(routine: AgentWorkMapRoutine) {
  await applyOperations([
    {
      create_briefing_object: !routine.briefingObject,
      op: 'update_routine',
      routine_id: routine.id
    }
  ])
}

function routineIsRunning(routine: AgentWorkMapRoutine): boolean {
  return (
    launchingRoutineId.value === routine.id || isWorkMapRoutineRunning(workMap.value, routine.id)
  )
}

async function openRoutineChat(routine: AgentWorkMapRoutine) {
  const bot = bots.find((candidate) => candidate.id === routine.botId)
  if (!bot) {
    toast.error('Bot chat unavailable')
    return
  }
  await openBot(bot)
}

async function runScheduleNow(routine: AgentWorkMapRoutine) {
  if (busy.value || routineIsRunning(routine)) return
  busy.value = true
  launchingRoutineId.value = routine.id
  try {
    updateWorkMap(await runAgentWorkMapRoutine(routine.id))
    toast.info('Scheduled run started')
  } catch (cause) {
    toast.error(cause instanceof Error ? cause.message : 'Scheduled work could not start')
    try {
      updateWorkMap(await getAgentWorkMap())
    } catch (refreshCause) {
      console.warn('Work Map refresh failed after the scheduled run error', refreshCause)
    }
  } finally {
    launchingRoutineId.value = null
    busy.value = false
  }
}
</script>

<template>
  <section class="relative mb-0.5" :data-test-id="`work-map-scheduled-${directoryId}`">
    <div
      role="button"
      tabindex="0"
      :data-test-id="`work-map-scheduled-toggle-${directoryId}`"
      :aria-expanded="isWorkMapScheduledOpen(directoryId)"
      :aria-label="`${isWorkMapScheduledOpen(directoryId) ? 'Collapse' : 'Expand'} Scheduled`"
      class="group/scheduled flex h-8 cursor-pointer items-center gap-2 rounded-[6px] px-2 text-[13px] font-medium text-surface transition-colors hover:bg-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-component/35"
      @click="toggleWorkMapScheduled(directoryId)"
      @keydown.enter.prevent="toggleWorkMapScheduled(directoryId)"
      @keydown.space.prevent="toggleWorkMapScheduled(directoryId)"
    >
      <span class="relative z-10 flex h-8 w-6 shrink-0 items-center justify-center">
        <icon-lucide-calendar-clock class="size-[16px] stroke-[1.65] text-[#3b82f6]" />
      </span>
      <span>Scheduled</span>
      <span class="min-w-0 flex-1" />
      <Tip v-if="scheduleBot" label="Add scheduled work">
        <button
          type="button"
          :data-test-id="`work-map-add-scheduled-${directoryId}`"
          aria-label="Add scheduled work"
          class="flex size-6 items-center justify-center text-muted opacity-0 transition-opacity hover:text-surface focus:opacity-100 focus-visible:outline-none focus-visible:text-surface group-hover/scheduled:opacity-100"
          @click.stop="openScheduledComposer"
        >
          <IconlyIcon name="plus" class="size-4 stroke-[1.7]" />
        </button>
      </Tip>
    </div>

    <Transition
      enter-active-class="grid overflow-hidden transition-[grid-template-rows,opacity] duration-300 ease-in-out motion-reduce:transition-none"
      enter-from-class="grid-rows-[0fr] opacity-0"
      enter-to-class="grid-rows-[1fr] opacity-100"
      leave-active-class="grid overflow-hidden transition-[grid-template-rows,opacity] duration-300 ease-in-out motion-reduce:transition-none"
      leave-from-class="grid-rows-[1fr] opacity-100"
      leave-to-class="grid-rows-[0fr] opacity-0"
    >
      <div
        v-if="isWorkMapScheduledOpen(directoryId)"
        :data-test-id="`work-map-scheduled-content-${directoryId}`"
      >
        <div class="min-h-0 overflow-hidden">
          <div
            v-if="composerOpen"
            :data-test-id="`work-map-scheduled-composer-${directoryId}`"
            class="border-work-map-tree/70 bg-chrome-control/30 relative z-20 mr-2 mb-1 ml-8 rounded-[7px] border px-2 py-2"
            @keydown.esc.stop="composerOpen = false"
          >
            <form class="space-y-1.5" @submit.prevent="submitSchedule">
              <textarea
                v-model="prompt"
                rows="2"
                aria-label="Scheduled work"
                placeholder="What should this Bot take care of?"
                class="border-chrome-control-border bg-chrome-control w-full resize-none rounded-[6px] border px-2 py-1.5 text-[10px] leading-3.5 text-surface outline-none placeholder:text-muted/55 focus:border-accent/45 focus:ring-1 focus:ring-accent/15"
              />
              <div class="grid grid-cols-[1fr_78px] gap-1.5">
                <input
                  v-model="firstRun"
                  aria-label="First run"
                  type="datetime-local"
                  class="border-chrome-control-border bg-chrome-control h-7 min-w-0 rounded-[6px] border px-1.5 text-[9px] text-surface outline-none focus:border-accent/45"
                />
                <select
                  v-model="repeat"
                  aria-label="Repeat"
                  class="border-chrome-control-border bg-chrome-control h-7 rounded-[6px] border px-1 text-[9px] text-surface outline-none focus:border-accent/45"
                >
                  <option value="once">Once</option>
                  <option value="hourly">Hourly</option>
                  <option value="daily">Daily</option>
                  <option value="weekly">Weekly</option>
                </select>
              </div>
              <label
                class="flex min-h-7 cursor-pointer items-center gap-2 rounded-[6px] px-1.5 text-[9.5px] text-muted hover:bg-hover/55 hover:text-surface"
              >
                <input
                  v-model="briefingObject"
                  type="checkbox"
                  data-test-id="work-map-scheduled-briefing-object"
                  class="size-3 rounded border-chrome-control-border accent-accent"
                />
                <span>Create a briefing object</span>
              </label>
              <div class="flex justify-end gap-1">
                <button
                  type="button"
                  class="h-6 rounded-[5px] px-2 text-[9.5px] text-muted hover:bg-hover hover:text-surface"
                  @click.stop="composerOpen = false"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  :disabled="busy || !prompt.trim() || !firstRun"
                  class="h-6 rounded-[5px] bg-accent px-2 text-[9.5px] font-medium text-white disabled:opacity-40"
                >
                  Add
                </button>
              </div>
            </form>
          </div>

          <div
            v-for="(routine, routineIndex) in routines"
            :key="routine.id"
            :data-test-id="`work-map-scheduled-item-${routine.id}`"
            class="group/schedule relative z-10 ml-8 flex min-h-8 items-center gap-1.5 rounded-[7px] pr-1 pl-2 text-left before:pointer-events-none before:absolute before:top-2.5 before:-left-3 before:h-1.5 before:w-3 before:rounded-bl-[6px] before:border-b before:border-l before:border-work-map-tree before:content-[''] after:pointer-events-none after:absolute after:top-0 after:-left-3 after:border-l after:border-work-map-tree after:content-[''] hover:bg-hover"
            :class="routineIndex === routines.length - 1 ? 'after:h-2.5' : 'after:h-full'"
          >
            <button
              type="button"
              :aria-label="`Open scheduled chat: ${routine.prompt}`"
              class="min-w-0 flex-1 rounded-[5px] text-left focus-visible:bg-hover focus-visible:outline-none"
              @click="openRoutineChat(routine)"
            >
              <span class="block truncate text-[12px] leading-4 text-surface">{{
                routine.prompt
              }}</span>
              <span class="block truncate text-[10px] leading-3.5 text-muted/65">
                {{ workMapRoutineCadence(routine) }} ·
                {{ formatWorkMapRoutineTime(routine.nextRunAt) }}
              </span>
            </button>
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
                :data-test-id="`work-map-toggle-briefing-${routine.id}`"
                :disabled="busy"
                class="pointer-events-none flex size-6 shrink-0 items-center justify-center rounded-[5px] opacity-0 transition-opacity hover:bg-chrome-control hover:text-surface focus:pointer-events-auto focus:opacity-100 group-hover/schedule:pointer-events-auto group-hover/schedule:opacity-100 group-focus-within/schedule:pointer-events-auto group-focus-within/schedule:opacity-100 disabled:opacity-30"
                :class="routine.briefingObject ? 'text-accent' : 'text-muted'"
                @click.stop="toggleScheduleBriefing(routine)"
              >
                <icon-lucide-file-text class="size-3.5 stroke-[1.6]" />
              </button>
            </Tip>
            <Tip :label="routineIsRunning(routine) ? 'Running' : 'Run now'">
              <button
                type="button"
                :aria-label="
                  routineIsRunning(routine) ? 'Scheduled work running' : 'Run scheduled work now'
                "
                :disabled="busy || routineIsRunning(routine)"
                :data-test-id="`work-map-run-scheduled-${routine.id}`"
                class="flex size-6 shrink-0 items-center justify-center rounded-[5px] text-muted transition-opacity hover:bg-chrome-control hover:text-surface"
                :class="
                  routineIsRunning(routine)
                    ? 'opacity-100 text-accent'
                    : 'opacity-0 focus:opacity-100 group-hover/schedule:opacity-100 disabled:opacity-30'
                "
                @click.stop="runScheduleNow(routine)"
              >
                <icon-lucide-loader-circle
                  v-if="routineIsRunning(routine)"
                  class="size-3.5 animate-spin stroke-[1.7] motion-reduce:animate-none"
                />
                <icon-lucide-play v-else class="size-3.5 stroke-[1.7]" />
              </button>
            </Tip>
            <Tip label="Delete scheduled work">
              <button
                type="button"
                aria-label="Delete scheduled work"
                :disabled="busy"
                :data-test-id="`work-map-delete-scheduled-${routine.id}`"
                class="flex size-6 shrink-0 items-center justify-center rounded-[5px] text-muted opacity-0 transition-opacity hover:bg-chrome-control hover:text-surface focus:opacity-100 group-hover/schedule:opacity-100 disabled:opacity-30"
                @click.stop="deleteSchedule(routine)"
              >
                <icon-lucide-trash-2 class="size-3.5 stroke-[1.7]" />
              </button>
            </Tip>
          </div>

          <div
            v-if="!routines.length && !composerOpen"
            :data-test-id="`work-map-empty-scheduled-${directoryId}`"
            class="relative z-10 ml-8 flex h-7 items-center pr-2 pl-2 text-[12px] text-muted/55 before:pointer-events-none before:absolute before:top-2 before:-left-3 before:h-1.5 before:w-3 before:rounded-bl-[6px] before:border-b before:border-l before:border-work-map-tree before:content-[''] after:pointer-events-none after:absolute after:top-0 after:-left-3 after:h-2 after:border-l after:border-work-map-tree after:content-['']"
          >
            No scheduled work
          </div>
        </div>
      </div>
    </Transition>
  </section>
</template>
