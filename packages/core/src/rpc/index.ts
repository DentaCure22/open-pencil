export { executeRpcCommand, ALL_RPC_COMMANDS } from './commands'
export {
  classifyRpcExecutionSurface,
  normalizePersistedExecutionError,
  persistedAuthorityUnavailableError,
  persistedCommandUnsupportedError,
  PERSISTED_AUTHORITY_UNAVAILABLE,
  PERSISTED_COMMAND_UNSUPPORTED
} from './execution-surface'
export type { RpcExecutionSurface } from './execution-surface'
export { WORKSPACE_SEARCH_CONTRACT } from './workspace-search'
export type {
  WorkspaceSearchBoard,
  WorkspaceSearchHit,
  WorkspaceSearchResult
} from './workspace-search'
export {
  buildTraceEmptyResult,
  buildTraceQueryMatch,
  hasTraceSpokenTurnSelector,
  matchingTraceWindowEvents,
  publicTraceSpokenTurn,
  queryTraceRecords,
  queryTraceSpokenTurnWindow,
  resolveTraceSpokenTurn,
  SPOKEN_TURN_FRESHNESS_MS,
  traceEventSearchValues,
  TURN_CONTEXT_BRACKET_MS,
  turnContextTargets
} from './trace-query'
export { resolveTraceRequest } from './trace-resolve'
export type { TraceResolveInput, TraceResolveResult } from './trace-resolve'
export { searchTrace } from './trace-search'
export type {
  TraceSearchInput,
  TraceSearchResult,
  TraceSearchSessionHit,
  TraceSearchTurnHit
} from './trace-search'
export type {
  TraceEvidenceStatus,
  TraceHistoryContextEntry,
  TraceHistoryEvent,
  TraceHistorySession,
  TraceQueryDependencies,
  TraceQueryEvent,
  TraceQueryInput,
  TraceQueryMatch,
  TraceQueryPublicSpokenTurn,
  TraceQueryRecordSummary,
  TraceQueryResult,
  TraceQueryScope,
  TraceQuerySpokenTurn,
  TraceQueryTarget,
  TraceSpokenTurnResolution,
  TraceSpokenTurnSelector,
  TraceWindowEntry
} from './trace-query'
export type {
  InfoResult,
  PageItem,
  TreeArgs,
  TreeResult,
  TreeNodeResult,
  FindArgs,
  FindNodeResult,
  QueryArgs,
  QueryNodeResult,
  NodeArgs,
  NodeResult,
  VariablesArgs,
  VariablesResult,
  AnalyzeColorsArgs,
  AnalyzeColorsResult,
  AnalyzeTypographyArgs,
  AnalyzeTypographyResult,
  AnalyzeSpacingResult,
  SpacingValue,
  AnalyzeClustersArgs,
  AnalyzeClustersResult,
  AnalyzeOverlapsArgs,
  AnalyzeOverlapsResult,
  TypographyStyle,
  AutomationDocumentSummary
} from './commands'
