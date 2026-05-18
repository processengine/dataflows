# Compatibility — @processengine/dataflows

## Node.js

Minimum supported: **20.19.0**

## Public contract

The following constitute the public contract of v2:

- Public API names and signatures (`validateDataflow`, `prepareDataflow`, `executeDataflow`, `extractDataflowSchema`, formatters, error classes)
- `DataflowSource` format
- `DataflowSource.pipeline[].contract.input.refs` format, including direct `$` and named compact input targets
- Public `DataflowArtifact` shape (`artifactType`, `id`, `version`, `schema`, `readSet`, `writeSet`, `items[].id/type/artefactId/contract/kind`)
- `DataflowOutput` shape (`writes`, `trace?`)
- `DataflowWrite` shape (`ref`, `value`, `itemId`)
- Diagnostic codes
- Runtime error codes
- Trace shape per mode (`basic`, `verbose`)
- Transport-safe / JSON-safe guarantees
- Read-after-write semantics
- Write atomicity semantics

## Compatibility violations include

- Removing or renaming public API functions
- Changing required fields in `DataflowSource`
- Reintroducing or accepting `DataflowSource.pipeline[].contract.input.ref`
- Changing `DataflowOutput` or `DataflowWrite` shape
- Weakening transport-safe guarantees
- Changing `basic` trace shape incompatibly
- Removing diagnostic or error codes

## Internal (not public contract)

- Concrete internal cache structures
- Internal optimization strategies in prepared artifact
- Specific JSON copy strategy (observable behavior is public, not implementation)
