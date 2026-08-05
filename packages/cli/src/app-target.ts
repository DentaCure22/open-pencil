export type AppTargetCliArgs = {
  'content-document-id'?: string
  'document-id'?: string
  'document-name'?: string
  'page-id'?: string
  'page-name'?: string
  'runtime-instance-id'?: string
  'workspace-id'?: string
}

export const appTargetOptions = {
  'content-document-id': {
    type: 'string',
    description: 'Stable persisted content document ID returned by Board context',
    required: false
  },
  'document-id': {
    type: 'string',
    description: 'Target OpenPencil runtime document/tab ID when connected to the running app',
    required: false
  },
  'document-name': {
    type: 'string',
    description: 'Resolve one open document by its exact durable display name',
    required: false
  },
  'page-id': {
    type: 'string',
    description: 'Target page ID when connected to the running app',
    required: false
  },
  'page-name': {
    type: 'string',
    description: 'Resolve one page by its exact name within the target document',
    required: false
  },
  'runtime-instance-id': {
    type: 'string',
    description: 'Pin the exact runtime returned by board list or board context',
    required: false
  },
  'workspace-id': {
    type: 'string',
    description: 'Target the one persistent OpenPencil workspace by its stable ID',
    required: false
  }
} as const

export function appTargetRpcArgs(args: AppTargetCliArgs): {
  content_document_id?: string
  document_id?: string
  document_name?: string
  page_id?: string
  page_name?: string
  runtime_instance_id?: string
  workspace_id?: string
} {
  return {
    ...(args['content-document-id'] ? { content_document_id: args['content-document-id'] } : {}),
    ...(args['document-id'] ? { document_id: args['document-id'] } : {}),
    ...(args['document-name'] ? { document_name: args['document-name'] } : {}),
    ...(args['page-id'] ? { page_id: args['page-id'] } : {}),
    ...(args['page-name'] ? { page_name: args['page-name'] } : {}),
    ...(args['runtime-instance-id'] ? { runtime_instance_id: args['runtime-instance-id'] } : {}),
    ...(args['workspace-id'] ? { workspace_id: args['workspace-id'] } : {})
  }
}
