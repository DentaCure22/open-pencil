export type AppRpcTarget = {
  boardRevision: number
  contentDocumentId?: string
  documentId: string
  documentName: string
  pageId: string
  pageName: string
  path?: string
  runtimeInstanceId?: string
  workspaceId?: string
}

export type AppRpcEnvelope<T> = {
  result: T
  target?: AppRpcTarget
}
