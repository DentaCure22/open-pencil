import { onScopeDispose, watch, type Ref } from 'vue'

import type { AgentPromptAnnotation } from '@/app/agent-chat/models'
import {
  readCacheJson,
  readCacheValue,
  removeCacheEntry,
  writeCacheJson,
  writeCacheValue
} from '@/app/cache'

export const NEW_AGENT_CHAT_COMPOSER_DRAFT_ID = 'new-task'

const CACHE_PREFIX = 'agent-chat/composer-drafts/v1'

type AgentComposerDraftContent = {
  annotations: AgentPromptAnnotation[]
  text: string
  version: 1
}

type AgentComposerAttachmentManifest = {
  count: number
  signature: string
  version: 1
}

type AgentComposerAttachmentEnvelope = AgentComposerAttachmentManifest & {
  files: File[]
}

export type AgentComposerDraft = {
  annotations: AgentPromptAnnotation[]
  attachments: File[]
  text: string
}

type AgentComposerDraftBinding = {
  annotations: Ref<AgentPromptAnnotation[]>
  attachments: Ref<File[]>
  identity: Readonly<Ref<string>>
  text: Ref<string>
}

const pendingAttachmentWrites = new Map<string, Promise<void>>()

function contentKey(identity: string): string {
  return `${CACHE_PREFIX}/${encodeURIComponent(identity)}/content`
}

function attachmentManifestKey(identity: string): string {
  return `${CACHE_PREFIX}/${encodeURIComponent(identity)}/attachments`
}

function attachmentFilesKey(identity: string): string {
  return `${CACHE_PREFIX}/${encodeURIComponent(identity)}/attachment-files`
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function annotation(value: unknown): AgentPromptAnnotation | null {
  if (!isRecord(value)) return null
  if (
    typeof value.comment !== 'string' ||
    typeof value.endOffset !== 'number' ||
    typeof value.id !== 'string' ||
    typeof value.quote !== 'string' ||
    typeof value.sourceMessageId !== 'string' ||
    typeof value.startOffset !== 'number'
  ) {
    return null
  }
  return {
    comment: value.comment,
    endOffset: value.endOffset,
    id: value.id,
    quote: value.quote,
    sourceMessageId: value.sourceMessageId,
    startOffset: value.startOffset
  }
}

function draftContent(value: unknown): AgentComposerDraftContent | null {
  if (!isRecord(value) || value.version !== 1 || typeof value.text !== 'string') return null
  if (!Array.isArray(value.annotations)) return null
  const annotations = value.annotations.map(annotation).filter((item) => item !== null)
  if (annotations.length !== value.annotations.length) return null
  return { annotations, text: value.text, version: 1 }
}

function attachmentManifest(value: unknown): AgentComposerAttachmentManifest | null {
  if (
    !isRecord(value) ||
    value.version !== 1 ||
    typeof value.count !== 'number' ||
    !Number.isInteger(value.count) ||
    value.count < 0 ||
    typeof value.signature !== 'string'
  ) {
    return null
  }
  return { count: value.count, signature: value.signature, version: 1 }
}

function attachmentEnvelope(value: unknown): AgentComposerAttachmentEnvelope | null {
  const manifest = attachmentManifest(value)
  if (!manifest || !isRecord(value) || !Array.isArray(value.files)) return null
  const files = value.files.filter((file): file is File => file instanceof File)
  if (files.length !== value.files.length) return null
  return { ...manifest, files }
}

function attachmentSignature(files: File[]): string {
  return files
    .map((file) =>
      [file.name, String(file.size), String(file.lastModified), file.type].join('\u0000')
    )
    .join('\u0001')
}

function queueAttachmentWrite(identity: string, operation: () => Promise<void>): Promise<void> {
  const key = attachmentFilesKey(identity)
  const previous = pendingAttachmentWrites.get(key) ?? Promise.resolve()
  const next = previous.catch(() => undefined).then(operation)
  pendingAttachmentWrites.set(key, next)
  void next.then(
    () => {
      if (pendingAttachmentWrites.get(key) === next) pendingAttachmentWrites.delete(key)
      return undefined
    },
    () => {
      if (pendingAttachmentWrites.get(key) === next) pendingAttachmentWrites.delete(key)
      return undefined
    }
  )
  return next
}

export async function readAgentComposerDraft(identity: string): Promise<AgentComposerDraft> {
  if (!identity) return { annotations: [], attachments: [], text: '' }
  const [storedContent, storedManifest] = await Promise.all([
    readCacheJson<unknown>(contentKey(identity)),
    readCacheJson<unknown>(attachmentManifestKey(identity))
  ])
  const content = draftContent(storedContent)
  const manifest = attachmentManifest(storedManifest)
  let attachments: File[] = []
  if (manifest?.count) {
    const envelope = attachmentEnvelope(await readCacheValue<unknown>(attachmentFilesKey(identity)))
    if (
      envelope &&
      envelope.count === manifest.count &&
      envelope.signature === manifest.signature &&
      attachmentSignature(envelope.files) === manifest.signature
    ) {
      attachments = envelope.files
    }
  }
  return {
    annotations: content?.annotations ?? [],
    attachments,
    text: content?.text ?? ''
  }
}

export function saveAgentComposerDraftContent(
  identity: string,
  content: Pick<AgentComposerDraft, 'annotations' | 'text'>
): Promise<void> {
  if (!identity) return Promise.resolve()
  if (!content.text && !content.annotations.length) return removeCacheEntry(contentKey(identity))
  return writeCacheJson(contentKey(identity), {
    annotations: content.annotations.map((item) => ({ ...item })),
    text: content.text,
    version: 1
  } satisfies AgentComposerDraftContent)
}

export function saveAgentComposerDraftAttachments(
  identity: string,
  attachments: File[]
): Promise<void> {
  if (!identity) return Promise.resolve()
  if (!attachments.length) {
    const manifestRemoval = removeCacheEntry(attachmentManifestKey(identity))
    const filesRemoval = queueAttachmentWrite(identity, () =>
      removeCacheEntry(attachmentFilesKey(identity))
    )
    return Promise.all([manifestRemoval, filesRemoval]).then(() => undefined)
  }
  const files = [...attachments]
  const manifest: AgentComposerAttachmentManifest = {
    count: files.length,
    signature: attachmentSignature(files),
    version: 1
  }
  const manifestWrite = writeCacheJson(attachmentManifestKey(identity), manifest)
  const filesWrite = queueAttachmentWrite(identity, () =>
    writeCacheValue(attachmentFilesKey(identity), { ...manifest, files })
  )
  return Promise.all([manifestWrite, filesWrite]).then(() => undefined)
}

export function clearAgentComposerDraft(identity: string): Promise<void> {
  if (!identity) return Promise.resolve()
  const metadataRemoval = Promise.all([
    removeCacheEntry(contentKey(identity)),
    removeCacheEntry(attachmentManifestKey(identity))
  ])
  const filesRemoval = queueAttachmentWrite(identity, () =>
    removeCacheEntry(attachmentFilesKey(identity))
  )
  return Promise.all([metadataRemoval, filesRemoval]).then(() => undefined)
}

function reportDraftPersistenceFailure(action: string, identity: string, cause: unknown) {
  console.warn(`Agent composer draft ${action} failed for "${identity}":`, cause)
}

export function useAgentComposerDraft(binding: AgentComposerDraftBinding): {
  clear: () => void
} {
  let applying = false
  let hydrationEpoch = 0
  let hydrating = false

  function applyDraft(draft: AgentComposerDraft) {
    applying = true
    binding.text.value = draft.text
    binding.annotations.value = draft.annotations.map((item) => ({ ...item }))
    binding.attachments.value = [...draft.attachments]
    applying = false
  }

  function persistContent() {
    const identity = binding.identity.value
    if (!identity) return
    void saveAgentComposerDraftContent(identity, {
      annotations: binding.annotations.value,
      text: binding.text.value
    }).catch((cause) => reportDraftPersistenceFailure('content save', identity, cause))
  }

  function persistAttachments() {
    const identity = binding.identity.value
    if (!identity) return
    void saveAgentComposerDraftAttachments(identity, binding.attachments.value).catch((cause) =>
      reportDraftPersistenceFailure('attachment save', identity, cause)
    )
  }

  async function hydrate(identity: string) {
    const epoch = ++hydrationEpoch
    hydrating = true
    applyDraft({ annotations: [], attachments: [], text: '' })
    if (!identity) {
      hydrating = false
      return
    }
    const draft = await readAgentComposerDraft(identity).catch((cause) => {
      reportDraftPersistenceFailure('restore', identity, cause)
      return { annotations: [], attachments: [], text: '' }
    })
    if (epoch !== hydrationEpoch || identity !== binding.identity.value) return
    applyDraft(draft)
    hydrating = false
  }

  const stopIdentityWatch = watch(binding.identity, hydrate, { flush: 'sync', immediate: true })
  const stopContentWatch = watch(
    [binding.text, binding.annotations],
    () => {
      if (applying) return
      if (hydrating) {
        hydrationEpoch += 1
        hydrating = false
      }
      persistContent()
    },
    { deep: true, flush: 'sync' }
  )
  const stopAttachmentWatch = watch(
    binding.attachments,
    () => {
      if (applying) return
      if (hydrating) {
        hydrationEpoch += 1
        hydrating = false
      }
      persistAttachments()
    },
    { deep: true, flush: 'sync' }
  )

  onScopeDispose(() => {
    stopIdentityWatch()
    stopContentWatch()
    stopAttachmentWatch()
  })

  return {
    clear() {
      const identity = binding.identity.value
      applyDraft({ annotations: [], attachments: [], text: '' })
      if (!identity) return
      void clearAgentComposerDraft(identity).catch((cause) =>
        reportDraftPersistenceFailure('clear', identity, cause)
      )
    }
  }
}
