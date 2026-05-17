export class DataflowRuntimeError extends Error {
  constructor({ code = 'DATAFLOW_RUNTIME_ERROR', message = 'Dataflow execution failed', details, cause } = {}) {
    super(message, { cause });
    this.name = 'DataflowRuntimeError';
    this.code = code;
    this.details = details ?? null;
    this.cause = cause;
  }
}
