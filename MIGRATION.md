# Migration — @processengine/dataflows

## From Flow 3 PROCESS/MAPPINGS + PROCESS/DECISIONS chains to PROCESS/DATA + dataflow artifact

`@processengine/dataflows` v1 is part of the Flow 5 hard breaking model.
Existing Flow 3 artifacts are not auto-migrated. Flow 5 processes are rewritten.

### Rewrite path

```
PROCESS/MAPPINGS / PROCESS/RULES / PROCESS/DECISIONS chains
  → PROCESS/DATA + dataflow artifact

context.facts.*      → context.data.facts.*
context.decisions.*  → context.data.decisions.*
context.checks.*     → context.data.checks.*
result mappings      → context.data.results.*
payload-like refs    → context.data.payloads.*
```

### Mapping artifacts

Must be updated to `@processengine/mappings` v3 with required `kind` field.

### No runtime migration

Flow 3 process artifacts remain on Flow 3 libraries.
Flow 5 processes are written from scratch against the new model.
