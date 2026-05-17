import { validateDataflowSource } from './validate.js';
import { hasErrors } from './diagnostics.js';
import { DataflowCompileError } from '../errors/DataflowCompileError.js';
import { getInputRef } from '../utils/path.js';

export function prepareDataflowArtifact(source, options = {}) {
  const validation = validateDataflowSource(source, options);
  if (!validation.ok) {
    throw new DataflowCompileError(validation.diagnostics);
  }

  // Resolve schema
  let schema;
  if (source.schema !== undefined) {
    schema = source.schema;
  } else {
    const registry = options.schemaRegistry;
    if (!registry?.get) {
      throw new DataflowCompileError([{
        code: 'DATAFLOW_SCHEMA_REF_NOT_FOUND',
        level: 'error',
        message: `schemaRef "${source.schemaRef}" cannot be resolved: no schemaRegistry provided`,
        path: 'schemaRef'
      }]);
    }
    const schemaArtifact = registry.get(source.schemaRef);
    if (!schemaArtifact) {
      throw new DataflowCompileError([{
        code: 'DATAFLOW_SCHEMA_REF_NOT_FOUND',
        level: 'error',
        message: `Schema artifact not found: ${source.schemaRef}`,
        path: 'schemaRef',
        details: { schemaRef: source.schemaRef }
      }]);
    }
    schema = schemaArtifact.schema;
  }

  // Derive readSet / writeSet. Dataflows v1 has a single input ref per item.
  const readSet = [];
  const writeSet = [];
  for (const item of source.pipeline) {
    const inputRef = getInputRef(item.contract?.input ?? {});
    if (inputRef && !readSet.includes(inputRef)) readSet.push(inputRef);
    const outputRef = item.contract?.output?.ref;
    if (outputRef && !writeSet.includes(outputRef)) writeSet.push(outputRef);
  }

  // Build prepared items
  const items = source.pipeline.map(item => {
    const prepared = {
      id: item.id,
      type: item.type,
      artefactId: item.artefactId,
      contract: {
        input: item.contract.input,
        output: { ref: item.contract.output.ref },
      },
    };
    if (item.type === 'MAPPINGS') prepared.kind = item.kind;
    if (item.title !== undefined) prepared.title = item.title;
    if (item.description !== undefined) prepared.description = item.description;
    if (item.metadata !== undefined) prepared.metadata = item.metadata;
    return Object.freeze(prepared);
  });

  const artifact = {
    artifactType: 'dataflow',
    id: source.id,
    version: source.version,
    schema: schema ?? {},
    readSet,
    writeSet,
    items,
  };
  if (source.title !== undefined) artifact.title = source.title;
  if (source.description !== undefined) artifact.description = source.description;
  if (source.metadata !== undefined) artifact.metadata = source.metadata;

  const shouldFreeze = options.freeze !== false;
  return shouldFreeze ? deepFreeze(artifact) : artifact;
}

function deepFreeze(obj) {
  Object.freeze(obj);
  for (const val of Object.values(obj)) {
    if (val !== null && typeof val === 'object' && !Object.isFrozen(val)) {
      deepFreeze(val);
    }
  }
  return obj;
}
