import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  validateDataflow, prepareDataflow, executeDataflow,
  DataflowCompileError, DataflowRuntimeError,
  formatDataflowDiagnostics, formatDataflowRuntimeError,
} from '../dist/index.js';
import { existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));

// ─── Packaging ───────────────────────────────────────────────────────────────

test('dist/index.d.ts exists after build', () => {
  assert.ok(existsSync(resolve(root, 'dist', 'index.d.ts')), 'dist/index.d.ts must exist for typed exports');
});


function schemaField(type, title = 'Schema field', description = 'Human-readable schema field documentation.') {
  return { type, title, description };
}

function schemaNode(title = 'Data object', fields = {}, description = 'Human-readable data object documentation.') {
  return { title, description, fields };
}

// ─── Fixtures ────────────────────────────────────────────────────────────────

const validSource = {
  id: 'dataflow.abs.evaluate_resolution',
  version: '1.0.0',
  title: 'Оценка клиента в АБС',
  schema: {
    '$.context.data.payloads.clientComparison': { title: 'Payload', description: 'Payload data object.', fields: {} },
    '$.context.data.facts.clientComparison': { title: 'Facts', description: 'Facts data object.', fields: { hasCriticalMismatches: schemaField('boolean') } },
    '$.context.data.decisions.absClientResolution': { title: 'Decision', description: 'Decision data object.', fields: { outcome: schemaField('string') } },
  },
  pipeline: [
    {
      id: 'map_abs_response',
      type: 'MAPPINGS',
      kind: 'payload',
      artefactId: 'mappings.abs.response_payload',
      contract: {
        input: { ref: '$.context.effects.run_abs.waitResult.result' },
        output: { ref: '$.context.data.payloads.clientComparison' },
      },
    },
    {
      id: 'derive_comparison_facts',
      type: 'MAPPINGS',
      kind: 'facts',
      artefactId: 'mappings.abs.client_comparison_facts',
      contract: {
        input: { ref: '$.context.data.payloads.clientComparison' },
        output: { ref: '$.context.data.facts.clientComparison' },
      },
    },
    {
      id: 'choose_resolution',
      type: 'DECISIONS',
      artefactId: 'decisions.abs.client_resolution',
      contract: {
        input: { ref: '$.context.data.facts.clientComparison' },
        output: { ref: '$.context.data.decisions.absClientResolution' },
      },
    },
  ],
};

// ─── validateDataflow — basic ─────────────────────────────────────────────────

test('validateDataflow: valid source returns ok=true', () => {
  const result = validateDataflow(validSource);
  assert.equal(result.ok, true, formatDataflowDiagnostics(result.diagnostics));
});

test('validateDataflow: missing id', () => {
  const r = validateDataflow({ ...validSource, id: '' });
  assert.equal(r.ok, false);
  assert.ok(r.diagnostics.some(d => d.code === 'DATAFLOW_ID_REQUIRED'));
});

test('validateDataflow: missing version', () => {
  const r = validateDataflow({ ...validSource, version: undefined });
  assert.equal(r.ok, false);
  assert.ok(r.diagnostics.some(d => d.code === 'DATAFLOW_VERSION_REQUIRED'));
});

test('validateDataflow: both schema and schemaRef', () => {
  const r = validateDataflow({ ...validSource, schemaRef: 'schema.x' });
  assert.equal(r.ok, false);
  assert.ok(r.diagnostics.some(d => d.code === 'DATAFLOW_SCHEMA_AMBIGUOUS'));
});

test('validateDataflow: neither schema nor schemaRef', () => {
  const { schema, ...rest } = validSource;
  const r = validateDataflow(rest);
  assert.equal(r.ok, false);
  assert.ok(r.diagnostics.some(d => d.code === 'DATAFLOW_SCHEMA_MISSING'));
});

test('validateDataflow: empty pipeline', () => {
  const r = validateDataflow({ ...validSource, pipeline: [] });
  assert.equal(r.ok, false);
  assert.ok(r.diagnostics.some(d => d.code === 'DATAFLOW_PIPELINE_EMPTY'));
});

test('validateDataflow: unsupported item type (flow-level step)', () => {
  const r = validateDataflow({ ...validSource, pipeline: [{ ...validSource.pipeline[0], type: 'PROCESS/DATA' }] });
  assert.equal(r.ok, false);
  assert.ok(r.diagnostics.some(d => d.code === 'DATAFLOW_ITEM_TYPE_UNSUPPORTED'));
});

test('validateDataflow: duplicate item id', () => {
  const r = validateDataflow({
    ...validSource,
    pipeline: [validSource.pipeline[0], { ...validSource.pipeline[1], id: validSource.pipeline[0].id }],
  });
  assert.equal(r.ok, false);
  assert.ok(r.diagnostics.some(d => d.code === 'DATAFLOW_ITEM_ID_DUPLICATE'));
});

test('validateDataflow: output ref outside $.context.data.*', () => {
  const r = validateDataflow({
    ...validSource,
    pipeline: [{ ...validSource.pipeline[0], contract: { input: { ref: '$.context.input.application' }, output: { ref: '$.context.effects.x' } } }],
  });
  assert.equal(r.ok, false);
  assert.ok(r.diagnostics.some(d => d.code === 'DATAFLOW_WRITE_FORBIDDEN_PATH'));
});

test('validateDataflow: duplicate output ref (exact match)', () => {
  const r = validateDataflow({
    ...validSource,
    pipeline: [
      validSource.pipeline[0],
      { ...validSource.pipeline[1], contract: { ...validSource.pipeline[1].contract, output: validSource.pipeline[0].contract.output } },
    ],
  });
  assert.equal(r.ok, false);
  assert.ok(r.diagnostics.some(d => d.code === 'DATAFLOW_WRITE_CONFLICT'));
});

test('validateDataflow: parent/child path conflict', () => {
  const r = validateDataflow({
    ...validSource,
    schema: {
      '$.context.data.facts.x': schemaNode(),
      '$.context.data.facts.x.child': schemaNode(),
    },
    pipeline: [
      { id: 'a', type: 'MAPPINGS', kind: 'facts', artefactId: 'x', contract: { input: { ref: '$.context.input.application' }, output: { ref: '$.context.data.facts.x' } } },
      { id: 'b', type: 'MAPPINGS', kind: 'facts', artefactId: 'y', contract: { input: { ref: '$.context.effects.e' }, output: { ref: '$.context.data.facts.x.child' } } },
    ],
  });
  assert.equal(r.ok, false);
  assert.ok(r.diagnostics.some(d => d.code === 'DATAFLOW_WRITE_CONFLICT'));
});

test('validateDataflow: in-place write', () => {
  const ref = '$.context.data.facts.x';
  const r = validateDataflow({
    ...validSource,
    schema: { [ref]: {} },
    pipeline: [{ id: 'inplace', type: 'MAPPINGS', kind: 'facts', artefactId: 'x', contract: { input: { ref }, output: { ref } } }],
  });
  assert.equal(r.ok, false);
  assert.ok(r.diagnostics.some(d => d.code === 'DATAFLOW_INPLACE_WRITE'));
});

test('validateDataflow: MAPPINGS without kind', () => {
  const r = validateDataflow({ ...validSource, pipeline: [{ ...validSource.pipeline[0], kind: undefined }] });
  assert.equal(r.ok, false);
  assert.ok(r.diagnostics.some(d => d.code === 'DATAFLOW_ITEM_CONTRACT_MISSING'));
});

test('validateDataflow: read-from-future-item detected', () => {
  const r = validateDataflow({
    ...validSource,
    schema: { '$.context.data.facts.x': schemaNode(), '$.context.data.facts.y': schemaNode() },
    pipeline: [
      { id: 'item_a', type: 'MAPPINGS', kind: 'facts', artefactId: 'a', contract: { input: { ref: '$.context.data.facts.y' }, output: { ref: '$.context.data.facts.x' } } },
      { id: 'item_b', type: 'DECISIONS', artefactId: 'b', contract: { input: { ref: '$.context.data.facts.x' }, output: { ref: '$.context.data.facts.y' } } },
    ],
  });
  assert.equal(r.ok, false);
  assert.ok(r.diagnostics.some(d => d.code === 'DATAFLOW_READ_FROM_FUTURE_ITEM'));
});

test('validateDataflow does not throw on invalid input', () => {
  assert.doesNotThrow(() => validateDataflow(null));
  assert.doesNotThrow(() => validateDataflow({}));
});

// ─── Normative schema/output contract ───────────────────────────────────────

test('validateDataflow: output.ref not in schema is error', () => {
  const r = validateDataflow({
    ...validSource,
    schema: {
      '$.context.data.facts.clientComparison': schemaNode(),
      '$.context.data.decisions.absClientResolution': schemaNode(),
      // missing $.context.data.payloads.clientComparison
    },
    pipeline: [validSource.pipeline[0]], // writes to payloads.clientComparison — not in schema
  });
  assert.equal(r.ok, false);
  assert.ok(r.diagnostics.some(d => d.code === 'DATAFLOW_WRITE_NOT_IN_SCHEMA'), JSON.stringify(r.diagnostics));
});

// ─── Normative schema path contract ─────────────────────────────

test('validateDataflow: schema key without "$." is error', () => {
  const r = validateDataflow({
    ...validSource,
    schema: { 'context.data.bad': schemaNode() },
  });
  assert.equal(r.ok, false);
  assert.ok(r.diagnostics.some(d => d.code === 'DATAFLOW_SCHEMA_PATH_INVALID'), JSON.stringify(r.diagnostics));
});

test('validateDataflow: schema key outside $.context.data.* is error', () => {
  const r = validateDataflow({
    ...validSource,
    schema: { '$.context.input.something': schemaNode() },
  });
  assert.equal(r.ok, false);
  assert.ok(r.diagnostics.some(d => d.code === 'DATAFLOW_SCHEMA_FORBIDDEN_PATH'), JSON.stringify(r.diagnostics));
});

// ─── Normative read-ref roots ───────────────────────────────────────────────

test('validateDataflow: input.ref outside allowed roots is error', () => {
  const r = validateDataflow({
    ...validSource,
    pipeline: [{
      id: 'bad_read',
      type: 'MAPPINGS',
      kind: 'facts',
      artefactId: 'x',
      contract: {
        input: { ref: '$.some.random.place' },
        output: { ref: '$.context.data.facts.clientComparison' },
      },
    }],
  });
  assert.equal(r.ok, false);
  assert.ok(r.diagnostics.some(d => d.code === 'DATAFLOW_READ_FORBIDDEN_PATH'), JSON.stringify(r.diagnostics));
});

// ─── prepareDataflow ──────────────────────────────────────────────────────────

test('prepareDataflow: returns prepared artifact with correct shape', () => {
  const artifact = prepareDataflow(validSource);
  assert.equal(artifact.artifactType, 'dataflow');
  assert.equal(artifact.id, validSource.id);
  assert.equal(artifact.items.length, 3);
  assert.ok(Array.isArray(artifact.readSet));
  assert.ok(Array.isArray(artifact.writeSet));
});

test('prepareDataflow: readSet includes input ref path', () => {
  const source = {
    ...validSource,
    schema: { '$.context.data.facts.combined': schemaNode() },
    pipeline: [{
      id: 'map',
      type: 'MAPPINGS',
      kind: 'facts',
      artefactId: 'x',
      contract: {
        input: { ref: '$.context.input.application' },
        output: { ref: '$.context.data.facts.combined' },
      },
    }],
  };
  const artifact = prepareDataflow(source);
  assert.deepEqual(artifact.readSet, ['$.context.input.application']);
});

test('prepareDataflow: throws DataflowCompileError on invalid source', () => {
  assert.throws(
    () => prepareDataflow({ ...validSource, id: '' }),
    (err) => err instanceof DataflowCompileError && err.code === 'DATAFLOW_COMPILE_ERROR',
  );
});

test('prepareDataflow: artifact is frozen', () => {
  const artifact = prepareDataflow(validSource);
  assert.ok(Object.isFrozen(artifact));
});

test('prepareDataflow: artifact is JSON-serializable', () => {
  const artifact = prepareDataflow(validSource);
  const restored = JSON.parse(JSON.stringify(artifact));
  assert.equal(restored.artifactType, 'dataflow');
  assert.equal(restored.writeSet.length, 3);
});

test('prepareDataflow: resolves schemaRef', () => {
  const { schema, ...rest } = validSource;
  const source = { ...rest, schemaRef: 'schema.abs' };
  const schemaRegistry = { get: (id) => id === 'schema.abs' ? { schema: validSource.schema } : undefined };
  const artifact = prepareDataflow(source, { schemaRegistry });
  assert.ok(artifact.schema['$.context.data.facts.clientComparison']);
});


test('validateDataflow: schema node requires title and description', () => {
  const r = validateDataflow({
    ...validSource,
    schema: {
      '$.context.data.facts.x': { title: 'Facts without description', fields: {} },
    },
    pipeline: [{
      id: 'map', type: 'MAPPINGS', kind: 'facts', artefactId: 'mappings.x',
      contract: { input: { ref: '$.context.input.application' }, output: { ref: '$.context.data.facts.x' } },
    }],
  });
  assert.equal(r.ok, false);
  assert.ok(r.diagnostics.some(d => d.code === 'DATAFLOW_SCHEMA_NODE_DESCRIPTION_REQUIRED'), JSON.stringify(r.diagnostics));
});

test('validateDataflow: schema fields require title and description', () => {
  const r = validateDataflow({
    ...validSource,
    schema: {
      '$.context.data.facts.x': {
        title: 'Facts',
        description: 'Facts object.',
        fields: { ok: { type: 'boolean', title: 'OK' } },
      },
    },
    pipeline: [{
      id: 'map', type: 'MAPPINGS', kind: 'facts', artefactId: 'mappings.x',
      contract: { input: { ref: '$.context.input.application' }, output: { ref: '$.context.data.facts.x' } },
    }],
  });
  assert.equal(r.ok, false);
  assert.ok(r.diagnostics.some(d => d.code === 'DATAFLOW_SCHEMA_FIELD_DESCRIPTION_REQUIRED'), JSON.stringify(r.diagnostics));
});

// ─── executeDataflow ──────────────────────────────────────────────────────────

const makeStubRegistries = () => ({
  mappings: {
    get: (id) => ({ kind: 'stub', id }),
    executeMappings: (art, input) => {
      if (art.id === 'mappings.abs.response_payload') return { output: { absClientId: 'CL-001' } };
      return { output: { hasCriticalMismatches: false } };
    },
  },
  decisions: {
    get: (id) => ({ kind: 'stub', id }),
    evaluateDecisions: () => ({ output: { outcome: 'BIND_EXISTING' } }),
  },
});

const makeState = () => ({
  context: { effects: { run_abs: { waitResult: { result: { clients: [{ id: 'CL-001' }] } } } } },
});

test('executeDataflow: returns writes in order', () => {
  const artifact = prepareDataflow(validSource);
  const result = executeDataflow(artifact, { state: makeState(), registries: makeStubRegistries() });
  assert.equal(result.writes.length, 3);
  assert.equal(result.writes[0].ref, '$.context.data.payloads.clientComparison');
  assert.equal(result.writes[2].ref, '$.context.data.decisions.absClientResolution');
});

test('executeDataflow: uses canonical { output } runtime result from mappings', () => {
  const artifact = prepareDataflow(validSource);
  const registries = {
    ...makeStubRegistries(),
    mappings: {
      get: (id) => ({ id }),
      // Returns wrapped result as mappings v3 would
      executeMappings: (art) => ({ output: { fromWrapped: true }, trace: [] }),
    },
  };
  const result = executeDataflow(artifact, { state: makeState(), registries });
  // Should write the .output value, not the wrapper
  assert.deepEqual(result.writes[0].value, { fromWrapped: true });
});

test('executeDataflow: read-after-write works', () => {
  const artifact = prepareDataflow(validSource);
  const factsCalls = [];
  const registries = {
    ...makeStubRegistries(),
    mappings: {
      get: (id) => ({ id }),
      executeMappings: (art, input) => {
        if (art.id === 'mappings.abs.client_comparison_facts') { factsCalls.push(input); return { output: { hasCriticalMismatches: false } }; }
        return { output: { absClientId: 'CL-001' } };
      },
    },
  };
  executeDataflow(artifact, { state: makeState(), registries });
  assert.equal(factsCalls[0].absClientId, 'CL-001');
});

test('executeDataflow: does not mutate original state', () => {
  const artifact = prepareDataflow(validSource);
  const state = makeState();
  const snap = JSON.stringify(state);
  executeDataflow(artifact, { state, registries: makeStubRegistries() });
  assert.equal(JSON.stringify(state), snap);
});

test('executeDataflow: writes are JSON-safe', () => {
  const artifact = prepareDataflow(validSource);
  const result = executeDataflow(artifact, { state: makeState(), registries: makeStubRegistries() });
  assert.doesNotThrow(() => JSON.stringify(result));
});

test('executeDataflow: throws DataflowRuntimeError — artifact not in registry', () => {
  const artifact = prepareDataflow(validSource);
  const registries = { mappings: { get: () => undefined, executeMappings: () => ({ output: {} }) }, decisions: { get: () => undefined, evaluateDecisions: () => ({ output: {} }) } };
  assert.throws(
    () => executeDataflow(artifact, { state: makeState(), registries }),
    (err) => err instanceof DataflowRuntimeError && err.code === 'DATAFLOW_ITEM_ARTIFACT_NOT_FOUND',
  );
});

test('executeDataflow: throws DataflowRuntimeError — input ref missing', () => {
  const artifact = prepareDataflow(validSource);
  assert.throws(
    () => executeDataflow(artifact, { state: { context: {} }, registries: makeStubRegistries() }),
    (err) => err instanceof DataflowRuntimeError && err.code === 'DATAFLOW_INPUT_REF_NOT_FOUND',
  );
});

test('executeDataflow: throws DataflowRuntimeError — item throws', () => {
  const artifact = prepareDataflow(validSource);
  const registries = { ...makeStubRegistries(), mappings: { get: (id) => ({ id }), executeMappings: () => { throw new Error('oops'); } } };
  assert.throws(
    () => executeDataflow(artifact, { state: makeState(), registries }),
    (err) => err instanceof DataflowRuntimeError && err.code === 'DATAFLOW_ITEM_EXECUTION_FAILED',
  );
});

test('executeDataflow: throws DataflowRuntimeError — non-JSON-safe output', () => {
  const artifact = prepareDataflow(validSource);
  const registries = { ...makeStubRegistries(), mappings: { get: (id) => ({ id }), executeMappings: () => ({ output: { fn: () => {} } }) } };
  assert.throws(
    () => executeDataflow(artifact, { state: makeState(), registries }),
    (err) => err instanceof DataflowRuntimeError && err.code === 'DATAFLOW_OUTPUT_NOT_JSON_SAFE',
  );
});

test('executeDataflow: throws typed error for cyclic item output (not RangeError)', () => {
  const artifact = prepareDataflow(validSource);
  const cyclic = {};
  cyclic.self = cyclic;
  const registries = { ...makeStubRegistries(), mappings: { get: (id) => ({ id }), executeMappings: () => ({ output: cyclic }) } };
  assert.throws(
    () => executeDataflow(artifact, { state: makeState(), registries }),
    (err) => err instanceof DataflowRuntimeError && err.code === 'DATAFLOW_OUTPUT_NOT_JSON_SAFE',
  );
});

test('executeDataflow: throws typed error for non-JSON-safe input state', () => {
  const artifact = prepareDataflow(validSource);
  const badState = { context: { effects: { run_abs: { waitResult: { result: undefined } } } } };
  // undefined is not JSON-safe
  assert.throws(
    () => executeDataflow(artifact, { state: badState, registries: makeStubRegistries() }),
    (err) => err instanceof DataflowRuntimeError,
  );
});

test('executeDataflow: no partial writes on failure', () => {
  const artifact = prepareDataflow(validSource);
  let count = 0;
  const registries = { ...makeStubRegistries(), mappings: { get: (id) => ({ id }), executeMappings: () => { if (++count === 2) throw new Error('fail'); return { output: { ok: true } }; } } };
  try {
    executeDataflow(artifact, { state: makeState(), registries });
    assert.fail('should throw');
  } catch (err) {
    assert.ok(err instanceof DataflowRuntimeError);
    // No partial result — error thrown before return
  }
});


test('prepareDataflow: schemaRef output.ref not declared in resolved schema is compile error', () => {
  const { schema, ...rest } = validSource;
  const source = {
    ...rest,
    schemaRef: 'schema.abs',
    pipeline: [{
      id: 'bad_schema_ref_write',
      type: 'MAPPINGS',
      kind: 'facts',
      artefactId: 'mappings.bad',
      contract: {
        input: { ref: '$.context.input.application' },
        output: { ref: '$.context.data.facts.notDeclared' },
      },
    }],
  };
  const schemaRegistry = { get: () => ({ schema: { '$.context.data.facts.declared': schemaNode() } }) };
  assert.throws(
    () => prepareDataflow(source, { schemaRegistry }),
    (err) => err instanceof DataflowCompileError && err.diagnostics.some(d => d.code === 'DATAFLOW_WRITE_NOT_IN_SCHEMA'),
  );
});

test('executeDataflow: missing input.ref throws before registry call', () => {
  const source = {
    id: 'dataflow.input.ref.missing',
    version: '1.0.0',
    schema: { '$.context.data.facts.x': schemaNode() },
    pipeline: [{
      id: 'map',
      type: 'MAPPINGS',
      kind: 'facts',
      artefactId: 'mappings.x',
      contract: {
        input: { ref: '$.context.input.missing' },
        output: { ref: '$.context.data.facts.x' },
      },
    }],
  };
  const artifact = prepareDataflow(source);
  let called = false;
  const registries = { mappings: { get: () => ({}), executeMappings: () => { called = true; return { output: {} }; } } };
  assert.throws(
    () => executeDataflow(artifact, { state: { context: { input: {} } }, registries }),
    (err) => err instanceof DataflowRuntimeError && err.code === 'DATAFLOW_INPUT_REF_NOT_FOUND' && err.details.ref === '$.context.input.missing',
  );
  assert.equal(called, false);
});

test('executeDataflow: bare runtime value is invalid canonical result', () => {
  const source = {
    id: 'dataflow.canonical.runtime.result',
    version: '1.0.0',
    schema: { '$.context.data.facts.x': schemaNode() },
    pipeline: [{
      id: 'map',
      type: 'MAPPINGS',
      kind: 'facts',
      artefactId: 'mappings.x',
      contract: { input: { ref: '$.context.input.data' }, output: { ref: '$.context.data.facts.x' } },
    }],
  };
  const artifact = prepareDataflow(source);
  const registries = { mappings: { get: () => ({}), executeMappings: () => ({ output: 'business field', status: 'OK' }).output } };
  assert.throws(
    () => executeDataflow(artifact, { state: { context: { input: { data: {} } } }, registries }),
    (err) => err instanceof DataflowRuntimeError && err.code === 'DATAFLOW_RUNTIME_RESULT_INVALID',
  );
});

// ─── runtimeSchemaValidation ──────────────────────────────────────────────────

test('runtimeSchemaValidation=assert: passes when types match', () => {
  const artifact = prepareDataflow(validSource);
  const registries = {
    ...makeStubRegistries(),
    mappings: { get: (id) => ({ id }), executeMappings: (art) => art.id === 'mappings.abs.response_payload' ? { output: { absClientId: 'CL-001' } } : { output: { hasCriticalMismatches: false } } },
    decisions: { get: (id) => ({ id }), evaluateDecisions: () => ({ output: { outcome: 'BIND_EXISTING' } }) },
  };
  assert.doesNotThrow(() => executeDataflow(artifact, { state: makeState(), registries }, { runtimeSchemaValidation: 'assert' }));
});

test('runtimeSchemaValidation=assert: throws on type mismatch', () => {
  const source = {
    id: 'dataflow.schema.test',
    version: '1.0.0',
    schema: {
      '$.context.data.facts.x': schemaNode('Data object', { flag: schemaField('boolean') }),
    },
    pipeline: [{
      id: 'map', type: 'MAPPINGS', kind: 'facts', artefactId: 'mappings.x',
      contract: { input: { ref: '$.context.input.data' }, output: { ref: '$.context.data.facts.x' } },
    }],
  };
  const artifact = prepareDataflow(source);
  const registries = { mappings: { get: () => ({}), executeMappings: () => ({ output: { flag: 'not-a-boolean' } }) } };
  const state = { context: { input: { data: {} } } };
  assert.throws(
    () => executeDataflow(artifact, { state, registries }, { runtimeSchemaValidation: 'assert' }),
    (err) => err instanceof DataflowRuntimeError && err.code === 'DATAFLOW_OUTPUT_SCHEMA_INVALID',
  );
});

// ─── trace ────────────────────────────────────────────────────────────────────

test('trace=false: no trace in output', () => {
  const artifact = prepareDataflow(validSource);
  const result = executeDataflow(artifact, { state: makeState(), registries: makeStubRegistries() }, { trace: false });
  assert.equal(result.trace, undefined);
});

test('trace=basic: events present, no raw values', () => {
  const artifact = prepareDataflow(validSource);
  const result = executeDataflow(artifact, { state: makeState(), registries: makeStubRegistries() }, { trace: 'basic' });
  assert.ok(Array.isArray(result.trace));
  assert.equal(result.trace.length, 3);
  const entry = result.trace[0];
  assert.equal(entry.kind, 'DATAFLOW_ITEM_COMPLETED');
  assert.ok(entry.step?.id);
  assert.equal(entry.input, undefined);
  assert.equal(entry.output, undefined);
});

test('trace step contains canonical fields', () => {
  const artifact = prepareDataflow(validSource);
  const result = executeDataflow(artifact, { state: makeState(), registries: makeStubRegistries() }, { trace: 'basic' });
  const entry = result.trace[0];
  ['kind', 'artifactType', 'artifactId', 'step', 'at', 'outcome'].forEach(k => assert.ok(k in entry, `missing: ${k}`));
});

// ─── Formatters ───────────────────────────────────────────────────────────────

test('formatDataflowDiagnostics: readable string', () => {
  const r = validateDataflow({ ...validSource, id: '' });
  const s = formatDataflowDiagnostics(r.diagnostics);
  assert.ok(s.includes('DATAFLOW_ID_REQUIRED'));
});

test('formatDataflowRuntimeError: readable string', () => {
  const err = new DataflowRuntimeError({ code: 'DATAFLOW_ITEM_ARTIFACT_NOT_FOUND', message: 'not found' });
  assert.ok(formatDataflowRuntimeError(err).includes('DATAFLOW_ITEM_ARTIFACT_NOT_FOUND'));
});

test('validateDataflow: input contract without ref is invalid', () => {
  const r = validateDataflow({
    ...validSource,
    schema: { '$.context.data.facts.x': schemaNode() },
    pipeline: [{
      id: 'missing_input_ref',
      type: 'MAPPINGS',
      kind: 'facts',
      artefactId: 'mappings.x',
      contract: {
        input: {},
        output: { ref: '$.context.data.facts.x' },
      },
    }],
  });
  assert.equal(r.ok, false);
  assert.ok(r.diagnostics.some(d => d.code === 'DATAFLOW_ITEM_CONTRACT_MISSING'), JSON.stringify(r.diagnostics));
});

test('validateDataflow: input contract rejects unsupported fields', () => {
  const r = validateDataflow({
    ...validSource,
    schema: { '$.context.data.facts.x': schemaNode() },
    pipeline: [{
      id: 'strict_input_contract',
      type: 'MAPPINGS',
      kind: 'facts',
      artefactId: 'mappings.x',
      contract: {
        input: { ref: '$.context.input.a', unsupported: true },
        output: { ref: '$.context.data.facts.x' },
      },
    }],
  });
  assert.equal(r.ok, false);
  assert.ok(r.diagnostics.some(d => d.code === 'DATAFLOW_ITEM_CONTRACT_FORBIDDEN_FIELD' && d.details.field === 'unsupported'), JSON.stringify(r.diagnostics));
});

test('executeDataflow: invalid execution input throws typed runtime error', () => {
  const artifact = prepareDataflow(validSource);
  assert.throws(
    () => executeDataflow(artifact, null),
    (err) => err instanceof DataflowRuntimeError && err.code === 'DATAFLOW_EXECUTION_INPUT_INVALID',
  );
});

test('executeDataflow: missing registries throws typed runtime error', () => {
  const artifact = prepareDataflow(validSource);
  assert.throws(
    () => executeDataflow(artifact, { state: makeState() }),
    (err) => err instanceof DataflowRuntimeError && err.code === 'DATAFLOW_REGISTRY_MISSING',
  );
});

test('executeDataflow: missing registry method throws typed runtime error', () => {
  const source = {
    id: 'dataflow.registry.method',
    version: '1.0.0',
    schema: { '$.context.data.facts.x': schemaNode() },
    pipeline: [{
      id: 'map',
      type: 'MAPPINGS',
      kind: 'facts',
      artefactId: 'mappings.x',
      contract: { input: { ref: '$.context.input.data' }, output: { ref: '$.context.data.facts.x' } },
    }],
  };
  const artifact = prepareDataflow(source);
  assert.throws(
    () => executeDataflow(artifact, { state: { context: { input: { data: {} } } }, registries: { mappings: { get: () => ({}) } } }),
    (err) => err instanceof DataflowRuntimeError && err.code === 'DATAFLOW_REGISTRY_METHOD_MISSING',
  );
});

test('extractDataflowSchema: resolves schemaRef through registry', async () => {
  const { extractDataflowSchema } = await import('../dist/index.js');
  const schema = { '$.context.data.facts.x': schemaNode('Data object', {}) };
  const result = extractDataflowSchema(
    { id: 'df', version: '1', schemaRef: 'schema.x', pipeline: [] },
    { schemaRegistry: { get: (id) => id === 'schema.x' ? { schema: schema } : undefined } },
  );
  assert.deepEqual(result, schema);
});

test('extractDataflowSchema: schemaRef without registry throws compile error', async () => {
  const { extractDataflowSchema } = await import('../dist/index.js');
  assert.throws(
    () => extractDataflowSchema({ id: 'df', version: '1', schemaRef: 'schema.x', pipeline: [] }),
    (err) => err instanceof DataflowCompileError && err.diagnostics.some(d => d.code === 'DATAFLOW_SCHEMA_REF_NOT_FOUND'),
  );
});

test('validateDataflow: source rejects unsupported fields', () => {
  const r = validateDataflow({ ...validSource, unsupported: true });
  assert.equal(r.ok, false);
  assert.ok(r.diagnostics.some(d => d.code === 'DATAFLOW_SOURCE_FORBIDDEN_FIELD' && d.details.field === 'unsupported'), JSON.stringify(r.diagnostics));
});

test('validateDataflow: pipeline item rejects unsupported fields', () => {
  const r = validateDataflow({
    ...validSource,
    pipeline: [{ ...validSource.pipeline[0], unsupported: true }],
  });
  assert.equal(r.ok, false);
  assert.ok(r.diagnostics.some(d => d.code === 'DATAFLOW_ITEM_FORBIDDEN_FIELD' && d.details.field === 'unsupported'), JSON.stringify(r.diagnostics));
});

test('validateDataflow: RULES and DECISIONS reject kind field', () => {
  const rules = validateDataflow({
    ...validSource,
    schema: { '$.context.data.checks.x': schemaNode() },
    pipeline: [{ id: 'r', type: 'RULES', kind: 'facts', artefactId: 'rules.x', contract: { input: { ref: '$.context.input.application' }, output: { ref: '$.context.data.checks.x' } } }],
  });
  assert.equal(rules.ok, false);
  assert.ok(rules.diagnostics.some(d => d.code === 'DATAFLOW_ITEM_FORBIDDEN_FIELD' && d.details.field === 'kind'), JSON.stringify(rules.diagnostics));

  const decisions = validateDataflow({
    ...validSource,
    schema: { '$.context.data.decisions.x': schemaNode() },
    pipeline: [{ id: 'd', type: 'DECISIONS', kind: 'facts', artefactId: 'decisions.x', contract: { input: { ref: '$.context.input.application' }, output: { ref: '$.context.data.decisions.x' } } }],
  });
  assert.equal(decisions.ok, false);
  assert.ok(decisions.diagnostics.some(d => d.code === 'DATAFLOW_ITEM_FORBIDDEN_FIELD' && d.details.field === 'kind'), JSON.stringify(decisions.diagnostics));
});

test('validateDataflow: item contract and output reject unsupported fields', () => {
  const r = validateDataflow({
    ...validSource,
    schema: { '$.context.data.facts.x': schemaNode() },
    pipeline: [{
      id: 'strict_contract',
      type: 'MAPPINGS',
      kind: 'facts',
      artefactId: 'mappings.x',
      contract: {
        input: { ref: '$.context.input.application' },
        output: { ref: '$.context.data.facts.x', unsupported: true },
        retry: 3,
      },
    }],
  });
  assert.equal(r.ok, false);
  assert.ok(r.diagnostics.some(d => d.code === 'DATAFLOW_ITEM_CONTRACT_FORBIDDEN_FIELD' && d.details.field === 'retry'), JSON.stringify(r.diagnostics));
  assert.ok(r.diagnostics.some(d => d.code === 'DATAFLOW_ITEM_CONTRACT_FORBIDDEN_FIELD' && d.details.field === 'unsupported'), JSON.stringify(r.diagnostics));
});

test('validateDataflow: artifactRegistries validates RULES and DECISIONS references', () => {
  const rulesSource = {
    id: 'df.rules.registry',
    version: '1',
    schema: { '$.context.data.checks.x': schemaNode() },
    pipeline: [{ id: 'r', type: 'RULES', artefactId: 'rules.x', contract: { input: { ref: '$.context.input.application' }, output: { ref: '$.context.data.checks.x' } } }],
  };
  const rulesResult = validateDataflow(rulesSource, { artifactRegistries: { rules: { get: () => undefined } } });
  assert.equal(rulesResult.ok, false);
  assert.ok(rulesResult.diagnostics.some(d => d.code === 'DATAFLOW_ITEM_ARTEFACT_NOT_FOUND' && d.details.type === 'RULES'), JSON.stringify(rulesResult.diagnostics));

  const decisionsSource = {
    id: 'df.decisions.registry',
    version: '1',
    schema: { '$.context.data.decisions.x': schemaNode() },
    pipeline: [{ id: 'd', type: 'DECISIONS', artefactId: 'decisions.x', contract: { input: { ref: '$.context.input.application' }, output: { ref: '$.context.data.decisions.x' } } }],
  };
  const decisionsResult = validateDataflow(decisionsSource, { artifactRegistries: { decisions: { get: () => undefined } } });
  assert.equal(decisionsResult.ok, false);
  assert.ok(decisionsResult.diagnostics.some(d => d.code === 'DATAFLOW_ITEM_ARTEFACT_NOT_FOUND' && d.details.type === 'DECISIONS'), JSON.stringify(decisionsResult.diagnostics));
});

test('extractDataflowSchema: missing schema contract throws compile error', async () => {
  const { extractDataflowSchema } = await import('../dist/index.js');
  assert.throws(
    () => extractDataflowSchema({ id: 'df', version: '1', pipeline: [] }),
    (err) => err instanceof DataflowCompileError && err.diagnostics.some(d => d.code === 'DATAFLOW_SCHEMA_MISSING'),
  );
});

test('extractDataflowSchema: both schema and schemaRef throws compile error', async () => {
  const { extractDataflowSchema } = await import('../dist/index.js');
  assert.throws(
    () => extractDataflowSchema({ id: 'df', version: '1', schema: {}, schemaRef: 'schema.x', pipeline: [] }),
    (err) => err instanceof DataflowCompileError && err.diagnostics.some(d => d.code === 'DATAFLOW_SCHEMA_AMBIGUOUS'),
  );
});

test('executeDataflow: failure trace is attached to runtime error when trace is enabled', () => {
  const artifact = prepareDataflow(validSource);
  const registries = { ...makeStubRegistries(), mappings: { get: (id) => ({ id }), executeMappings: () => { throw new Error('boom'); } } };
  assert.throws(
    () => executeDataflow(artifact, { state: makeState(), registries }, { trace: 'basic' }),
    (err) => err instanceof DataflowRuntimeError
      && err.code === 'DATAFLOW_ITEM_EXECUTION_FAILED'
      && Array.isArray(err.details?.trace)
      && err.details.trace.some(e => e.kind === 'DATAFLOW_ITEM_FAILED'),
  );
});

test('executeDataflow: runtime rejects manually corrupted output.ref outside $.context.data.*', () => {
  const artifact = prepareDataflow(validSource, { freeze: false });
  artifact.items = [{
    ...artifact.items[0],
    contract: { input: { ref: '$.context.effects.run_abs.waitResult.result' }, output: { ref: '$.context.effects.bad' } },
  }];
  assert.throws(
    () => executeDataflow(artifact, { state: makeState(), registries: makeStubRegistries() }),
    (err) => err instanceof DataflowRuntimeError && err.code === 'DATAFLOW_WRITE_FORBIDDEN_PATH',
  );
});

test('executeDataflow: runtime rejects manually corrupted output.ref missing in schema', () => {
  const artifact = prepareDataflow(validSource, { freeze: false });
  artifact.items = [{
    ...artifact.items[0],
    contract: { input: { ref: '$.context.effects.run_abs.waitResult.result' }, output: { ref: '$.context.data.facts.notDeclared' } },
  }];
  assert.throws(
    () => executeDataflow(artifact, { state: makeState(), registries: makeStubRegistries() }),
    (err) => err instanceof DataflowRuntimeError && err.code === 'DATAFLOW_WRITE_NOT_IN_SCHEMA',
  );
});

test('runtimeSchemaValidation=assert: schema node with fields rejects scalar output', () => {
  const source = {
    id: 'dataflow.schema.scalar.test',
    version: '1.0.0',
    schema: {
      '$.context.data.facts.x': schemaNode('Data object', { flag: schemaField('boolean') }),
    },
    pipeline: [{
      id: 'map', type: 'MAPPINGS', kind: 'facts', artefactId: 'mappings.x',
      contract: { input: { ref: '$.context.input.data' }, output: { ref: '$.context.data.facts.x' } },
    }],
  };
  const artifact = prepareDataflow(source);
  const registries = { mappings: { get: () => ({}), executeMappings: () => ({ output: 'not-an-object' }) } };
  const state = { context: { input: { data: {} } } };
  assert.throws(
    () => executeDataflow(artifact, { state, registries }, { runtimeSchemaValidation: 'assert' }),
    (err) => err instanceof DataflowRuntimeError && err.code === 'DATAFLOW_OUTPUT_SCHEMA_INVALID',
  );
});

test('executeDataflow: verbose redaction must return JSON-safe trace values', () => {
  const artifact = prepareDataflow(validSource);
  assert.throws(
    () => executeDataflow(artifact, { state: makeState(), registries: makeStubRegistries() }, {
      trace: 'verbose',
      redaction: { redact: () => ({ fn: () => {} }) },
    }),
    (err) => err instanceof DataflowRuntimeError && err.code === 'DATAFLOW_TRACE_NOT_JSON_SAFE',
  );
});
