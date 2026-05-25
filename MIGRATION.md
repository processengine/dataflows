# Migration — @processengine/dataflows

## From Flow 3 PROCESS/MAPPINGS + PROCESS/DECISIONS chains to PROCESS/DATA + dataflow artifact

`@processengine/dataflows` v3 is part of the Flow 5 hard breaking model.
Existing Flow 3 artifacts are not auto-migrated. Flow 5 processes are rewritten.

### Rewrite path

```
PROCESS/MAPPINGS / PROCESS/RULES / PROCESS/DECISIONS chains
  → PROCESS/DATA + dataflow artifact

facts.*      → data.facts.*
decisions.*  → data.decisions.*
checks.*     → data.checks.*
result mappings      → data.results.*
payload-like refs    → data.payloads.*
```

### Dataflow input contract

Flow 5 dataflow items use only `contract.input.refs`; the old single `contract.input.ref` shape is not supported.

Direct single-value input:

```js
contract: {
  input: { refs: { '$': '$.input.application' } },
  output: { ref: '$.data.facts.application' }
}
```

Composite compact input:

```js
contract: {
  input: {
    refs: {
      payload: '$.input.application',
      'request.currentDate': '$.input.currentDate',
      addressCheck: '$.steps.address.latest.command.result'
    }
  },
  output: { ref: '$.data.payloads.applicationCheck' }
}
```

The `$` target means “pass the resolved value as the whole child input” and must not be mixed with named targets.

### Mapping artifacts

Must be updated to `@processengine/mappings` v3 with required `kind` field.

### No runtime migration

Flow 3 process artifacts remain on Flow 3 libraries.
Flow 5 processes are written from scratch against the new model.
