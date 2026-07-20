<script setup lang="ts">
import { computed, nextTick, onUnmounted, ref, watch } from 'vue'
import type {
  FieldSessionPreparationSubmission,
  FieldSessionLaunchSubmission,
  FieldSessionLaunchSurface,
} from './FieldSessionLaunchDialog.types'

const {
  open,
  preparedRunCode = null,
  preparing = false,
  submitting = false,
  surface,
} = defineProps<{
  open: boolean
  preparedRunCode?: string | null
  preparing?: boolean
  submitting?: boolean
  surface: FieldSessionLaunchSurface
}>()

const emit = defineEmits<{
  prepare: [submission: FieldSessionPreparationSubmission]
  start: [submission: FieldSessionLaunchSubmission]
  'update:open': [open: boolean]
}>()

const aliasInput = ref<HTMLInputElement | null>(null)
const participantAlias = ref('')
const phiFreeConfirmed = ref(false)
const runCode = ref('')
let previousFocus: HTMLElement | null = null

const normalizedAlias = computed(() => participantAlias.value.trim())
const normalizedRunCode = computed(() => runCode.value.trim())
const aliasValid = computed(() =>
  /^[A-Za-z0-9][A-Za-z0-9_-]{1,39}$/.test(normalizedAlias.value)
)
const runCodeValid = computed(() =>
  /^[A-Za-z0-9][A-Za-z0-9_-]{1,39}$/.test(normalizedRunCode.value)
)
const canStart = computed(
  () =>
    aliasValid.value &&
    runCodeValid.value &&
    normalizedRunCode.value === preparedRunCode &&
    phiFreeConfirmed.value &&
    !preparing &&
    !submitting
)
const canPrepare = computed(
  () =>
    runCodeValid.value &&
    normalizedRunCode.value !== preparedRunCode &&
    !preparing &&
    !submitting
)
const isPrepared = computed(() =>
  Boolean(preparedRunCode && normalizedRunCode.value === preparedRunCode)
)

function close() {
  if (!submitting) emit('update:open', false)
}

function start() {
  if (!canStart.value) return
  emit('start', {
    participantAlias: normalizedAlias.value,
    phiFreeConfirmed: true,
    runCode: normalizedRunCode.value,
  })
}

function prepare() {
  if (!canPrepare.value) return
  emit('prepare', {
    runCode: normalizedRunCode.value,
  } satisfies FieldSessionPreparationSubmission)
}

function handleKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape') {
    event.preventDefault()
    close()
  }
}

watch(
  () => open,
  async (isOpen) => {
    if (isOpen) {
      previousFocus =
        document.activeElement instanceof HTMLElement
          ? document.activeElement
          : null
      participantAlias.value = ''
      phiFreeConfirmed.value = false
      runCode.value = preparedRunCode ?? ''
      await nextTick()
      aliasInput.value?.focus()
      return
    }
    await nextTick()
    previousFocus?.focus()
    previousFocus = null
  },
  { immediate: true }
)

onUnmounted(() => previousFocus?.focus())
</script>

<template>
  <Teleport to="body">
    <div
      v-if="open"
      data-test-id="field-session-launch-dialog"
      class="fixed inset-0 z-[120] grid place-items-center bg-black/55 p-6 backdrop-blur-sm"
      @pointerdown.self="close"
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="field-session-launch-title"
        aria-describedby="field-session-launch-description"
        :aria-busy="submitting"
        tabindex="-1"
        class="border-border bg-panel text-surface max-h-[92vh] w-full max-w-xl overflow-y-auto rounded-xl border shadow-2xl outline-none"
        @keydown="handleKeydown"
      >
        <header class="flex items-start justify-between gap-6 px-6 pt-6 pb-5">
          <div>
            <p
              class="text-accent text-[9px] font-semibold tracking-[0.16em] uppercase"
            >
              Bound field session
            </p>
            <h2
              id="field-session-launch-title"
              class="mt-1 text-lg font-semibold"
            >
              Start a real observed task
            </h2>
            <p
              id="field-session-launch-description"
              class="text-muted mt-1 max-w-md text-[11px] leading-5"
            >
              Prepare the exact experience first. Only a participant can start
              and produce evidence.
            </p>
          </div>
          <button
            type="button"
            aria-label="Close field session setup"
            :disabled="submitting"
            class="text-muted hover:bg-hover hover:text-surface grid size-8 shrink-0 place-items-center rounded-md disabled:opacity-35"
            @click="close"
          >
            <icon-lucide-x class="size-4" />
          </button>
        </header>

        <section class="border-border bg-background/35 border-y px-6 py-4">
          <div class="flex items-start justify-between gap-5">
            <div class="min-w-0">
              <p class="text-surface text-[11px] font-medium">
                {{ surface.name }}
              </p>
              <p class="text-muted mt-1 text-[9px]">
                {{ surface.formLabel }} · no source or external writes
              </p>
            </div>
            <span
              class="shrink-0 rounded-full border border-emerald-300/20 bg-emerald-300/8 px-2.5 py-1 text-[8px] font-medium text-emerald-200"
            >
              PHI-free only
            </span>
          </div>
          <div
            data-test-id="field-session-task-brief"
            class="border-border bg-panel/70 mt-4 rounded-lg border p-3"
          >
            <p
              class="text-muted text-[8px] font-semibold tracking-[0.12em] uppercase"
            >
              Task
            </p>
            <p class="text-surface mt-1 text-[10px] leading-4">
              {{ surface.taskBrief }}
            </p>
            <p
              class="text-muted mt-2 text-[8px] font-semibold tracking-[0.12em] uppercase"
            >
              Desired outcome
            </p>
            <p class="text-muted mt-1 text-[9px] leading-4">
              {{ surface.desiredOutcome }}
            </p>
            <p class="text-muted mt-2 text-[8px] leading-4">
              {{ surface.evidenceCount }} evidence
              {{ surface.evidenceCount === 1 ? 'item' : 'items' }} ·
              {{ surface.evidenceStatus }} ·
              {{ surface.familyMemberCount }}-surface family · exact revisions
              below
            </p>
          </div>
          <dl
            class="text-muted mt-4 grid grid-cols-2 gap-x-5 gap-y-2 font-mono text-[8px]"
          >
            <div>
              <dt class="text-muted font-sans text-[8px]">Surface</dt>
              <dd class="mt-0.5 leading-3 break-all">
                {{ surface.surfaceRunId }}@{{ surface.surfaceRevision }}
              </dd>
            </div>
            <div>
              <dt class="text-muted font-sans text-[8px]">Artifact</dt>
              <dd class="mt-0.5 leading-3 break-all">
                {{ surface.artifactId }}@{{ surface.artifactRevision }}
              </dd>
            </div>
            <div>
              <dt class="text-muted font-sans text-[8px]">Intent</dt>
              <dd class="mt-0.5 leading-3 break-all">
                {{ surface.intentId }}@{{ surface.intentRevision }}
              </dd>
            </div>
            <div>
              <dt class="text-muted font-sans text-[8px]">Evidence</dt>
              <dd class="mt-0.5 leading-3 break-all">
                {{ surface.evidenceManifestId }}@{{
                  surface.evidenceManifestRevision
                }}
              </dd>
            </div>
          </dl>
        </section>

        <form class="px-6 py-5" @submit.prevent="start">
          <label
            class="grid gap-2 text-[10px] font-medium"
            for="field-session-run"
          >
            Run code
            <span class="flex gap-2">
              <input
                id="field-session-run"
                v-model="runCode"
                data-test-id="field-session-run-code-input"
                autocomplete="off"
                maxlength="40"
                placeholder="B31-S01"
                class="border-border bg-input text-surface placeholder:text-muted focus:border-accent/60 h-10 min-w-0 flex-1 rounded-md border px-3 text-[11px] outline-none"
              />
              <button
                type="button"
                data-test-id="field-session-prepare"
                :disabled="!canPrepare"
                class="border-border text-surface hover:bg-hover h-10 shrink-0 rounded-md border px-3 text-[10px] font-medium disabled:cursor-default disabled:opacity-35"
                @click="prepare"
              >
                {{
                  preparing
                    ? 'Preparing…'
                    : isPrepared
                      ? 'Prepared'
                      : 'Prepare handoff'
                }}
              </button>
            </span>
            <span class="text-muted text-[9px] leading-4 font-normal">
              Study correlation label, not a person’s identity. Preparation is
              durable but does not count as human evidence.
            </span>
          </label>

          <p
            v-if="isPrepared"
            data-test-id="field-session-prepared-status"
            class="mt-3 rounded-md border border-emerald-300/20 bg-emerald-300/8 px-3 py-2 text-[9px] leading-4 text-emerald-100"
          >
            Exact handoff prepared. Participant identity and PHI confirmation
            remain intentionally blank.
          </p>

          <label
            class="mt-5 grid gap-2 text-[10px] font-medium"
            for="field-session-participant"
          >
            Pseudonymous participant code
            <input
              id="field-session-participant"
              ref="aliasInput"
              v-model="participantAlias"
              data-test-id="field-session-participant-input"
              autocomplete="off"
              maxlength="40"
              placeholder="P01"
              class="border-border bg-input text-surface placeholder:text-muted focus:border-accent/60 h-10 rounded-md border px-3 text-[11px] outline-none"
            />
            <span class="text-muted text-[9px] leading-4 font-normal">
              Use a study code, not a name, email, patient identifier, or other
              personal data.
            </span>
          </label>

          <label
            class="border-border bg-background/25 mt-5 flex cursor-pointer items-start gap-3 rounded-lg border p-3"
          >
            <input
              v-model="phiFreeConfirmed"
              data-test-id="field-session-phi-free-confirmation"
              type="checkbox"
              class="mt-0.5 size-4 accent-[var(--color-accent)]"
            />
            <span>
              <b class="text-surface block text-[10px] font-medium">
                Synthetic or public information only
              </b>
              <span class="text-muted mt-1 block text-[9px] leading-4">
                I confirm this task contains no PHI or sensitive personal
                information and requires no source or external-system write.
              </span>
            </span>
          </label>

          <p
            v-if="
              (normalizedAlias && !aliasValid) ||
              (normalizedRunCode && !runCodeValid)
            "
            data-test-id="field-session-alias-error"
            class="mt-3 text-[9px] text-[var(--color-warning-text)]"
          >
            Participant and run codes use 2–40 letters, numbers, hyphens, or
            underscores.
          </p>

          <footer
            class="border-border bg-panel/95 sticky bottom-0 z-10 -mx-6 mt-6 flex items-center justify-between gap-4 border-t px-6 py-4 backdrop-blur"
          >
            <p class="text-muted max-w-xs text-[9px] leading-4">
              Preparation may be automated. Starting, acting, deciding, and
              reviewing remain human.
            </p>
            <div class="flex shrink-0 items-center gap-2">
              <button
                type="button"
                :disabled="submitting"
                class="text-muted hover:bg-hover hover:text-surface h-9 rounded-md px-3 text-[10px] disabled:opacity-40"
                @click="close"
              >
                Cancel
              </button>
              <button
                type="submit"
                data-test-id="field-session-start"
                :disabled="!canStart"
                class="bg-accent h-9 rounded-md px-4 text-[10px] font-medium text-white disabled:cursor-default disabled:opacity-35"
              >
                {{ submitting ? 'Starting…' : 'Start observed task' }}
              </button>
            </div>
          </footer>
        </form>
      </section>
    </div>
  </Teleport>
</template>
