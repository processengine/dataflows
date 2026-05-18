# @processengine/dataflows

Runtime for **dataflow artifacts** in ProcessEngine Flow 5.

`@processengine/dataflows` validates, prepares and executes linear dataflow artifacts composed of MAPPINGS, RULES and DECISIONS pipeline items. It is the runtime for `PROCESS/DATA` steps in Flow 5.

## Role in ProcessEngine

```
PROCESS/DATA (flow graph step)
  → processor runtime calls executeDataflow(...)
  → @processengine/dataflows executes dataflow artifact
  → returns DataflowOutput.writes[]
  → @processengine/semantics.reduce applies writes to process state
```

## Install

```sh
npm install @processengine/dataflows
```

## Quick start

```js
import { validateDataflow, prepareDataflow, executeDataflow } from '@processengine/dataflows';

// 1. Validate
const source = {
  id: 'dataflow.example',
  version: '1.0.0',
  schema: {
    '$.context.data.facts.result': {
      title: 'Result facts',
      description: 'Facts produced from the input application for the quick start example.',
      fields: {
        ok: {
          type: 'boolean',
          title: 'Input is acceptable',
          description: 'true when the application payload can continue through the example dataflow.'
        }
      }
    }
  },
  pipeline: [{
    id: 'map_input',
    type: 'MAPPINGS',
    kind: 'facts',
    artefactId: 'mappings.example',
    contract: {
      input: { refs: { '$': '$.context.input.application' } },
      output: { ref: '$.context.data.facts.result' }
    }
  }]
};

const validation = validateDataflow(source);
if (!validation.ok) throw new Error('Invalid');

// 2. Prepare (once, cache the result)
const artifact = prepareDataflow(source);

// 3. Execute
const state = { context: { input: { application: { ok: true } }, data: {} } };
const registries = {
  mappings: {
    get: (id) => ({ id }),
    executeMappings: (_artifact, input) => ({ output: { ok: input.ok } })
  }
};
const result = executeDataflow(artifact, { state, registries });
// result.writes[] — transport-safe, pass directly to semantics.reduce
```


## Design rule

The package is designed from the public contract inward:

- one normative source shape, not several accepted aliases;
- one runtime result contract from neighbour libraries: `{ output, trace? }`;
- child runtime `trace`, if returned, is accepted but not merged into dataflow trace;
- no hidden compatibility branches for malformed legacy artifacts;
- no hidden fallback behavior for malformed artifacts;
- validation rejects unsupported fields instead of interpreting them leniently;
- runtime failure trace is observable in `DataflowRuntimeError.details.trace` when trace is enabled.

Every pipeline item has exactly one input contract: `input.refs`.

```js
contract: {
  input: { refs: { '$': '$.context.data.payloads.clientComparison' } },
  output: { ref: '$.context.data.facts.clientComparison' }
}
```

The special `$` target passes the resolved state value as the whole child input. Named targets assemble a compact object for the child runtime:

```js
contract: {
  input: {
    refs: {
      payload: '$.context.input.application',
      'context.currentDate': '$.context.input.currentDate',
      effects: '$.context.effects'
    }
  },
  output: { ref: '$.context.data.payloads.clientComparison' }
}
```

The `$` target cannot be mixed with named targets. Read refs may point to `$.context.input`, `$.context.effects`, `$.context.data`, or nested paths under those buckets.

Schema nodes and fields are part of the human-readable contract. Each schema node and each declared field must have both `title` and `description`. This keeps dataflow artifacts usable as code-as-docs and makes the data contract readable in Flow UI, reviews, and business-requirement traceability.

## Lifecycle

```
validateDataflow(source, options?)  → ValidationResult
prepareDataflow(source, options?)   → DataflowArtifact
executeDataflow(artifact, input, options?) → DataflowOutput
```

## Non-goals

`@processengine/dataflows` does not know the flow graph, does not move `currentStepId`, does not persist state, and does not own retry/fail policy.

## Examples

The `examples/` directory contains normative examples:

- `happy-path.json` — minimal valid dataflow artifact;
- `failing-path-missing-input.json` — valid artifact that demonstrates runtime missing-input behavior;
- `interop-read-after-write.json` — MAPPINGS → DECISIONS read-after-write interop.

## Documentation

See `SPEC_RU.md` for full normative specification.
See `COMPATIBILITY.md` for compatibility guarantees.
See `MIGRATION.md` for migration from Flow 3.
