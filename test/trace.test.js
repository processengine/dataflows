import { test } from 'node:test';
import assert from 'node:assert/strict';
import { prepareDataflow, executeDataflow } from '../dist/index.js';


function schemaField(type, title = 'Schema field', description = 'Human-readable schema field documentation.') {
  return { type, title, description };
}

function schemaNode(title = 'Data object', fields = {}, description = 'Human-readable data object documentation.') {
  return { title, description, fields };
}

const source = {
  id: 'dataflow.trace.test',
  version: '1.0.0',
  schema: {
    '$.data.facts.result': { title: 'Result', description: 'Result data object.', fields: { ok: schemaField('boolean') } },
  },
  pipeline: [{
    id: 'map_item',
    type: 'MAPPINGS',
    kind: 'facts',
    artefactId: 'mappings.trace.test',
    contract: {
      input: { refs: { '$': '$.input.data' } },
      output: { ref: '$.data.facts.result' },
    },
  }],
};

const registries = {
  mappings: {
    get: (id) => ({ id }),
    executeMappings: () => ({ output: { ok: true } }),
  },
};

const state = { input: { data: { x: 1 } } };

test('trace=off: no trace in output', () => {
  const artifact = prepareDataflow(source);
  const result = executeDataflow(artifact, { state, registries }, { trace: 'off' });
  assert.equal(result.trace, undefined);
});

test('trace=basic: trace present, no raw values', () => {
  const artifact = prepareDataflow(source);
  const result = executeDataflow(artifact, { state, registries }, { trace: 'basic' });
  assert.ok(Array.isArray(result.trace));
  assert.equal(result.trace.length, 1);
  const entry = result.trace[0];
  assert.equal(entry.kind, 'DATAFLOW_ITEM_COMPLETED');
  assert.equal(entry.artifactType, 'dataflow');
  assert.equal(entry.artifactId, 'dataflow.trace.test');
  assert.ok(entry.step);
  assert.equal(entry.step.id, 'map_item');
  assert.equal(entry.step.type, 'MAPPINGS');
  assert.equal(entry.outcome, 'completed');
  assert.ok(typeof entry.at === 'string');
  // basic must not include raw input/output
  assert.equal(entry.input, undefined);
  assert.equal(entry.output, undefined);
});

test('trace=verbose: trace includes input and output', () => {
  const artifact = prepareDataflow(source);
  const result = executeDataflow(artifact, { state, registries }, { trace: 'verbose' });
  assert.ok(Array.isArray(result.trace));
  const entry = result.trace[0];
  // verbose may include input/output
  assert.ok(entry.input !== undefined || entry.output !== undefined);
});

test('trace entries are JSON-safe', () => {
  const artifact = prepareDataflow(source);
  const result = executeDataflow(artifact, { state, registries }, { trace: 'verbose' });
  const serialized = JSON.stringify(result.trace);
  assert.ok(typeof serialized === 'string');
});

test('trace step matches canonical shape from API canon', () => {
  const artifact = prepareDataflow(source);
  const result = executeDataflow(artifact, { state, registries }, { trace: 'basic' });
  const entry = result.trace[0];
  // Must have: kind, artifactType, artifactId, step, at, outcome
  assert.ok('kind' in entry);
  assert.ok('artifactType' in entry);
  assert.ok('artifactId' in entry);
  assert.ok('step' in entry);
  assert.ok('at' in entry);
  assert.ok('outcome' in entry);
});

test('invalid trace modes are rejected', () => {
  const artifact = prepareDataflow(source);
  for (const trace of [false, true, null, 'bad', 1, {}]) {
    assert.throws(
      () => executeDataflow(artifact, { state, registries }, { trace }),
      (err) => err.code === 'DATAFLOW_TRACE_MODE_INVALID',
      `trace=${String(trace)}`,
    );
  }
});
