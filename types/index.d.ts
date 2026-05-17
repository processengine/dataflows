export type PathRef = string;
export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };
export type MappingKind = 'payload' | 'facts' | 'result';
export type PipelineItemType = 'MAPPINGS' | 'RULES' | 'DECISIONS';
export type TraceMode = false | 'basic' | 'verbose';

export interface DataflowInputContract { ref: PathRef; }

export interface SchemaFieldDef { type?: string; title: string; description: string; }
export interface SchemaNode { title: string; description: string; fields?: Record<string, SchemaFieldDef>; }
export type DataflowSchema = Record<PathRef, SchemaNode>;

export interface DataflowPipelineItemSource {
  id: string;
  type: PipelineItemType;
  artefactId: string;
  kind?: MappingKind;
  contract: { input: DataflowInputContract; output: { ref: PathRef } };
  title?: string; description?: string; metadata?: JsonObject;
}

export interface DataflowSource {
  id: string;
  version: string;
  title?: string; description?: string;
  schema?: DataflowSchema;
  schemaRef?: string;
  pipeline: DataflowPipelineItemSource[];
  metadata?: JsonObject;
}

export interface PreparedDataflowItem {
  id: string; type: PipelineItemType; artefactId: string; kind?: MappingKind;
  contract: { input: DataflowInputContract; output: { ref: PathRef } };
  title?: string; description?: string; metadata?: JsonObject;
}

export interface DataflowArtifact {
  readonly artifactType: 'dataflow';
  readonly id: string; readonly version: string;
  readonly schema: DataflowSchema;
  readonly readSet: PathRef[]; readonly writeSet: PathRef[];
  readonly items: readonly PreparedDataflowItem[];
  readonly title?: string; readonly description?: string; readonly metadata?: JsonObject;
}

export interface DataflowRegistries {
  mappings?: {
    get(id: string): unknown;
    executeMappings(artifact: unknown, input: JsonValue): { output: JsonValue; trace?: unknown[] };
  };
  rules?: {
    get(id: string): unknown;
    evaluateRules(artifact: unknown, input: JsonValue): { output: JsonValue; trace?: unknown[] };
  };
  decisions?: {
    get(id: string): unknown;
    evaluateDecisions(artifact: unknown, input: JsonValue): { output: JsonValue; trace?: unknown[] };
  };
  schemas?: { get(id: string): unknown };
}

export interface DataflowExecutionInput { state: JsonObject; registries: DataflowRegistries; }
export interface DataflowWrite { readonly ref: PathRef; readonly value: JsonValue; readonly itemId: string; }
export interface DataflowTraceEntry {
  readonly kind: 'DATAFLOW_ITEM_COMPLETED' | 'DATAFLOW_ITEM_FAILED';
  readonly artifactType: 'dataflow'; readonly artifactId: string;
  readonly step: { readonly id: string; readonly type: PipelineItemType; readonly artefactId: string };
  readonly at: string; readonly outcome: 'completed' | 'failed';
  readonly details?: JsonObject; readonly input?: JsonValue; readonly output?: JsonValue;
}
export interface DataflowOutput { readonly writes: readonly DataflowWrite[]; readonly trace?: readonly DataflowTraceEntry[]; }

export interface DataflowDiagnostic { readonly code: string; readonly level: 'error' | 'warning'; readonly message: string; readonly path?: string; readonly details?: JsonObject; }
export interface ValidationResult { readonly ok: boolean; readonly diagnostics: readonly DataflowDiagnostic[]; }

export interface ValidateDataflowOptions { schemaRegistry?: { get(id: string): unknown }; artifactRegistries?: { mappings?: { get(id: string): unknown }; rules?: { get(id: string): unknown }; decisions?: { get(id: string): unknown } }; }
export interface PrepareDataflowOptions { schemaRegistry?: { get(id: string): unknown }; artifactRegistries?: unknown; freeze?: boolean; }
export interface ExecuteDataflowOptions { trace?: TraceMode; runtimeSchemaValidation?: false | 'assert'; redaction?: { redact?: (value: JsonValue, mode: TraceMode) => JsonValue }; }
export interface ExtractDataflowSchemaOptions { schemaRegistry?: { get(id: string): unknown }; }

export declare class DataflowCompileError extends Error {
  readonly code: 'DATAFLOW_COMPILE_ERROR';
  readonly diagnostics: readonly DataflowDiagnostic[];
  constructor(diagnostics: DataflowDiagnostic[], message?: string);
}
export declare class DataflowRuntimeError extends Error {
  readonly code: string; readonly details: JsonObject | null; readonly cause?: unknown;
  constructor(params?: { code?: string; message?: string; details?: JsonObject; cause?: unknown });
}

export declare function validateDataflow(source: unknown, options?: ValidateDataflowOptions): ValidationResult;
export declare function prepareDataflow(source: DataflowSource, options?: PrepareDataflowOptions): DataflowArtifact;
export declare function executeDataflow(artifact: DataflowArtifact, input: DataflowExecutionInput, options?: ExecuteDataflowOptions): DataflowOutput;
export declare function extractDataflowSchema(source: DataflowSource, options?: ExtractDataflowSchemaOptions): DataflowSchema;
export declare function formatDataflowDiagnostics(diagnostics: DataflowDiagnostic[]): string;
export declare function formatDataflowRuntimeError(error: DataflowRuntimeError): string;
