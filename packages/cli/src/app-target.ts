export type AppTargetCliArgs = {
  'document-id'?: string
  'document-name'?: string
  'page-id'?: string
  'page-name'?: string
  'workspace-id'?: string
}

export const appTargetOptions = {
  'document-id': {
    type: 'string',
    description: 'Target OpenPencil document/tab ID when connected to the running app',
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
  'workspace-id': {
    type: 'string',
    description: 'Target the one persistent OpenPencil workspace by its stable ID',
    required: false
  }
} as const

export function appTargetRpcArgs(args: AppTargetCliArgs): {
  document_id?: string
  document_name?: string
  page_id?: string
  page_name?: string
  workspace_id?: string
} {
  return {
    ...(args['document-id'] ? { document_id: args['document-id'] } : {}),
    ...(args['document-name'] ? { document_name: args['document-name'] } : {}),
    ...(args['page-id'] ? { page_id: args['page-id'] } : {}),
    ...(args['page-name'] ? { page_name: args['page-name'] } : {}),
    ...(args['workspace-id'] ? { workspace_id: args['workspace-id'] } : {})
  }
}
