export class DataflowCompileError extends Error {
  constructor(diagnostics, message) {
    const lines = (Array.isArray(diagnostics) ? diagnostics : [])
      .map((d, i) => `  ${i + 1}. [${d.level?.toUpperCase() ?? 'ERROR'}] ${d.code} — ${d.message}`)
      .join('\n');
    super(message ?? `Dataflow preparation failed with ${(diagnostics ?? []).length} diagnostic(s).${lines ? '\n' + lines : ''}`);
    this.name = 'DataflowCompileError';
    this.code = 'DATAFLOW_COMPILE_ERROR';
    this.diagnostics = Object.freeze(Array.isArray(diagnostics) ? diagnostics.map(d => Object.freeze({ ...d })) : []);
  }
}
