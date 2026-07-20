export type FieldSessionLaunchSurface = {
  artifactId: string
  artifactRevision: number
  constraints: string[]
  desiredOutcome: string
  evidenceCount: number
  evidenceManifestId: string
  evidenceManifestRevision: number
  evidenceStatus: 'partial' | 'ready'
  familyMemberCount: number
  formLabel: string
  formRationale: string
  intentId: string
  intentRevision: number
  name: string
  surfaceRunId: string
  surfaceRevision: number
  taskBrief: string
}

export type FieldSessionLaunchSubmission = {
  participantAlias: string
  phiFreeConfirmed: true
  runCode: string
}

export type FieldSessionPreparationSubmission = {
  runCode: string
}
