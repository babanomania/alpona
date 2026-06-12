// Types
export type {
  DashboardSpec,
  WidgetSpec,
  WidgetBinding,
  WidgetCopy,
  ResultShape,
  ResultShapeKey,
  ParamValue,
  ParamDescriptor,
  LayoutTemplate,
  LayoutRef,
  SlotContract,
  SlotRegion,
  SlotRole,
  SlotPacking,
  SlotOverflow,
  WidgetPlacement,
  Composition,
  CompositionDiagnostic,
  SpecIssue,
  ValidationResult,
  Row,
  QueryResult,
} from './types.js';

// Protocol
export type {
  GenerationEvent,
  PlanEvent,
  WidgetEvent,
  PatchEvent,
  CopyEvent,
  StatusEvent,
  DoneEvent,
  ErrorEvent,
  GenerateRequest,
  QueryRequest,
} from './protocol.js';

// Schema gate
export { validateSpecShape } from './schema/validate.js';

// Data dictionary (the fourth contract)
export {
  allowedTables,
  dictionaryToPrompt,
  type DataDictionary,
  type DictionaryTable,
  type DictionaryColumn,
} from './dictionary.js';

// Registry
export {
  widgetDefinitions,
  getWidgetDefinition,
  widgetTypes,
  type WidgetDefinition,
  type ResultShapeContract,
  type WidgetSizing,
} from './registry/index.js';

// Layout library
export {
  layoutTemplates,
  getLayout,
  parseLayoutRef,
  layoutTemplateSchema,
} from './layouts/index.js';

// Engine
export { compose } from './engine/composer.js';
export {
  interpret,
  validateSemantics,
  type InterpretResult,
  type InterpretedDashboard,
} from './engine/interpreter.js';
export { applyPatch, parsePointer, PatchError, type PatchOperation } from './engine/patch.js';
export { extractParams, paramsInSql, widgetsAffectedBy, PARAM_TOKEN } from './engine/params.js';
export {
  QueryClient,
  queryKey,
  type QueryState,
  type QueryFetcher,
  type QueryClientOptions,
} from './engine/query-client.js';
export { readGenerationStream } from './engine/sse.js';
