<script setup lang="ts">
import { computed, nextTick, onUnmounted, reactive, ref, watch } from 'vue'

import type { ObservedHumanSessionState } from '@/app/human-sessions'
import { retainedComparisonBaseline } from '@/app/learning-receipts'

import type {
  HumanLearningComparison,
  HumanLearningCompositionGateSummary,
  HumanLearningCompositionSummary,
  HumanLearningFormDisposition,
  HumanLearningOutcome,
  HumanLearningReviewSubmission,
  HumanLearningStaticBaseline,
  HumanLearningSurfaceSummary
} from './HumanLearningReviewDialog.types'

const {
  baseline,
  composition,
  compositionGate,
  open,
  session,
  surface,
  submitting = false
} = defineProps<{
  baseline: HumanLearningStaticBaseline
  composition: HumanLearningCompositionSummary[]
  compositionGate: HumanLearningCompositionGateSummary
  open: boolean
  session: ObservedHumanSessionState
  surface: HumanLearningSurfaceSummary
  submitting?: boolean
}>()

const emit = defineEmits<{
  submit: [review: HumanLearningReviewSubmission]
  'update:open': [open: boolean]
}>()

type QualityKey = 'visualAccepted' | 'keyboardAccepted' | 'evidenceTraceable' | 'safetyProblem'

type QualityState = Record<QualityKey, boolean | null>

const outcomeOptions: Array<{ value: HumanLearningOutcome; label: string }> = [
  { value: 'passed', label: 'Passed' },
  { value: 'failed', label: 'Failed' },
  { value: 'abandoned', label: 'Abandoned' }
]

const dispositionOptions: Array<{ value: HumanLearningFormDisposition; label: string }> = [
  { value: 'accepted', label: 'Accepted' },
  { value: 'overridden', label: 'Overridden' },
  { value: 'abandoned', label: 'Abandoned' }
]

const comparisonOptions: Array<{ value: HumanLearningComparison; label: string }> = [
  { value: 'better', label: 'Better' },
  { value: 'same', label: 'Same' },
  { value: 'worse', label: 'Worse' },
  { value: 'not-run', label: 'Not run' }
]

const qualityQuestions: Array<{
  key: QualityKey
  label: string
  testHook: string
  warning?: boolean
}> = [
  {
    key: 'visualAccepted',
    label: 'Visual result accepted',
    testHook: 'visual-accepted'
  },
  {
    key: 'keyboardAccepted',
    label: 'Keyboard path accepted',
    testHook: 'keyboard-accepted'
  },
  {
    key: 'evidenceTraceable',
    label: 'Evidence traceable',
    testHook: 'evidence-traceable'
  },
  {
    key: 'safetyProblem',
    label: 'Any safety problem',
    testHook: 'safety-problem',
    warning: true
  }
]

const dialogElement = ref<HTMLElement | null>(null)
const idempotencyKey = ref('')
const jobCompleted = ref<boolean | null>(null)
const outcome = ref<HumanLearningOutcome | null>(null)
const formDisposition = ref<HumanLearningFormDisposition | null>(null)
const comparison = ref<HumanLearningComparison>('not-run')
const compositionOutcomes = ref<
  Record<string, { outcome: 'distracted' | 'duplicated' | 'helped'; reviewedAt: string }>
>({})
const baselineReviewedAt = ref<string | null>(null)
const repairCount = ref(0)
const feedback = ref('')
const quality = reactive<QualityState>({
  evidenceTraceable: null,
  keyboardAccepted: null,
  safetyProblem: null,
  visualAccepted: null
})

let previousFocus: HTMLElement | null = null

const qualityComplete = computed(() =>
  qualityQuestions.every((question) => quality[question.key] !== null)
)

const canSubmit = computed(
  () =>
    jobCompleted.value !== null &&
    outcome.value !== null &&
    formDisposition.value !== null &&
    (comparison.value === 'not-run' || baselineReviewedAt.value !== null) &&
    composition.every((item) => Boolean(compositionOutcomes.value[item.relation.relationId])) &&
    qualityComplete.value &&
    Number.isInteger(repairCount.value) &&
    repairCount.value >= 0 &&
    feedback.value.trim().length > 0
)

function resetReview() {
  idempotencyKey.value = `human-learning-review-${crypto.randomUUID()}`
  jobCompleted.value = null
  outcome.value = null
  formDisposition.value = null
  comparison.value = 'not-run'
  compositionOutcomes.value = {}
  baselineReviewedAt.value = null
  repairCount.value = 0
  feedback.value = ''
  quality.evidenceTraceable = null
  quality.keyboardAccepted = null
  quality.safetyProblem = null
  quality.visualAccepted = null
}

function setCompositionOutcome(
  item: HumanLearningCompositionSummary,
  outcome: 'distracted' | 'duplicated' | 'helped'
) {
  compositionOutcomes.value = {
    ...compositionOutcomes.value,
    [item.relation.relationId]: { outcome, reviewedAt: new Date().toISOString() }
  }
}

function close() {
  if (submitting) return
  emit('update:open', false)
}

function optionClass(selected: boolean) {
  return selected
    ? 'border-accent/60 bg-accent/10 text-surface'
    : 'border-border text-muted hover:bg-hover hover:text-surface'
}

function qualityChoiceClass(selected: boolean, warning: boolean) {
  if (!selected) return 'border-border text-muted hover:bg-hover hover:text-surface'
  if (warning) {
    return 'border-[var(--color-warning-border)] bg-[var(--color-warning-bg)] text-[var(--color-warning-text)]'
  }
  return 'border-accent/60 bg-accent/10 text-surface'
}

function setQuality(key: QualityKey, value: boolean) {
  quality[key] = value
}

function markBaselineReviewed(event: Event) {
  if (
    event.currentTarget instanceof HTMLDetailsElement &&
    event.currentTarget.open &&
    !baselineReviewedAt.value
  ) {
    baselineReviewedAt.value = new Date().toISOString()
  }
}

function handleDialogKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape') {
    event.preventDefault()
    close()
    return
  }
  if (event.key !== 'Tab' || !dialogElement.value) return

  const controls = Array.from(
    dialogElement.value.querySelectorAll<HTMLElement>(
      'button:not([disabled]), input:not([disabled]), textarea:not([disabled]), summary'
    )
  ).filter((control) => control.offsetParent !== null)

  if (controls.length === 0) {
    event.preventDefault()
    return
  }

  const first = controls[0]
  const last = controls.at(-1)
  const active = document.activeElement

  if (event.shiftKey && (active === first || active === dialogElement.value)) {
    event.preventDefault()
    last?.focus()
  } else if (!event.shiftKey && active === last) {
    event.preventDefault()
    first?.focus()
  }
}

function submit() {
  if (
    submitting ||
    !canSubmit.value ||
    jobCompleted.value === null ||
    outcome.value === null ||
    formDisposition.value === null ||
    quality.visualAccepted === null ||
    quality.keyboardAccepted === null ||
    quality.evidenceTraceable === null ||
    quality.safetyProblem === null
  ) {
    return
  }

  const compositionEvaluations = composition.flatMap((item) => {
    const evaluation = compositionOutcomes.value[item.relation.relationId]
    if (!evaluation) return []
    return [
      {
        companionSurface: item.companionSurface,
        outcome: evaluation.outcome,
        primarySurface: item.primarySurface,
        relation: item.relation,
        reviewedAt: evaluation.reviewedAt
      }
    ]
  })
  emit('submit', {
    comparisonBaseline: baselineReviewedAt.value
      ? retainedComparisonBaseline(baseline, baselineReviewedAt.value)
      : undefined,
    comparison: comparison.value,
    compositionEvaluations: compositionEvaluations.length ? compositionEvaluations : undefined,
    evidenceTraceable: quality.evidenceTraceable,
    feedback: feedback.value.trim(),
    formDisposition: formDisposition.value,
    idempotencyKey: idempotencyKey.value,
    jobCompleted: jobCompleted.value,
    keyboardAccepted: quality.keyboardAccepted,
    outcome: outcome.value,
    repairCount: repairCount.value,
    safetyProblem: quality.safetyProblem,
    visualAccepted: quality.visualAccepted
  })
}

watch(
  () => open,
  async (isOpen) => {
    if (isOpen) {
      previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null
      resetReview()
      await nextTick()
      dialogElement.value?.focus()
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
      data-test-id="human-learning-review-dialog"
      class="fixed inset-0 z-[120] grid place-items-center bg-black/55 p-6 backdrop-blur-sm"
      @pointerdown.self="close"
    >
      <section
        ref="dialogElement"
        role="dialog"
        aria-modal="true"
        aria-labelledby="human-learning-review-title"
        aria-describedby="human-learning-review-description"
        :aria-busy="submitting"
        tabindex="-1"
        class="max-h-[92vh] w-full max-w-2xl overflow-y-auto rounded-xl border border-border bg-panel text-surface shadow-2xl outline-none"
        @keydown="handleDialogKeydown"
      >
        <header class="flex items-start justify-between gap-6 px-6 pt-6 pb-5">
          <div>
            <p class="text-[9px] font-semibold tracking-[0.16em] text-accent uppercase">
              Human learning review
            </p>
            <h2 id="human-learning-review-title" class="mt-1 text-lg font-semibold">
              Did this finish the intended job?
            </h2>
            <p
              id="human-learning-review-description"
              class="mt-1 max-w-lg text-[11px] leading-5 text-muted"
            >
              Record what actually happened so the next surface choice can improve.
            </p>
          </div>
          <button
            type="button"
            data-test-id="human-learning-review-close"
            aria-label="Close human learning review"
            :disabled="submitting"
            class="grid size-8 shrink-0 place-items-center rounded-md text-muted hover:bg-hover hover:text-surface disabled:cursor-default disabled:opacity-35"
            @click="close"
          >
            <icon-lucide-x class="size-4" />
          </button>
        </header>

        <dl
          data-test-id="human-learning-surface-summary"
          class="grid grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)_minmax(0,1fr)_auto] border-y border-border bg-background/45 px-6 py-3 text-[9px] max-sm:grid-cols-2 max-sm:gap-y-3"
        >
          <div class="min-w-0 pr-4">
            <dt class="text-muted">Surface</dt>
            <dd class="mt-0.5 truncate font-medium text-surface">{{ surface.name }}</dd>
          </div>
          <div class="min-w-0 border-l border-border px-4 max-sm:border-l-0 max-sm:px-0">
            <dt class="text-muted">Form</dt>
            <dd class="mt-0.5 truncate">{{ surface.formLabel }}</dd>
          </div>
          <div class="min-w-0 border-l border-border px-4 max-sm:border-l-0 max-sm:px-0">
            <dt class="text-muted">Renderer</dt>
            <dd class="mt-0.5 truncate font-mono text-[8px]">{{ surface.renderer }}</dd>
          </div>
          <div class="border-l border-border pl-4 max-sm:border-l-0 max-sm:pl-0">
            <dt class="text-muted">Decision</dt>
            <dd
              class="mt-0.5"
              :class="surface.decided ? 'text-[var(--color-success)]' : 'text-muted'"
            >
              {{ surface.decided ? 'Decided' : 'Open' }}
            </dd>
          </div>
        </dl>

        <div
          data-test-id="human-learning-session-evidence"
          class="border-b border-border px-6 py-3 text-[10px] leading-4"
          :class="
            session.status === 'ready' || session.status === 'issued'
              ? 'bg-emerald-400/8 text-emerald-200'
              : session.status === 'active'
                ? 'bg-amber-400/8 text-amber-200'
                : 'bg-background/30 text-muted'
          "
        >
          <span v-if="session.status === 'ready' || session.status === 'issued'">
            Exact field session ready · {{ session.interactionCount }} applied task
            {{ session.interactionCount === 1 ? 'action' : 'actions' }}. This review can carry
            verified field proof for the bound surface.
          </span>
          <span v-else-if="session.status === 'active'">
            Exact field session active · {{ session.interactionCount }} applied task
            {{ session.interactionCount === 1 ? 'action' : 'actions' }}. Complete at least one task
            action inside the surface and keep the window focused for three seconds.
          </span>
          <span v-else-if="session.status === 'expired'">
            This exact field session expired before proof was committed. The outcome can still be
            retained honestly as self-report, but it will not advance the verified field gate.
          </span>
          <span v-else-if="session.status === 'aborted'">
            This exact field session was aborted. The outcome can still be retained honestly as
            self-report, but no observed proof will be claimed.
          </span>
          <span v-else>
            No active observed session. This review will be stored honestly as self-report.
          </span>
        </div>

        <section
          v-if="composition.length"
          data-test-id="human-learning-composition"
          class="border-b border-border bg-violet-400/5 px-6 py-5"
        >
          <div class="flex items-start justify-between gap-5">
            <div>
              <p class="text-[10px] font-medium text-surface">
                Did each companion view earn its place?
              </p>
              <p class="mt-1 text-[9px] leading-4 text-muted">
                Judge the extra view, not the visual arrangement. The exact shared-lineage pair is
                retained.
              </p>
            </div>
            <span
              data-test-id="human-learning-composition-gate"
              class="shrink-0 rounded-full border border-violet-300/20 bg-violet-300/8 px-2.5 py-1 text-[8px] font-medium text-violet-200"
            >
              Verified field proof {{ compositionGate.verifiedHumanRuns }}/{{
                compositionGate.requiredVerifiedHumanRuns
              }}
            </span>
          </div>
          <div class="mt-4 grid gap-3">
            <article
              v-for="item in composition"
              :key="item.relation.relationId"
              class="rounded-lg border border-border bg-panel/80 p-3"
            >
              <div class="flex items-start justify-between gap-4">
                <div class="min-w-0">
                  <p class="truncate text-[10px] font-medium text-surface">
                    {{ item.companionName }}
                  </p>
                  <p class="mt-0.5 truncate text-[8px] text-muted">
                    Companion to {{ item.primaryName }} · {{ item.companionRenderer }}
                  </p>
                </div>
                <code class="max-w-44 truncate text-[7px] text-muted">
                  {{ item.relation.relationId }}@{{ item.relation.revision }}
                </code>
              </div>
              <div
                class="mt-3 grid grid-cols-3 gap-1.5"
                role="radiogroup"
                :aria-label="`Usefulness of ${item.companionName}`"
              >
                <button
                  v-for="option in [
                    { label: 'Helped', value: 'helped' },
                    { label: 'Duplicated', value: 'duplicated' },
                    { label: 'Distracted', value: 'distracted' }
                  ] as const"
                  :key="option.value"
                  type="button"
                  role="radio"
                  :data-test-id="`human-learning-composition-${option.value}`"
                  :disabled="submitting"
                  :aria-checked="
                    compositionOutcomes[item.relation.relationId]?.outcome === option.value
                  "
                  :class="
                    optionClass(
                      compositionOutcomes[item.relation.relationId]?.outcome === option.value
                    )
                  "
                  class="h-8 rounded-md border px-2 text-[9px] transition-colors disabled:cursor-default disabled:opacity-60"
                  @click="setCompositionOutcome(item, option.value)"
                >
                  {{ option.label }}
                </button>
              </div>
              <p class="mt-2 truncate font-mono text-[7px] text-muted">
                {{ item.primarySurface.objectId }}@{{ item.primarySurface.revision }} ←
                {{ item.companionSurface.objectId }}@{{ item.companionSurface.revision }}
              </p>
            </article>
          </div>
        </section>

        <details
          data-test-id="human-learning-static-baseline"
          class="border-b border-border bg-background/20 px-6 py-4"
          @toggle="markBaselineReviewed"
        >
          <summary
            class="flex cursor-pointer list-none items-center justify-between gap-4 text-[10px] marker:hidden"
          >
            <span>
              <b class="font-medium text-surface">Open the same-intent static answer</b>
              <small class="mt-0.5 block text-[9px] text-muted">
                Same intent and evidence · no interactive model
              </small>
            </span>
            <span
              data-test-id="human-learning-baseline-status"
              :class="baselineReviewedAt ? 'text-emerald-300' : 'text-muted'"
            >
              {{ baselineReviewedAt ? 'Reviewed' : 'Required for comparison' }}
            </span>
          </summary>
          <article class="mt-4 rounded-lg border border-border bg-panel p-4">
            <p class="text-[8px] font-semibold tracking-[0.14em] text-muted uppercase">
              Static answer · {{ baseline.rendererId }} · {{ baseline.contentHash }}
            </p>
            <h3 class="mt-2 text-sm font-semibold text-surface">{{ baseline.title }}</h3>
            <p class="mt-2 text-[10px] leading-5 text-muted">{{ baseline.statement }}</p>
            <p class="mt-2 text-[10px] leading-5 text-surface">
              Desired outcome: {{ baseline.desiredOutcome }}
            </p>
            <ul v-if="baseline.evidence.length" class="mt-3 grid gap-2">
              <li
                v-for="item in baseline.evidence"
                :key="`${item.title}:${item.summary}`"
                class="rounded-md border border-border bg-background/35 px-3 py-2"
              >
                <div class="flex items-center justify-between gap-3 text-[8px] text-muted">
                  <span>{{ item.truthScope }} · {{ item.freshness }}</span>
                  <span>Evidence</span>
                </div>
                <b class="mt-1 block text-[9px] text-surface">{{ item.title }}</b>
                <p class="mt-1 text-[9px] leading-4 text-muted">{{ item.summary }}</p>
              </li>
            </ul>
            <p v-if="baseline.constraints.length" class="mt-3 text-[9px] leading-4 text-muted">
              Constraints: {{ baseline.constraints.join(' · ') }}
            </p>
          </article>
        </details>

        <form class="px-6 pt-6" @submit.prevent="submit">
          <fieldset>
            <legend class="text-sm font-medium">Did the intended job complete?</legend>
            <div class="mt-3 grid grid-cols-2 gap-2" role="radiogroup" aria-label="Job completed">
              <button
                type="button"
                role="radio"
                data-test-id="human-learning-job-completed-yes"
                :disabled="submitting"
                :aria-checked="jobCompleted === true"
                :class="optionClass(jobCompleted === true)"
                class="h-11 rounded-md border text-[11px] font-medium transition-colors disabled:cursor-default disabled:opacity-60"
                @click="jobCompleted = true"
              >
                Yes, it completed
              </button>
              <button
                type="button"
                role="radio"
                data-test-id="human-learning-job-completed-no"
                :disabled="submitting"
                :aria-checked="jobCompleted === false"
                :class="optionClass(jobCompleted === false)"
                class="h-11 rounded-md border text-[11px] font-medium transition-colors disabled:cursor-default disabled:opacity-60"
                @click="jobCompleted = false"
              >
                No, it did not
              </button>
            </div>
          </fieldset>

          <div class="mt-6 grid grid-cols-2 gap-x-6 gap-y-5 max-sm:grid-cols-1">
            <fieldset>
              <legend class="text-[10px] font-medium">Run outcome</legend>
              <div class="mt-2 grid grid-cols-3 gap-1" role="radiogroup" aria-label="Run outcome">
                <button
                  v-for="option in outcomeOptions"
                  :key="option.value"
                  type="button"
                  role="radio"
                  :data-test-id="`human-learning-outcome-${option.value}`"
                  :disabled="submitting"
                  :aria-checked="outcome === option.value"
                  :class="optionClass(outcome === option.value)"
                  class="h-8 rounded-md border px-2 text-[9px] transition-colors disabled:cursor-default disabled:opacity-60"
                  @click="outcome = option.value"
                >
                  {{ option.label }}
                </button>
              </div>
            </fieldset>

            <fieldset>
              <legend class="text-[10px] font-medium">Form disposition</legend>
              <div
                class="mt-2 grid grid-cols-3 gap-1"
                role="radiogroup"
                aria-label="Form disposition"
              >
                <button
                  v-for="option in dispositionOptions"
                  :key="option.value"
                  type="button"
                  role="radio"
                  :data-test-id="`human-learning-form-${option.value}`"
                  :disabled="submitting"
                  :aria-checked="formDisposition === option.value"
                  :class="optionClass(formDisposition === option.value)"
                  class="h-8 rounded-md border px-2 text-[9px] transition-colors disabled:cursor-default disabled:opacity-60"
                  @click="formDisposition = option.value"
                >
                  {{ option.label }}
                </button>
              </div>
            </fieldset>

            <fieldset>
              <legend class="text-[10px] font-medium">Compared with the static answer</legend>
              <div
                class="mt-2 grid grid-cols-4 gap-1"
                role="radiogroup"
                aria-label="Comparison with the same-intent static answer"
              >
                <button
                  v-for="option in comparisonOptions"
                  :key="option.value"
                  type="button"
                  role="radio"
                  :data-test-id="`human-learning-comparison-${option.value}`"
                  :disabled="submitting || (option.value !== 'not-run' && !baselineReviewedAt)"
                  :aria-checked="comparison === option.value"
                  :class="optionClass(comparison === option.value)"
                  class="h-8 rounded-md border px-1 text-[9px] transition-colors disabled:cursor-default disabled:opacity-60"
                  @click="comparison = option.value"
                >
                  {{ option.label }}
                </button>
              </div>
            </fieldset>

            <label class="grid gap-2 text-[10px] font-medium" for="human-learning-repair-count">
              Repair attempts
              <input
                id="human-learning-repair-count"
                v-model.number="repairCount"
                data-test-id="human-learning-repair-count"
                type="number"
                inputmode="numeric"
                min="0"
                max="99"
                step="1"
                :disabled="submitting"
                class="h-8 rounded-md border border-border bg-background px-3 text-[10px] outline-none focus:border-accent disabled:cursor-default disabled:opacity-60"
              />
            </label>
          </div>

          <details class="mt-6 border-t border-border pt-4">
            <summary
              data-test-id="human-learning-quality-disclosure"
              class="flex cursor-pointer list-none items-center justify-between gap-4 text-[10px] font-medium marker:hidden"
            >
              <span class="flex items-center gap-2">
                Quality signals
                <span class="text-[9px] font-normal text-muted"
                  >visual, access, evidence, safety</span
                >
              </span>
              <span :class="qualityComplete ? 'text-[var(--color-success)]' : 'text-muted'">
                {{ qualityComplete ? 'Complete' : '4 quick checks' }}
              </span>
            </summary>

            <div class="mt-3 divide-y divide-border border-y border-border">
              <div
                v-for="question in qualityQuestions"
                :key="question.key"
                class="grid min-h-11 grid-cols-[minmax(0,1fr)_124px] items-center gap-4 py-2"
              >
                <span
                  :id="`human-learning-${question.testHook}-label`"
                  class="text-[10px] text-muted"
                >
                  {{ question.label }}
                </span>
                <div
                  class="grid grid-cols-2 gap-1"
                  role="radiogroup"
                  :aria-labelledby="`human-learning-${question.testHook}-label`"
                >
                  <button
                    type="button"
                    role="radio"
                    :data-test-id="`human-learning-${question.testHook}-yes`"
                    :disabled="submitting"
                    :aria-checked="quality[question.key] === true"
                    :class="
                      qualityChoiceClass(quality[question.key] === true, question.warning === true)
                    "
                    class="h-7 rounded-md border text-[9px] transition-colors disabled:cursor-default disabled:opacity-60"
                    @click="setQuality(question.key, true)"
                  >
                    Yes
                  </button>
                  <button
                    type="button"
                    role="radio"
                    :data-test-id="`human-learning-${question.testHook}-no`"
                    :disabled="submitting"
                    :aria-checked="quality[question.key] === false"
                    :class="qualityChoiceClass(quality[question.key] === false, false)"
                    class="h-7 rounded-md border text-[9px] transition-colors disabled:cursor-default disabled:opacity-60"
                    @click="setQuality(question.key, false)"
                  >
                    No
                  </button>
                </div>
              </div>
            </div>
          </details>

          <label class="mt-5 grid gap-1.5 text-[10px] font-medium" for="human-learning-feedback">
            One thing the system should learn
            <textarea
              id="human-learning-feedback"
              v-model="feedback"
              data-test-id="human-learning-feedback"
              maxlength="280"
              rows="3"
              :disabled="submitting"
              class="resize-none rounded-md border border-border bg-background px-3 py-2 text-[11px] leading-5 outline-none placeholder:text-muted focus:border-accent disabled:cursor-default disabled:opacity-60"
              placeholder="What should be repeated, repaired, or avoided next time?"
            />
            <span class="text-right text-[9px] font-normal text-muted">
              {{ feedback.length }}/280
            </span>
          </label>

          <footer
            class="sticky bottom-0 z-10 -mx-6 mt-5 flex items-center gap-4 border-t border-border bg-panel/95 px-6 py-4 backdrop-blur"
          >
            <p
              data-test-id="human-learning-source-boundary"
              class="flex min-w-0 flex-1 items-center gap-2 text-[9px] leading-4 text-muted"
            >
              <icon-lucide-shield-check class="size-3.5 shrink-0 text-accent" />
              Records learning only; changes no source.
            </p>
            <button
              type="button"
              data-test-id="human-learning-review-cancel"
              :disabled="submitting"
              class="h-9 rounded-md px-4 text-[10px] text-muted hover:bg-hover hover:text-surface disabled:cursor-default disabled:opacity-35"
              @click="close"
            >
              Cancel
            </button>
            <button
              type="submit"
              data-test-id="human-learning-review-submit"
              :disabled="!canSubmit || submitting"
              class="h-9 rounded-md bg-accent px-4 text-[10px] font-semibold text-white hover:bg-accent/90 disabled:cursor-default disabled:opacity-35"
            >
              {{ submitting ? 'Recording…' : 'Record review' }}
            </button>
          </footer>
        </form>
      </section>
    </div>
  </Teleport>
</template>
