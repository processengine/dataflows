/**
 * Tests using real artifacts from fl-resident.registration processor.
 * These mirror real-world usage and serve as integration/interop tests.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateDataflow, prepareDataflow, executeDataflow, DataflowRuntimeError } from '../dist/index.js';


function schemaField(type, title = 'Schema field', description = 'Human-readable schema field documentation.') {
  return { type, title, description };
}

function schemaNode(title = 'Data object', fields = {}, description = 'Human-readable data object documentation.') {
  return { title, description, fields };
}

// Dataflow wrapping mappings → decisions (realistic minimal scenario)
const findClientDataflow = {
  id: 'dataflow.fl_resident.find_client_evaluate',
  version: '1.0.0',
  title: 'Оценка результата поиска клиента',
  schema: {
    '$.context.data.facts.clientCandidates': { title: 'Факты по кандидатам клиента', description: 'Факты по кандидатам клиента data object.', fields: {
        hasMatches: schemaField('boolean'),
        clientMatchCount: schemaField('number'),
        hasMultipleClientCandidates: schemaField('boolean'),
        hasOwnServiceClient: schemaField('boolean'),
        resultStatus: schemaField('string'),
      },
    },
    '$.context.data.decisions.findClientScenario': { title: 'Решение по поиску клиента', description: 'Решение по поиску клиента data object.', fields: { outcome: schemaField('string'), reason: schemaField('string') },
    },
  },
  pipeline: [
    {
      id: 'derive_client_candidates_facts',
      type: 'MAPPINGS',
      kind: 'facts',
      artefactId: 'mappings.fl_resident.client_candidates_facts',
      contract: {
        input: { ref: '$.context.effects.find_client.waitResult.result' },
        output: { ref: '$.context.data.facts.clientCandidates' },
      },
    },
    {
      id: 'choose_find_client_scenario',
      type: 'DECISIONS',
      artefactId: 'decisions.fl_resident.find_client_scenario',
      contract: {
        input: { ref: '$.context.data.facts.clientCandidates' },
        output: { ref: '$.context.data.decisions.findClientScenario' },
      },
    },
  ],
};

// State mimicking a real process state after find_client EFFECT returned
const makeRealState = (findClientResult) => ({
  processId: 'test-process-001',
  id: 'fl-resident.registration',
  version: '1.0.0',
  status: 'ACTIVE',
  context: {
    input: { applicantId: 'APP-001' },
    effects: {
      find_client: {
        requestId: 'REQ-001',
        waitResult: { result: findClientResult },
      },
    },
    data: {},
  },
});

test('real dataflow: validates without errors', () => {
  const result = validateDataflow(findClientDataflow);
  assert.equal(result.ok, true, `Unexpected diagnostics: ${JSON.stringify(result.diagnostics)}`);
});

test('real dataflow: prepares correctly', () => {
  const artifact = prepareDataflow(findClientDataflow);
  assert.equal(artifact.artifactType, 'dataflow');
  assert.equal(artifact.items.length, 2);
  assert.equal(artifact.readSet[0], '$.context.effects.find_client.waitResult.result');
  assert.ok(artifact.writeSet.includes('$.context.data.facts.clientCandidates'));
  assert.ok(artifact.writeSet.includes('$.context.data.decisions.findClientScenario'));
});

test('real dataflow: executes — found one own-service client → FOUND_OWN_SERVICE', () => {
  const artifact = prepareDataflow(findClientDataflow);

  const findClientResult = {
    resultStatus: 'SUCCESS',
    clients: [{ id: 'CL-001', createSrc: 'NOMINAL_BENEFICIARY_SERVICE' }],
  };

  // Stub registries that replicate real mappings/decisions logic
  const registries = {
    mappings: {
      get: (id) => ({ id }),
      executeMappings: (art, input) => ({ output: {
        resultStatus: input.resultStatus,
        hasMatches: input.clients?.length > 0,
        clientMatchCount: input.clients?.length ?? 0,
        hasMultipleClientCandidates: (input.clients?.length ?? 0) >= 2,
        hasOwnServiceClient: input.clients?.some(c => c.createSrc === 'NOMINAL_BENEFICIARY_SERVICE') ?? false,
        firstClientCandidate: input.clients?.[0] ?? null,
      } }),
    },
    decisions: {
      get: (id) => ({ id }),
      evaluateDecisions: (art, facts) => {
        if (facts.hasOwnServiceClient && facts.clientMatchCount === 1) {
          return { output: { outcome: 'FOUND_OWN_SERVICE', reason: 'OWN_FL_RESIDENT_CLIENT_FOUND' } };
        }
        return { output: { outcome: 'TECHNICAL_ERROR', reason: 'DEFAULT' } };
      },
    },
  };

  const result = executeDataflow(artifact, { state: makeRealState(findClientResult), registries });

  assert.equal(result.writes.length, 2);

  const factsWrite = result.writes.find(w => w.ref === '$.context.data.facts.clientCandidates');
  assert.ok(factsWrite);
  assert.equal(factsWrite.value.hasOwnServiceClient, true);
  assert.equal(factsWrite.value.clientMatchCount, 1);

  const decisionWrite = result.writes.find(w => w.ref === '$.context.data.decisions.findClientScenario');
  assert.ok(decisionWrite);
  assert.equal(decisionWrite.value.outcome, 'FOUND_OWN_SERVICE');
});

test('real dataflow: executes — no clients found → NOT_FOUND', () => {
  const artifact = prepareDataflow(findClientDataflow);

  const findClientResult = { resultStatus: 'SUCCESS', clients: [] };

  const registries = {
    mappings: {
      get: (id) => ({ id }),
      executeMappings: (art, input) => ({ output: {
        resultStatus: input.resultStatus,
        hasMatches: input.clients?.length > 0,
        clientMatchCount: 0,
        hasMultipleClientCandidates: false,
        hasOwnServiceClient: false,
        firstClientCandidate: null,
      } }),
    },
    decisions: {
      get: (id) => ({ id }),
      evaluateDecisions: (art, facts) => {
        if (!facts.hasMatches) return { output: { outcome: 'NOT_FOUND', reason: 'ABS_NOT_FOUND_EMPTY' } };
        return { output: { outcome: 'TECHNICAL_ERROR', reason: 'DEFAULT' } };
      },
    },
  };

  const result = executeDataflow(artifact, { state: makeRealState(findClientResult), registries });
  const decisionWrite = result.writes.find(w => w.ref === '$.context.data.decisions.findClientScenario');
  assert.equal(decisionWrite.value.outcome, 'NOT_FOUND');
});

test('real dataflow: read-after-write — decisions item receives facts item output', () => {
  const artifact = prepareDataflow(findClientDataflow);

  const capturedInputs = [];
  const registries = {
    mappings: {
      get: (id) => ({ id }),
      executeMappings: () => ({ output: { hasMatches: true, clientMatchCount: 1, hasOwnServiceClient: false, resultStatus: 'SUCCESS' } }),
    },
    decisions: {
      get: (id) => ({ id }),
      evaluateDecisions: (art, input) => {
        capturedInputs.push(input);
        return { output: { outcome: 'SELECTED_CLIENT', reason: 'ABS_CLIENT_SELECTED_FOR_CLASSIFICATION' } };
      },
    },
  };

  executeDataflow(artifact, {
    state: makeRealState({ resultStatus: 'SUCCESS', clients: [{ id: 'CL-001', createSrc: 'EXTERNAL' }] }),
    registries,
  });

  assert.equal(capturedInputs.length, 1);
  // Decisions received the facts written by mappings — not the original state
  assert.equal(capturedInputs[0].hasMatches, true, 'decisions item received facts from mappings via read-after-write');
});

test('real dataflow: DataflowOutput survives JSON serialization → semantics.reduce compatible', () => {
  const artifact = prepareDataflow(findClientDataflow);
  const result = executeDataflow(artifact, {
    state: makeRealState({ resultStatus: 'SUCCESS', clients: [] }),
    registries: {
      mappings: { get: (id) => ({ id }), executeMappings: () => ({ output: { hasMatches: false, clientMatchCount: 0 } }) },
      decisions: { get: (id) => ({ id }), evaluateDecisions: () => ({ output: { outcome: 'NOT_FOUND', reason: 'X' } }) },
    },
  });

  // Simulate passing through network/persistence before semantics.reduce
  const serialized = JSON.stringify(result);
  const restored = JSON.parse(serialized);

  assert.equal(restored.writes.length, 2);
  assert.equal(restored.writes[0].ref, '$.context.data.facts.clientCandidates');
  assert.equal(restored.writes[1].ref, '$.context.data.decisions.findClientScenario');
  // No host cleanup needed — transport-safe by contract
});
