# Changelog

All notable changes to `@processengine/dataflows` are documented here.

## [Unreleased]

## [3.0.0] — 2026-05-25

### Changed

- Moved Flow 5 dataflow refs to State v2 roots.
- `contract.output.ref` and schema keys now must be under `$.data.*`.
- `contract.input.refs` may read `$.input`, `$.data`, and canonical post-WAIT bridge paths `$.steps.<effectStepId>.latest.command|subflow.*`.
- Examples, tests, docs, and pack smoke now use State v2 paths.

### Removed

- Removed support for `$.context.data.*`, `$.context.input.*`, and `$.context.effects.*` refs.
- Removed whole-bucket `$.steps` reads; DATA may read only canonical `latest.command|subflow` bridge paths from step executions.

## [2.0.0] — 2026-05-18

### Changed

- Replaced the pipeline input contract with `contract.input.refs`.
- Added direct `$` target semantics for single-value child input.
- Added named and nested target semantics for compact child input assembly.
- `readSet` now derives every declared input ref from `contract.input.refs`.
- Read refs may target `$.input`, `$.steps`, `$.data`, or nested paths under those buckets.

### Removed

- Removed support for legacy `contract.input.ref`.

## [1.0.0] — 2026-05-17

### Added

- Initial release of `@processengine/dataflows` v1.
- `validateDataflow(source, options?)` — validates source artifact without execution.
- `prepareDataflow(source, options?)` — compiles source to immutable `DataflowArtifact`.
- `executeDataflow(artifact, input, options?)` — executes prepared artifact, returns `DataflowOutput.writes[]`.
- `extractDataflowSchema(source)` — extracts schema from source.
- `formatDataflowDiagnostics(diagnostics)` — formats diagnostics for CLI/logs.
- `formatDataflowRuntimeError(error)` — formats runtime error for CLI/logs.
- `DataflowCompileError` — thrown by `prepareDataflow` on invalid source.
- `DataflowRuntimeError` — thrown by `executeDataflow` on runtime failure.
- Inline `schema` and `schemaRef` support.
- `readSet` / `writeSet` derivation in prepared artifact.
- Read-after-write semantics within pipeline.
- Atomic writes — no partial result on failure.
- Trace modes: `'off'` (default), `'basic'`, `'verbose'`.
- Transport-safe `DataflowOutput` — JSON-safe, no host cleanup required before `semantics.reduce`.
- Pack/install smoke test via `npm run test:pack`.
- CI workflow for Node.js 20 and 22.
- Release workflow via tag push → npm publish + GitHub Release.
