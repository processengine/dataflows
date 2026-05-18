import { isJsonSafe, jsonSafeCopy } from '../utils/json.js';
import { getByPath, setByPath, isWritablePath, setInputTargetPath } from '../utils/path.js';
import { DataflowRuntimeError } from '../errors/DataflowRuntimeError.js';

const TRACE_MODES = new Set(['off', 'basic', 'verbose']);
const ALLOWED_OPTION_KEYS = new Set(['trace', 'runtimeSchemaValidation', 'redaction']);

/**
 * Normalize canonical runtime result from neighbour libraries.
 * Runtime modules in the ProcessEngine family MUST return
 * { output: JsonValue, trace?: JsonValue[] }.
 * Bare business values are not accepted because they are ambiguous when
 * the business value itself contains an `output` field.
 */
function normalizeRuntimeResult(raw, item) {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw) || !Object.prototype.hasOwnProperty.call(raw, 'output')) {
    throw new DataflowRuntimeError({
      code: 'DATAFLOW_RUNTIME_RESULT_INVALID',
      message: `${item.type} item "${item.id}" returned invalid runtime result. Expected object with "output" field.`,
      details: { itemId: item.id, type: item.type, artefactId: item.artefactId },
    });
  }
  return raw.output;
}

function makeErrorWithTrace(params, trace) {
  if (trace && trace.length > 0) {
    params = {
      ...params,
      details: {
        ...(params.details ?? {}),
        trace,
      },
    };
  }
  return new DataflowRuntimeError(params);
}

function pushFailedTrace(trace, artifact, item, options, at) {
  if (trace) trace.push(makeTraceEntry('DATAFLOW_ITEM_FAILED', artifact, item, 'failed', options, at));
}

function readInputOrThrow(workingState, inputContract, item, trace, artifact, options, at) {
  const refs = inputContract?.refs;
  const entries = Object.entries(refs || {});
  if (entries.length === 1 && entries[0][0] === '$') {
    const ref = entries[0][1];
    const value = getByPath(workingState, ref);
    if (value === undefined) {
      pushFailedTrace(trace, artifact, item, options, at);
      throw makeErrorWithTrace({
        code: 'DATAFLOW_INPUT_REF_NOT_FOUND',
        message: `contract.input.refs.$ not found in state: ${ref}`,
        details: { itemId: item.id, targetPath: '$', ref },
      }, trace);
    }
    return jsonSafeCopy(value);
  }

  const input = {};
  for (const [targetPath, ref] of entries) {
    const value = getByPath(workingState, ref);
    if (value === undefined) {
      pushFailedTrace(trace, artifact, item, options, at);
      throw makeErrorWithTrace({
        code: 'DATAFLOW_INPUT_REF_NOT_FOUND',
        message: `contract.input.refs.${targetPath} not found in state: ${ref}`,
        details: { itemId: item.id, targetPath, ref },
      }, trace);
    }
    if (!setInputTargetPath(input, targetPath, jsonSafeCopy(value))) {
      pushFailedTrace(trace, artifact, item, options, at);
      throw makeErrorWithTrace({
        code: 'DATAFLOW_INPUT_TARGET_INVALID',
        message: `prepared input.refs target is invalid: ${targetPath}`,
        details: { itemId: item.id, targetPath },
      }, trace);
    }
  }
  return input;
}

function validateExecutionInput(input) {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    throw new DataflowRuntimeError({
      code: 'DATAFLOW_EXECUTION_INPUT_INVALID',
      message: 'executeDataflow input must be an object with state and registries',
    });
  }
  if (!Object.prototype.hasOwnProperty.call(input, 'state')) {
    throw new DataflowRuntimeError({
      code: 'DATAFLOW_EXECUTION_INPUT_INVALID',
      message: 'executeDataflow input.state is required',
    });
  }
  if (input.registries === null || typeof input.registries !== 'object' || Array.isArray(input.registries)) {
    throw new DataflowRuntimeError({
      code: 'DATAFLOW_REGISTRY_MISSING',
      message: 'executeDataflow input.registries is required and must be an object',
    });
  }
}

function validateExecutionOptions(options) {
  if (options === undefined) return {};
  if (options === null || typeof options !== 'object' || Array.isArray(options)) {
    throw new DataflowRuntimeError({
      code: 'DATAFLOW_EXECUTION_OPTIONS_INVALID',
      message: 'executeDataflow options must be a plain object when provided',
    });
  }
  for (const key of Object.keys(options)) {
    if (!ALLOWED_OPTION_KEYS.has(key)) {
      throw new DataflowRuntimeError({
        code: 'DATAFLOW_EXECUTION_OPTIONS_INVALID',
        message: `Unsupported executeDataflow option: ${key}`,
        details: { option: key },
      });
    }
  }
  if (options.trace !== undefined && !TRACE_MODES.has(options.trace)) {
    throw new DataflowRuntimeError({
      code: 'DATAFLOW_TRACE_MODE_INVALID',
      message: 'options.trace must be "off", "basic", or "verbose"',
      details: { trace: options.trace },
    });
  }
  return options;
}

function assertPreparedArtifactContract(artifact) {
  if (!artifact || artifact.artifactType !== 'dataflow') {
    throw new DataflowRuntimeError({
      code: 'DATAFLOW_INTERNAL_ERROR',
      message: 'executeDataflow expects a prepared DataflowArtifact from prepareDataflow()',
    });
  }
  if (!artifact.schema || typeof artifact.schema !== 'object' || Array.isArray(artifact.schema)) {
    throw new DataflowRuntimeError({
      code: 'DATAFLOW_PREPARED_ARTIFACT_INVALID',
      message: 'prepared DataflowArtifact.schema must be an object',
    });
  }
  if (!Array.isArray(artifact.items)) {
    throw new DataflowRuntimeError({
      code: 'DATAFLOW_PREPARED_ARTIFACT_INVALID',
      message: 'prepared DataflowArtifact.items must be an array',
    });
  }
}

function assertPreparedItemWriteContract(artifact, item) {
  const outputRef = item?.contract?.output?.ref;
  if (!isWritablePath(outputRef)) {
    throw new DataflowRuntimeError({
      code: 'DATAFLOW_WRITE_FORBIDDEN_PATH',
      message: `prepared item output.ref must start with $.context.data.: ${outputRef}`,
      details: { itemId: item?.id ?? null, ref: outputRef ?? null },
    });
  }
  if (!Object.prototype.hasOwnProperty.call(artifact.schema, outputRef)) {
    throw new DataflowRuntimeError({
      code: 'DATAFLOW_WRITE_NOT_IN_SCHEMA',
      message: `prepared item output.ref is not declared in schema: ${outputRef}`,
      details: { itemId: item?.id ?? null, ref: outputRef },
    });
  }
}

function getRegistryForItem(registries, item) {
  if (item.type === 'MAPPINGS') {
    const registry = registries.mappings;
    if (!registry) throw new DataflowRuntimeError({ code: 'DATAFLOW_REGISTRY_MISSING', message: 'mappings registry is required for MAPPINGS item', details: { itemId: item.id, type: item.type } });
    if (typeof registry.get !== 'function') throw new DataflowRuntimeError({ code: 'DATAFLOW_REGISTRY_METHOD_MISSING', message: 'mappings registry must provide get(id)', details: { itemId: item.id, type: item.type, method: 'get' } });
    if (typeof registry.executeMappings !== 'function') throw new DataflowRuntimeError({ code: 'DATAFLOW_REGISTRY_METHOD_MISSING', message: 'mappings registry must provide executeMappings(artifact, input)', details: { itemId: item.id, type: item.type, method: 'executeMappings' } });
    return registry;
  }
  if (item.type === 'RULES') {
    const registry = registries.rules;
    if (!registry) throw new DataflowRuntimeError({ code: 'DATAFLOW_REGISTRY_MISSING', message: 'rules registry is required for RULES item', details: { itemId: item.id, type: item.type } });
    if (typeof registry.get !== 'function') throw new DataflowRuntimeError({ code: 'DATAFLOW_REGISTRY_METHOD_MISSING', message: 'rules registry must provide get(id)', details: { itemId: item.id, type: item.type, method: 'get' } });
    if (typeof registry.evaluateRules !== 'function') throw new DataflowRuntimeError({ code: 'DATAFLOW_REGISTRY_METHOD_MISSING', message: 'rules registry must provide evaluateRules(artifact, input)', details: { itemId: item.id, type: item.type, method: 'evaluateRules' } });
    return registry;
  }
  if (item.type === 'DECISIONS') {
    const registry = registries.decisions;
    if (!registry) throw new DataflowRuntimeError({ code: 'DATAFLOW_REGISTRY_MISSING', message: 'decisions registry is required for DECISIONS item', details: { itemId: item.id, type: item.type } });
    if (typeof registry.get !== 'function') throw new DataflowRuntimeError({ code: 'DATAFLOW_REGISTRY_METHOD_MISSING', message: 'decisions registry must provide get(id)', details: { itemId: item.id, type: item.type, method: 'get' } });
    if (typeof registry.evaluateDecisions !== 'function') throw new DataflowRuntimeError({ code: 'DATAFLOW_REGISTRY_METHOD_MISSING', message: 'decisions registry must provide evaluateDecisions(artifact, input)', details: { itemId: item.id, type: item.type, method: 'evaluateDecisions' } });
    return registry;
  }
  throw new DataflowRuntimeError({ code: 'DATAFLOW_INTERNAL_ERROR', message: `Unsupported prepared item type: ${item.type}`, details: { itemId: item.id, type: item.type } });
}

export function executeDataflowArtifact(artifact, input, options = {}) {
  validateExecutionInput(input);
  const executionOptions = validateExecutionOptions(options);
  const { state, registries } = input;
  const traceMode = executionOptions.trace ?? 'off';
  const runtimeSchemaValidation = executionOptions.runtimeSchemaValidation ?? false;

  assertPreparedArtifactContract(artifact);

  // Assert input state is JSON-safe before copy
  if (!isJsonSafe(state)) {
    throw new DataflowRuntimeError({
      code: 'DATAFLOW_INPUT_NOT_JSON_SAFE',
      message: 'input.state must be JSON-safe. Process state must be transport-safe.',
    });
  }

  let workingState = jsonSafeCopy(state);
  const writes = [];
  const trace = traceMode !== 'off' ? [] : null;

  for (const item of artifact.items) {
    const at = new Date().toISOString();
    assertPreparedItemWriteContract(artifact, item);

    // 1. Resolve explicit input refs declared by the prepared item.
    const itemInput = readInputOrThrow(workingState, item.contract.input, item, trace, artifact, executionOptions, at);

    // 2. Get artifact from registry
    let registry;
    try {
      registry = getRegistryForItem(registries, item);
    } catch (err) {
      pushFailedTrace(trace, artifact, item, executionOptions, at);
      if (err instanceof DataflowRuntimeError) {
        throw makeErrorWithTrace({ code: err.code, message: err.message, details: err.details ?? undefined, cause: err.cause }, trace);
      }
      throw err;
    }
    const registryEntry = registry.get(item.artefactId);

    if (!registryEntry) {
      pushFailedTrace(trace, artifact, item, executionOptions, at);
      throw makeErrorWithTrace({
        code: 'DATAFLOW_ITEM_ARTIFACT_NOT_FOUND',
        message: `${item.type} artifact not found in registry: ${item.artefactId}`,
        details: { itemId: item.id, type: item.type, artefactId: item.artefactId },
      }, trace);
    }

    // 3. Execute via canonical registry runtime, then require canonical { output } result
    let rawResult;
    try {
      if (item.type === 'MAPPINGS') rawResult = registry.executeMappings(registryEntry, itemInput);
      else if (item.type === 'RULES') rawResult = registry.evaluateRules(registryEntry, itemInput);
      else if (item.type === 'DECISIONS') rawResult = registry.evaluateDecisions(registryEntry, itemInput);
    } catch (err) {
      pushFailedTrace(trace, artifact, item, executionOptions, at);
      throw makeErrorWithTrace({
        code: 'DATAFLOW_ITEM_EXECUTION_FAILED',
        message: `${item.type} item "${item.id}" threw during execution: ${err?.message ?? String(err)}`,
        details: { itemId: item.id, artefactId: item.artefactId },
        cause: err,
      }, trace);
    }

    let itemOutput;
    try {
      itemOutput = normalizeRuntimeResult(rawResult, item);
    } catch (err) {
      pushFailedTrace(trace, artifact, item, executionOptions, at);
      if (err instanceof DataflowRuntimeError) {
        throw makeErrorWithTrace({ code: err.code, message: err.message, details: err.details ?? undefined, cause: err.cause }, trace);
      }
      throw err;
    }

    // 4. Assert JSON-safe output
    if (!isJsonSafe(itemOutput)) {
      pushFailedTrace(trace, artifact, item, executionOptions, at);
      throw makeErrorWithTrace({
        code: 'DATAFLOW_OUTPUT_NOT_JSON_SAFE',
        message: `${item.type} item "${item.id}" returned non-JSON-safe output`,
        details: { itemId: item.id, artefactId: item.artefactId },
      }, trace);
    }

    // 5. Runtime schema validation (v2 minimal declared field type assertion)
    if (runtimeSchemaValidation === 'assert') {
      const schemaNode = artifact.schema?.[item.contract.output.ref];
      if (schemaNode?.fields) {
        if (itemOutput === null || typeof itemOutput !== 'object' || Array.isArray(itemOutput)) {
          pushFailedTrace(trace, artifact, item, executionOptions, at);
          const actual = Array.isArray(itemOutput) ? 'array' : itemOutput === null ? 'null' : typeof itemOutput;
          throw makeErrorWithTrace({
            code: 'DATAFLOW_OUTPUT_SCHEMA_INVALID',
            message: `Item "${item.id}" output must be an object because schema node declares fields, got "${actual}"`,
            details: { itemId: item.id, expected: 'object', actual },
          }, trace);
        }
        for (const [field, fieldDef] of Object.entries(schemaNode.fields)) {
          if (field in itemOutput && fieldDef.type) {
            const actual = Array.isArray(itemOutput[field]) ? 'array' : itemOutput[field] === null ? 'null' : typeof itemOutput[field];
            const expected = fieldDef.type;
            const typeOk = actual === expected;
            if (!typeOk) {
              pushFailedTrace(trace, artifact, item, executionOptions, at);
              throw makeErrorWithTrace({
                code: 'DATAFLOW_OUTPUT_SCHEMA_INVALID',
                message: `Field "${field}" of item "${item.id}" has type "${actual}", expected "${expected}"`,
                details: { itemId: item.id, field, expected, actual },
              }, trace);
            }
          }
        }
      }
    }

    // 6. Collect write
    writes.push(Object.freeze({ ref: item.contract.output.ref, value: itemOutput, itemId: item.id }));

    // 7. Write into working state for read-after-write
    workingState = setByPath(workingState, item.contract.output.ref, itemOutput);

    // 8. Trace
    if (trace) trace.push(makeTraceEntry('DATAFLOW_ITEM_COMPLETED', artifact, item, 'completed', executionOptions, at, itemInput, itemOutput));
  }

  const result = { writes: Object.freeze(writes) };
  if (trace !== null) result.trace = Object.freeze(trace);
  if (!isJsonSafe(result)) {
    throw new DataflowRuntimeError({
      code: 'DATAFLOW_OUTPUT_NOT_JSON_SAFE',
      message: 'DataflowOutput must be JSON-safe',
    });
  }
  return result;
}

function makeTraceEntry(kind, artifact, item, outcome, options, at, inputValue, outputValue) {
  const entry = {
    kind,
    artifactType: 'dataflow',
    artifactId: artifact.id,
    step: Object.freeze({ id: item.id, type: item.type, artefactId: item.artefactId }),
    at,
    outcome,
    details: Object.freeze({
      inputContract: item.contract.input,
      outputRef: item.contract.output.ref,
    }),
  };
  if (options.trace === 'verbose') {
    const redact = options.redaction?.redact ?? (v => v);
    if (inputValue !== undefined) entry.input = redact(inputValue, 'verbose');
    if (outputValue !== undefined) entry.output = redact(outputValue, 'verbose');
  }
  if (!isJsonSafe(entry)) {
    throw new DataflowRuntimeError({
      code: 'DATAFLOW_TRACE_NOT_JSON_SAFE',
      message: `Trace entry for item "${item.id}" is not JSON-safe. Redaction must return JSON-safe values.`,
      details: { itemId: item.id, type: item.type },
    });
  }
  return Object.freeze(entry);
}
