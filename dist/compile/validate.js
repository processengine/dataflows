import { makeDiagnostic, hasErrors } from './diagnostics.js';
import { isValidPathRef, isWritablePath, isReadablePath, isSchemaKey, pathsConflict, getInputRefs, inputTargetPathSegments } from '../utils/path.js';
import { isJsonSafe } from '../utils/json.js';

const ALLOWED_SOURCE_FIELDS = new Set(['id', 'version', 'title', 'description', 'schema', 'schemaRef', 'pipeline', 'metadata']);
const ALLOWED_ITEM_FIELDS = new Set(['id', 'type', 'kind', 'artefactId', 'title', 'description', 'contract', 'metadata']);
const ALLOWED_CONTRACT_FIELDS = new Set(['input', 'output']);
const ALLOWED_OUTPUT_FIELDS = new Set(['ref']);
const ALLOWED_ITEM_TYPES = new Set(['MAPPINGS', 'RULES', 'DECISIONS']);
const MAPPING_KINDS = new Set(['payload', 'facts', 'result']);

export function validateDataflowSource(source, options = {}) {
  const diagnostics = [];

  if (source == null || typeof source !== 'object' || Array.isArray(source)) {
    diagnostics.push(makeDiagnostic({ code: 'DATAFLOW_INVALID_SOURCE', level: 'error', message: 'source must be a non-null object' }));
    return { ok: false, diagnostics };
  }

  for (const field of Object.keys(source)) {
    if (!ALLOWED_SOURCE_FIELDS.has(field)) {
      diagnostics.push(makeDiagnostic({
        code: 'DATAFLOW_SOURCE_FORBIDDEN_FIELD',
        level: 'error',
        message: `source.${field} is not part of the dataflow v2 contract`,
        path: field,
        details: { field }
      }));
    }
  }

  if (typeof source.id !== 'string' || source.id.trim() === '') {
    diagnostics.push(makeDiagnostic({ code: 'DATAFLOW_ID_REQUIRED', level: 'error', message: 'id must be a non-empty string', path: 'id' }));
  }
  if (typeof source.version !== 'string' || source.version.trim() === '') {
    diagnostics.push(makeDiagnostic({ code: 'DATAFLOW_VERSION_REQUIRED', level: 'error', message: 'version must be a non-empty string', path: 'version' }));
  }
  if (source.metadata !== undefined && !isJsonSafe(source.metadata)) {
    diagnostics.push(makeDiagnostic({ code: 'DATAFLOW_METADATA_NOT_JSON_SAFE', level: 'error', message: 'metadata must be JSON-safe', path: 'metadata' }));
  }

  const hasContrib = source.schema !== undefined;
  const hasRef = source.schemaRef !== undefined;
  if (hasContrib && hasRef) {
    diagnostics.push(makeDiagnostic({ code: 'DATAFLOW_SCHEMA_AMBIGUOUS', level: 'error', message: 'Exactly one of schema or schemaRef must be present, not both', path: 'schema' }));
  } else if (!hasContrib && !hasRef) {
    diagnostics.push(makeDiagnostic({ code: 'DATAFLOW_SCHEMA_MISSING', level: 'error', message: 'Either schema or schemaRef must be present' }));
  }

  let resolvedSchema = null;
  if (hasContrib) {
    if (source.schema === null || typeof source.schema !== 'object' || Array.isArray(source.schema)) {
      diagnostics.push(makeDiagnostic({ code: 'DATAFLOW_SCHEMA_REF_INVALID', level: 'error', message: 'schema must be an object', path: 'schema' }));
      resolvedSchema = {};
    } else {
      resolvedSchema = source.schema;
      validateDataflowSchemaKeys(resolvedSchema, diagnostics, 'schema');
    }
  }

  if (hasRef && typeof source.schemaRef !== 'string') {
    diagnostics.push(makeDiagnostic({ code: 'DATAFLOW_SCHEMA_REF_INVALID', level: 'error', message: 'schemaRef must be a string', path: 'schemaRef' }));
  }

  if (!hasContrib && hasRef && options.schemaRegistry?.get && typeof source.schemaRef === 'string') {
    const schemaArtifact = options.schemaRegistry.get(source.schemaRef);
    if (!schemaArtifact) {
      diagnostics.push(makeDiagnostic({ code: 'DATAFLOW_SCHEMA_REF_NOT_FOUND', level: 'error', message: `Schema artifact not found: ${source.schemaRef}`, path: 'schemaRef', details: { schemaRef: source.schemaRef } }));
    } else {
      resolvedSchema = schemaArtifact.schema;
      if (resolvedSchema === null || typeof resolvedSchema !== 'object' || Array.isArray(resolvedSchema)) {
        diagnostics.push(makeDiagnostic({ code: 'DATAFLOW_SCHEMA_REF_INVALID', level: 'error', message: `schemaRef "${source.schemaRef}" resolved to invalid schema`, path: 'schemaRef', details: { schemaRef: source.schemaRef } }));
        resolvedSchema = {};
      } else {
        validateDataflowSchemaKeys(resolvedSchema, diagnostics, 'schemaRef');
      }
    }
  }

  if (!Array.isArray(source.pipeline) || source.pipeline.length === 0) {
    diagnostics.push(makeDiagnostic({ code: 'DATAFLOW_PIPELINE_EMPTY', level: 'error', message: 'pipeline must be a non-empty array', path: 'pipeline' }));
    return { ok: false, diagnostics };
  }

  const seenIds = new Set();
  const outputRefs = [];

  for (let idx = 0; idx < source.pipeline.length; idx++) {
    const item = source.pipeline[idx];
    const base = `pipeline[${idx}]`;

    if (item == null || typeof item !== 'object' || Array.isArray(item)) {
      diagnostics.push(makeDiagnostic({ code: 'DATAFLOW_ITEM_CONTRACT_MISSING', level: 'error', message: 'each pipeline item must be an object', path: base }));
      continue;
    }

    for (const field of Object.keys(item)) {
      if (!ALLOWED_ITEM_FIELDS.has(field)) {
        diagnostics.push(makeDiagnostic({
          code: 'DATAFLOW_ITEM_FORBIDDEN_FIELD',
          level: 'error',
          message: `pipeline item field "${field}" is not part of the dataflow v2 item contract`,
          path: `${base}.${field}`,
          details: { field }
        }));
      }
    }

    if (typeof item.id !== 'string' || item.id.trim() === '') {
      diagnostics.push(makeDiagnostic({ code: 'DATAFLOW_ITEM_CONTRACT_MISSING', level: 'error', message: 'item.id must be a non-empty string', path: `${base}.id` }));
    } else if (seenIds.has(item.id)) {
      diagnostics.push(makeDiagnostic({ code: 'DATAFLOW_ITEM_ID_DUPLICATE', level: 'error', message: `Duplicate item id: ${item.id}`, path: `${base}.id`, details: { id: item.id } }));
    } else {
      seenIds.add(item.id);
    }

    if (!ALLOWED_ITEM_TYPES.has(item.type)) {
      diagnostics.push(makeDiagnostic({ code: 'DATAFLOW_ITEM_TYPE_UNSUPPORTED', level: 'error', message: `Unsupported item type: "${item.type}". Allowed item types: MAPPINGS, RULES, DECISIONS`, path: `${base}.type`, details: { type: item.type } }));
    }

    if (item.type !== 'MAPPINGS' && item.kind !== undefined) {
      diagnostics.push(makeDiagnostic({
        code: 'DATAFLOW_ITEM_FORBIDDEN_FIELD',
        level: 'error',
        message: 'item.kind is allowed only for MAPPINGS items',
        path: `${base}.kind`,
        details: { field: 'kind', type: item.type }
      }));
    }

    if (typeof item.artefactId !== 'string' || item.artefactId.trim() === '') {
      diagnostics.push(makeDiagnostic({ code: 'DATAFLOW_ITEM_CONTRACT_MISSING', level: 'error', message: 'item.artefactId must be a non-empty string', path: `${base}.artefactId` }));
    }

    if (!item.contract || typeof item.contract !== 'object' || Array.isArray(item.contract)) {
      diagnostics.push(makeDiagnostic({ code: 'DATAFLOW_ITEM_CONTRACT_MISSING', level: 'error', message: 'item.contract is required', path: `${base}.contract` }));
      continue;
    }

    validateContractFields(item.contract, diagnostics, `${base}.contract`);
    const inputRefs = validateInputContract(item.contract.input, diagnostics, `${base}.contract.input`);
    const outputRef = validateOutputContract(item.contract.output, diagnostics, `${base}.contract.output`);

    if (!isValidPathRef(outputRef)) {
      diagnostics.push(makeDiagnostic({ code: 'DATAFLOW_PATH_INVALID', level: 'error', message: `contract.output.ref must be a valid PathRef starting with "$.": "${outputRef}"`, path: `${base}.contract.output.ref` }));
    } else if (!isWritablePath(outputRef)) {
      diagnostics.push(makeDiagnostic({ code: 'DATAFLOW_WRITE_FORBIDDEN_PATH', level: 'error', message: `contract.output.ref must start with "$.context.data.": "${outputRef}"`, path: `${base}.contract.output.ref`, details: { ref: outputRef } }));
    } else {
      if (resolvedSchema !== null && !resolvedSchema[outputRef]) {
        diagnostics.push(makeDiagnostic({ code: 'DATAFLOW_WRITE_NOT_IN_SCHEMA', level: 'error', message: `contract.output.ref "${outputRef}" is not declared in schema`, path: `${base}.contract.output.ref`, details: { ref: outputRef } }));
      }

      for (const { ref: existingRef, itemId: existingItemId } of outputRefs) {
        if (pathsConflict(outputRef, existingRef)) {
          diagnostics.push(makeDiagnostic({ code: 'DATAFLOW_WRITE_CONFLICT', level: 'error', message: `output.ref "${outputRef}" conflicts with "${existingRef}" (item "${existingItemId}")`, path: `${base}.contract.output.ref`, details: { ref: outputRef, conflictsWithRef: existingRef, conflictsWithItem: existingItemId } }));
        }
      }
      outputRefs.push({ ref: outputRef, itemId: item.id ?? `[${idx}]` });

      for (const inputRef of Object.values(inputRefs || {})) {
        if (inputRef === outputRef) {
          diagnostics.push(makeDiagnostic({ code: 'DATAFLOW_INPLACE_WRITE', level: 'error', message: `item reads and writes the same ref: "${outputRef}"`, path: `${base}.contract`, details: { ref: outputRef } }));
        }
      }
    }

    if (item.type === 'MAPPINGS' && !MAPPING_KINDS.has(item.kind)) {
      diagnostics.push(makeDiagnostic({ code: 'DATAFLOW_ITEM_CONTRACT_MISSING', level: 'error', message: 'MAPPINGS item.kind must be one of: payload, facts, result', path: `${base}.kind` }));
    }

    validateArtifactRegistryReference(item, diagnostics, base, options.artifactRegistries);
  }

  for (let idx = 0; idx < source.pipeline.length; idx++) {
    const item = source.pipeline[idx];
    const inputRefs = Object.values(getInputRefs(item?.contract?.input ?? {}) || {}).filter(isValidPathRef);
    if (!inputRefs.length) continue;

    for (let futureIdx = idx + 1; futureIdx < source.pipeline.length; futureIdx++) {
      const futureItem = source.pipeline[futureIdx];
      const futureOutputRef = futureItem?.contract?.output?.ref;
      if (!isValidPathRef(futureOutputRef)) continue;
      for (const inputRef of inputRefs) {
        if (pathsConflict(inputRef, futureOutputRef)) {
          diagnostics.push(makeDiagnostic({
            code: 'DATAFLOW_READ_FROM_FUTURE_ITEM',
            level: 'error',
            message: `item "${item.id ?? idx}" reads "${inputRef}" which conflicts with output "${futureOutputRef}" of later item "${futureItem.id ?? futureIdx}"`,
            path: `pipeline[${idx}].contract.input.refs`,
            details: { readRef: inputRef, writtenByItem: futureItem.id ?? String(futureIdx) }
          }));
        }
      }
    }
  }

  return { ok: !hasErrors(diagnostics), diagnostics };
}

function validateDataflowSchemaKeys(schema, diagnostics, path) {
  for (const [key, node] of Object.entries(schema)) {
    if (!isValidPathRef(key)) {
      diagnostics.push(makeDiagnostic({ code: 'DATAFLOW_SCHEMA_PATH_INVALID', level: 'error', message: `schema key must be a PathRef starting with "$.": "${key}"`, path, details: { key } }));
      continue;
    }
    if (!isSchemaKey(key)) {
      diagnostics.push(makeDiagnostic({ code: 'DATAFLOW_SCHEMA_FORBIDDEN_PATH', level: 'error', message: `schema key must start with "$.context.data.": "${key}"`, path, details: { key } }));
      continue;
    }
    validateDataflowSchemaNode(node, diagnostics, `${path}.${key}`, key);
  }
}

function validateDataflowSchemaNode(node, diagnostics, path, key) {
  if (node === null || typeof node !== 'object' || Array.isArray(node)) {
    diagnostics.push(makeDiagnostic({ code: 'DATAFLOW_SCHEMA_NODE_INVALID', level: 'error', message: `schema node for "${key}" must be an object`, path, details: { key } }));
    return;
  }

  const allowedNodeFields = new Set(['title', 'description', 'fields']);
  for (const field of Object.keys(node)) {
    if (!allowedNodeFields.has(field)) {
      diagnostics.push(makeDiagnostic({ code: 'DATAFLOW_SCHEMA_NODE_FORBIDDEN_FIELD', level: 'error', message: `schema node field "${field}" is not part of the dataflow v2 schema contract`, path: `${path}.${field}`, details: { key, field } }));
    }
  }

  if (typeof node.title !== 'string' || node.title.trim() === '') {
    diagnostics.push(makeDiagnostic({ code: 'DATAFLOW_SCHEMA_NODE_TITLE_REQUIRED', level: 'error', message: `schema node "${key}" must have a non-empty human-readable title`, path: `${path}.title`, details: { key } }));
  }
  if (typeof node.description !== 'string' || node.description.trim() === '') {
    diagnostics.push(makeDiagnostic({ code: 'DATAFLOW_SCHEMA_NODE_DESCRIPTION_REQUIRED', level: 'error', message: `schema node "${key}" must have a non-empty description`, path: `${path}.description`, details: { key } }));
  }

  if (node.fields !== undefined) {
    if (node.fields === null || typeof node.fields !== 'object' || Array.isArray(node.fields)) {
      diagnostics.push(makeDiagnostic({ code: 'DATAFLOW_SCHEMA_FIELDS_INVALID', level: 'error', message: `schema node "${key}" fields must be an object`, path: `${path}.fields`, details: { key } }));
      return;
    }
    for (const [fieldName, fieldNode] of Object.entries(node.fields)) {
      validateDataflowSchemaField(fieldNode, diagnostics, `${path}.fields.${fieldName}`, key, fieldName);
    }
  }

  if (!isJsonSafe(node)) {
    diagnostics.push(makeDiagnostic({ code: 'DATAFLOW_SCHEMA_NOT_JSON_SAFE', level: 'error', message: `schema value for "${key}" must be JSON-safe`, path, details: { key } }));
  }
}

function validateDataflowSchemaField(fieldNode, diagnostics, path, schemaKey, fieldName) {
  if (fieldNode === null || typeof fieldNode !== 'object' || Array.isArray(fieldNode)) {
    diagnostics.push(makeDiagnostic({ code: 'DATAFLOW_SCHEMA_FIELD_INVALID', level: 'error', message: `schema field "${fieldName}" of "${schemaKey}" must be an object`, path, details: { schemaKey, fieldName } }));
    return;
  }

  const allowedFieldFields = new Set(['type', 'title', 'description']);
  for (const field of Object.keys(fieldNode)) {
    if (!allowedFieldFields.has(field)) {
        diagnostics.push(makeDiagnostic({ code: 'DATAFLOW_SCHEMA_FIELD_FORBIDDEN_FIELD', level: 'error', message: `schema field property "${field}" is not part of the dataflow v2 schema field contract`, path: `${path}.${field}`, details: { schemaKey, fieldName, field } }));
    }
  }

  if (fieldNode.type !== undefined && (typeof fieldNode.type !== 'string' || fieldNode.type.trim() === '')) {
    diagnostics.push(makeDiagnostic({ code: 'DATAFLOW_SCHEMA_FIELD_TYPE_INVALID', level: 'error', message: `schema field "${fieldName}" type must be a non-empty string when present`, path: `${path}.type`, details: { schemaKey, fieldName } }));
  }
  if (typeof fieldNode.title !== 'string' || fieldNode.title.trim() === '') {
    diagnostics.push(makeDiagnostic({ code: 'DATAFLOW_SCHEMA_FIELD_TITLE_REQUIRED', level: 'error', message: `schema field "${fieldName}" of "${schemaKey}" must have a non-empty human-readable title`, path: `${path}.title`, details: { schemaKey, fieldName } }));
  }
  if (typeof fieldNode.description !== 'string' || fieldNode.description.trim() === '') {
    diagnostics.push(makeDiagnostic({ code: 'DATAFLOW_SCHEMA_FIELD_DESCRIPTION_REQUIRED', level: 'error', message: `schema field "${fieldName}" of "${schemaKey}" must have a non-empty description`, path: `${path}.description`, details: { schemaKey, fieldName } }));
  }
}


function validateContractFields(contract, diagnostics, path) {
  for (const field of Object.keys(contract)) {
    if (!ALLOWED_CONTRACT_FIELDS.has(field)) {
      diagnostics.push(makeDiagnostic({
        code: 'DATAFLOW_ITEM_CONTRACT_FORBIDDEN_FIELD',
        level: 'error',
        message: `item.contract.${field} is not part of the dataflow v2 contract`,
        path: `${path}.${field}`,
        details: { field }
      }));
    }
  }
}

function validateOutputContract(output, diagnostics, path) {
  if (!output || typeof output !== 'object' || Array.isArray(output)) {
    diagnostics.push(makeDiagnostic({ code: 'DATAFLOW_ITEM_CONTRACT_MISSING', level: 'error', message: 'item.contract.output must be an object with required ref', path }));
    return undefined;
  }
  for (const field of Object.keys(output)) {
    if (!ALLOWED_OUTPUT_FIELDS.has(field)) {
      diagnostics.push(makeDiagnostic({
        code: 'DATAFLOW_ITEM_CONTRACT_FORBIDDEN_FIELD',
        level: 'error',
        message: `item.contract.output.${field} is not supported in dataflows v2; use only item.contract.output.ref`,
        path: `${path}.${field}`,
        details: { field }
      }));
    }
  }
  return output.ref;
}

function validateArtifactRegistryReference(item, diagnostics, base, artifactRegistries) {
  if (!artifactRegistries || typeof item.artefactId !== 'string') return;
  const registryNameByType = {
    MAPPINGS: 'mappings',
    RULES: 'rules',
    DECISIONS: 'decisions',
  };
  const registryName = registryNameByType[item.type];
  if (!registryName) return;
  const registry = artifactRegistries[registryName];
  if (!registry || typeof registry.get !== 'function') return;
  const artifact = registry.get(item.artefactId);
  if (!artifact) {
    diagnostics.push(makeDiagnostic({
      code: 'DATAFLOW_ITEM_ARTEFACT_NOT_FOUND',
      level: 'error',
      message: `${item.type} artifact not found: ${item.artefactId}`,
      path: `${base}.artefactId`,
      details: { artefactId: item.artefactId, type: item.type }
    }));
    return;
  }
  if (item.type === 'MAPPINGS' && artifact.kind && artifact.kind !== item.kind) {
    diagnostics.push(makeDiagnostic({
      code: 'DATAFLOW_MAPPING_KIND_MISMATCH',
      level: 'error',
      message: `item.kind "${item.kind}" does not match artifact.kind "${artifact.kind}"`,
      path: `${base}.kind`,
      details: { itemKind: item.kind, artifactKind: artifact.kind }
    }));
  }
}

function validateInputContract(input, diagnostics, path) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    diagnostics.push(makeDiagnostic({ code: 'DATAFLOW_ITEM_CONTRACT_MISSING', level: 'error', message: 'item.contract.input must be an object with required refs', path }));
    return undefined;
  }

  for (const key of Object.keys(input)) {
    if (key !== 'refs') {
      diagnostics.push(makeDiagnostic({ code: 'DATAFLOW_ITEM_CONTRACT_FORBIDDEN_FIELD', level: 'error', message: `item.contract.input.${key} is not supported in dataflows v2; use only item.contract.input.refs`, path: `${path}.${key}`, details: { field: key } }));
    }
  }

  const refs = getInputRefs(input);
  if (!refs || typeof refs !== 'object' || Array.isArray(refs) || Object.keys(refs).length === 0) {
    diagnostics.push(makeDiagnostic({ code: 'DATAFLOW_ITEM_CONTRACT_MISSING', level: 'error', message: 'item.contract.input.refs must be a non-empty object', path: `${path}.refs` }));
    return undefined;
  }

  const entries = Object.entries(refs);
  const hasRootTarget = Object.prototype.hasOwnProperty.call(refs, '$');
  if (hasRootTarget && entries.length > 1) {
    diagnostics.push(makeDiagnostic({ code: 'DATAFLOW_INPUT_REFS_ROOT_AMBIGUOUS', level: 'error', message: 'input.refs "$" target must not be mixed with named targets', path: `${path}.refs.$` }));
  }
  for (const [targetPath, ref] of entries) {
    if (!inputTargetPathSegments(targetPath)) {
      diagnostics.push(makeDiagnostic({ code: 'DATAFLOW_INPUT_TARGET_INVALID', level: 'error', message: `input.refs target must be "$" or a safe object path: "${targetPath}"`, path: `${path}.refs.${targetPath}`, details: { targetPath } }));
    }
    if (typeof ref !== 'string') {
      diagnostics.push(makeDiagnostic({ code: 'DATAFLOW_ITEM_CONTRACT_MISSING', level: 'error', message: `item.contract.input.refs.${targetPath} must be a string PathRef`, path: `${path}.refs.${targetPath}` }));
      continue;
    }
    if (!isValidPathRef(ref)) {
      diagnostics.push(makeDiagnostic({ code: 'DATAFLOW_PATH_INVALID', level: 'error', message: `contract.input.refs.${targetPath} must be a valid PathRef starting with "$.": "${ref}"`, path: `${path}.refs.${targetPath}` }));
      continue;
    }
    if (!isReadablePath(ref)) {
      diagnostics.push(makeDiagnostic({ code: 'DATAFLOW_READ_FORBIDDEN_PATH', level: 'error', message: `contract.input.refs.${targetPath} must be $.context.input, $.context.effects, $.context.data, or a nested path under one of them: "${ref}"`, path: `${path}.refs.${targetPath}`, details: { ref, targetPath } }));
    }
  }
  return refs;
}
