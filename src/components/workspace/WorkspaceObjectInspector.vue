<script setup lang="ts">
import { computed } from 'vue'

import type { WorkspaceObject, WorkspaceViewKind } from '@/app/workspace'
import AppInput from '@/components/ui/AppInput.vue'
import AppTextButton from '@/components/ui/AppTextButton.vue'
import PanelSection from '@/components/ui/PanelSection.vue'

import WorkspaceStatusBadge from './WorkspaceStatusBadge.vue'

const { object, viewKind } = defineProps<{
  object: WorkspaceObject
  viewKind: WorkspaceViewKind
}>()

const emit = defineEmits<{
  archive: []
  connect: []
  createRecord: []
  sendReview: []
  updateLabel: [value: string]
}>()

function durableRecordTitle(candidate: WorkspaceObject): string | null {
  if (candidate.type === 'surface-run') return candidate.name
  if (candidate.type === 'decision-receipt') return `Decision · ${candidate.outcome.status}`
  if (candidate.type === 'learning-receipt') return `Learning · ${candidate.outcome}`
  if (candidate.type === 'action-proposal') return candidate.name
  if (candidate.type === 'action-execution-receipt') return `Execution · ${candidate.status}`
  if (candidate.type === 'action-verification-receipt') {
    return `Verification · ${candidate.outcome}`
  }
  if (candidate.type === 'action-rollback-receipt') return `Rollback · ${candidate.status}`
  return null
}

const title = computed(() => {
  const durableTitle = durableRecordTitle(object)
  if (durableTitle) return durableTitle
  if (object.type === 'document-block') return object.text || 'Untitled block'
  if (object.type === 'collection' || object.type === 'saved-view') return object.name
  if (object.type === 'collection-record') return object.title
  if (object.type === 'graph-node' || object.type === 'design-artifact') return object.label
  if (object.type === 'graph-edge') return object.label || object.relationshipType
  if (object.type === 'review-object') return object.body || object.reviewKind
  if (object.type === 'canvas-object') return object.label || object.canvasKind
  if (object.type === 'intent-record') return object.statement || 'Intent'
  if (object.type === 'evidence-manifest') return `Evidence snapshot · ${object.items.length}`
  return 'Workspace object'
})

const canEditLabel = computed(() => object.permissions.canEdit)

const editableLabel = computed({
  get: () => title.value,
  set: (value: string) => emit('updateLabel', value)
})
</script>

<template>
  <div
    data-test-id="workspace-object-inspector"
    class="scrollbar-thin min-h-0 flex-1 overflow-x-hidden overflow-y-auto pb-4"
  >
    <header class="flex items-start gap-2 border-b border-border px-3 py-2.5">
      <span
        class="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-md bg-hover text-muted"
      >
        <icon-lucide-file-text v-if="object.type === 'document-block'" class="size-3.5" />
        <icon-lucide-table-2
          v-else-if="object.type === 'collection' || object.type === 'collection-record'"
          class="size-3.5"
        />
        <icon-lucide-waypoints
          v-else-if="object.type === 'graph-node' || object.type === 'graph-edge'"
          class="size-3.5"
        />
        <icon-lucide-message-square-check
          v-else-if="object.type === 'review-object' || object.type === 'decision-receipt'"
          class="size-3.5"
        />
        <icon-lucide-list-checks v-else-if="object.type === 'surface-run'" class="size-3.5" />
        <icon-lucide-brain-circuit
          v-else-if="object.type === 'learning-receipt'"
          class="size-3.5"
        />
        <icon-lucide-search-check
          v-else-if="object.type === 'evidence-manifest'"
          class="size-3.5"
        />
        <icon-lucide-component v-else class="size-3.5" />
      </span>
      <span class="min-w-0 flex-1">
        <strong class="block truncate text-[11px] font-semibold text-surface">{{ title }}</strong>
        <span class="block truncate text-[9px] text-muted">{{ object.type }} · {{ viewKind }}</span>
      </span>
      <WorkspaceStatusBadge v-if="object.type === 'review-object'" :status="object.reviewStatus" />
      <WorkspaceStatusBadge v-else-if="object.type === 'surface-run'" :status="object.status" />
      <WorkspaceStatusBadge
        v-else-if="object.type === 'decision-receipt'"
        :status="object.outcome.status"
      />
      <WorkspaceStatusBadge
        v-else-if="object.type === 'learning-receipt'"
        :status="object.outcome"
      />
      <WorkspaceStatusBadge v-else-if="object.type === 'action-proposal'" :status="object.status" />
      <WorkspaceStatusBadge
        v-else-if="object.type === 'action-execution-receipt'"
        :status="object.status"
      />
      <WorkspaceStatusBadge
        v-else-if="object.type === 'action-verification-receipt'"
        :status="object.outcome"
      />
      <WorkspaceStatusBadge
        v-else-if="object.type === 'action-rollback-receipt'"
        :status="object.status"
      />
    </header>

    <PanelSection label="Content">
      <AppInput
        v-if="canEditLabel"
        v-model="editableLabel"
        size="sm"
        data-test-id="workspace-object-label"
      />
      <p v-else class="text-[10px] leading-4 text-surface">{{ title }}</p>
      <div class="mt-2 flex items-center justify-between text-[9px] text-muted">
        <span>Stable ID</span>
        <code class="max-w-40 truncate">{{ object.id }}</code>
      </div>
    </PanelSection>

    <PanelSection v-if="object.type === 'collection'" label="Collection">
      <div class="space-y-1 text-[10px] text-muted">
        <div class="flex justify-between">
          <span>Properties</span><span>{{ object.properties.length }}</span>
        </div>
        <div class="flex justify-between">
          <span>Records</span><span>{{ object.recordIds.length }}</span>
        </div>
      </div>
      <button
        data-test-id="workspace-collection-new-record"
        type="button"
        class="mt-2 h-7 w-full rounded-md bg-hover text-[10px] text-surface hover:bg-accent hover:text-white"
        @click="emit('createRecord')"
      >
        + New record
      </button>
    </PanelSection>

    <PanelSection
      v-if="object.type === 'graph-node' || object.type === 'graph-edge'"
      label="Relationships"
    >
      <AppTextButton data-test-id="workspace-connect-relation" @click="emit('connect')">
        Connect to…
      </AppTextButton>
    </PanelSection>

    <PanelSection v-if="object.type === 'surface-run'" label="Decision surface">
      <dl class="grid grid-cols-[72px_1fr] gap-x-2 gap-y-1 text-[9px]">
        <dt class="text-muted">Status</dt>
        <dd class="text-surface">{{ object.status }}</dd>
        <dt class="text-muted">Priorities</dt>
        <dd class="text-surface">{{ object.recommendations.length }}</dd>
        <dt class="text-muted">Artifact</dt>
        <dd class="truncate text-surface">r{{ object.artifact.boardRevision }}</dd>
        <dt v-if="object.formChoice.proposalOrigin" class="text-muted">Proposed by</dt>
        <dd
          v-if="object.formChoice.proposalOrigin"
          data-test-id="workspace-surface-proposal-origin"
          class="text-surface capitalize"
        >
          {{ object.formChoice.proposalOrigin }}
        </dd>
        <dt v-if="object.formChoice.proposalDigest" class="text-muted">Proposal</dt>
        <dd
          v-if="object.formChoice.proposalDigest"
          data-test-id="workspace-surface-proposal-digest"
          class="truncate font-mono text-[8px] text-surface"
        >
          {{ object.formChoice.proposalDigest }}
        </dd>
        <dt class="text-muted">Source writes</dt>
        <dd class="text-surface">Disabled</dd>
      </dl>
    </PanelSection>

    <PanelSection v-if="object.type === 'decision-receipt'" label="Decision receipt">
      <dl class="grid grid-cols-[72px_1fr] gap-x-2 gap-y-1 text-[9px]">
        <dt class="text-muted">Outcome</dt>
        <dd class="text-surface">{{ object.outcome.status }}</dd>
        <dt class="text-muted">Decided</dt>
        <dd class="truncate text-surface">{{ object.outcome.decidedAt }}</dd>
        <dt class="text-muted">Artifact</dt>
        <dd class="text-surface">r{{ object.artifact.boardRevision }}</dd>
      </dl>
    </PanelSection>

    <PanelSection v-if="object.type === 'learning-receipt'" label="Learning receipt">
      <dl class="grid grid-cols-[88px_1fr] gap-x-2 gap-y-1 text-[9px]">
        <dt class="text-muted">Outcome</dt>
        <dd class="text-surface">{{ object.outcome }}</dd>
        <dt class="text-muted">Human run</dt>
        <dd class="text-surface">{{ object.executionKind === 'human' ? 'Yes' : 'No' }}</dd>
        <dt class="text-muted">Attestation</dt>
        <dd data-test-id="workspace-learning-attestation" class="text-surface">
          {{ object.attestation.kind }}
        </dd>
        <dt class="text-muted">Attested by</dt>
        <dd class="truncate text-surface">{{ object.attestation.attestedBy }}</dd>
        <dt v-if="object.attestation.sessionId" class="text-muted">Session</dt>
        <dd v-if="object.attestation.sessionId" class="truncate text-surface">
          {{ object.attestation.sessionId }}
        </dd>
        <dt v-if="object.attestation.interactionCount" class="text-muted">Interactions</dt>
        <dd v-if="object.attestation.interactionCount" class="text-surface">
          {{ object.attestation.interactionCount }} observed
        </dd>
        <dt v-if="object.attestation.proofDigest" class="text-muted">Session proof</dt>
        <dd
          v-if="object.attestation.proofDigest"
          class="truncate font-mono text-[8px] text-surface"
        >
          {{ object.attestation.proofDigest }}
        </dd>
        <dt v-if="object.attestation.proof" class="text-muted">Proof material</dt>
        <dd
          v-if="object.attestation.proof"
          data-test-id="workspace-learning-durable-proof"
          class="text-surface"
        >
          {{ object.attestation.proof.algorithm }} · retained
        </dd>
        <dt v-if="object.attestation.proof" class="text-muted">Outcome proof</dt>
        <dd
          v-if="object.attestation.proof"
          data-test-id="workspace-learning-outcome-proof"
          class="truncate font-mono text-[8px] text-surface"
        >
          {{ object.attestation.proof.claim.reviewDigest }}
        </dd>
        <dt class="text-muted">Intent complete</dt>
        <dd class="text-surface">{{ object.intentCompleted ? 'Yes' : 'No' }}</dd>
        <dt class="text-muted">Form choice</dt>
        <dd class="text-surface">{{ object.formId }} · {{ object.formDisposition }}</dd>
        <dt class="text-muted">Compared</dt>
        <dd class="text-surface">
          {{ object.comparisonOutcome }}
          <span v-if="object.comparisonBaseline">
            · {{ object.comparisonBaseline.kind }} · {{ object.comparisonBaseline.contentHash }}
          </span>
        </dd>
        <template v-if="object.compositionEvaluations?.length">
          <dt class="text-muted">Companion value</dt>
          <dd data-test-id="workspace-learning-composition" class="text-surface">
            {{ object.compositionEvaluations.map((evaluation) => evaluation.outcome).join(' · ') }}
          </dd>
          <dt class="text-muted">Exact pair</dt>
          <dd class="truncate font-mono text-[8px] text-surface">
            {{ object.compositionEvaluations[0]?.relation.relationId }}@{{
              object.compositionEvaluations[0]?.relation.revision
            }}
          </dd>
        </template>
        <dt class="text-muted">Repairs</dt>
        <dd class="text-surface">{{ object.repairCount }}</dd>
        <dt class="text-muted">Visual</dt>
        <dd class="text-surface">{{ object.visualAccepted ? 'Accepted' : 'Not accepted' }}</dd>
        <dt class="text-muted">Keyboard</dt>
        <dd class="text-surface">{{ object.keyboardAccepted ? 'Accepted' : 'Not accepted' }}</dd>
        <dt class="text-muted">Evidence</dt>
        <dd class="text-surface">{{ object.evidenceTraceable ? 'Traceable' : 'Not traceable' }}</dd>
        <dt class="text-muted">Safety</dt>
        <dd class="text-surface">{{ object.safetyViolation ? 'Issue reported' : 'No issue' }}</dd>
      </dl>
      <div
        v-if="object.qualitativeFeedback"
        data-test-id="workspace-learning-feedback"
        class="mt-3 rounded-md border border-border bg-background/45 p-2.5"
      >
        <p class="text-[9px] text-muted">What the system should learn</p>
        <p class="mt-1 text-[10px] leading-4 text-surface">
          {{ object.qualitativeFeedback.summary }}
        </p>
      </div>
      <p class="mt-3 flex items-center gap-1.5 text-[9px] text-muted">
        <icon-lucide-lock-keyhole class="size-3" /> Immutable, explicit provenance
      </p>
    </PanelSection>

    <PanelSection v-if="object.type === 'action-proposal'" label="Action boundary">
      <dl class="grid grid-cols-[88px_1fr] gap-x-2 gap-y-1 text-[9px]">
        <dt class="text-muted">Status</dt>
        <dd class="text-surface">{{ object.status }}</dd>
        <dt class="text-muted">Authorization</dt>
        <dd class="text-surface">{{ object.authorization.status }}</dd>
        <dt class="text-muted">Steps</dt>
        <dd class="text-surface">{{ object.steps.length }}</dd>
        <dt class="text-muted">Source writes</dt>
        <dd class="text-surface">
          {{ object.requestedCapabilities.sourceWrites ? 'Scoped' : 'No' }}
        </dd>
        <dt class="text-muted">Rollback</dt>
        <dd class="text-surface">{{ object.rollbackReceipt ? 'Recorded' : 'Not recorded' }}</dd>
      </dl>
    </PanelSection>

    <PanelSection v-if="object.type === 'action-rollback-receipt'" label="Rollback receipt">
      <dl class="grid grid-cols-[88px_1fr] gap-x-2 gap-y-1 text-[9px]">
        <dt class="text-muted">Outcome</dt>
        <dd data-test-id="workspace-action-rollback-status" class="text-surface">
          {{ object.status }}
        </dd>
        <dt class="text-muted">Authorized by</dt>
        <dd class="truncate text-surface">{{ object.authorization.actorId }}</dd>
        <dt class="text-muted">Restored</dt>
        <dd class="text-surface">
          {{ object.results.filter((item) => item.status === 'restored').length }} /
          {{ object.results.length }}
        </dd>
        <dt class="text-muted">Reason</dt>
        <dd class="text-surface">{{ object.reason }}</dd>
      </dl>
      <p class="mt-3 flex items-center gap-1.5 text-[9px] text-muted">
        <icon-lucide-lock-keyhole class="size-3" /> Immutable reversal evidence
      </p>
    </PanelSection>

    <PanelSection label="Review">
      <button
        data-test-id="workspace-send-review"
        type="button"
        class="h-7 w-full rounded-md bg-hover text-[10px] text-surface hover:bg-accent hover:text-white"
        @click="emit('sendReview')"
      >
        Send to Review
      </button>
    </PanelSection>

    <div v-if="object.permissions.canEdit" class="px-3 pt-3">
      <AppTextButton size="xs" @click="emit('archive')">Archive object</AppTextButton>
    </div>
  </div>
</template>
