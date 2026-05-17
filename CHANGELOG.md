# Changelog

All notable changes to `@processengine/dataflows` are documented here.

## [Unreleased]

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
- Trace modes: `false` (default), `'basic'`, `'verbose'`.
- Transport-safe `DataflowOutput` — JSON-safe, no host cleanup required before `semantics.reduce`.
- Pack/install smoke test via `npm run test:pack`.
- CI workflow for Node.js 20 and 22.
- Release workflow via tag push → npm publish + GitHub Release.
