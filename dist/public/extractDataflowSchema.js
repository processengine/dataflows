import { DataflowCompileError } from '../errors/DataflowCompileError.js';

export function extractDataflowSchema(source, options = {}) {
  const hasContrib = source?.schema !== undefined;
  const hasRef = source?.schemaRef !== undefined;
  if (hasContrib && hasRef) {
    throw new DataflowCompileError([{
      code: 'DATAFLOW_SCHEMA_AMBIGUOUS',
      level: 'error',
      message: 'Exactly one of schema or schemaRef must be present, not both',
      path: 'schema'
    }]);
  }
  if (hasContrib) return source.schema;
  if (hasRef) {
    const registry = options.schemaRegistry;
    if (!registry?.get) {
      throw new DataflowCompileError([{
        code: 'DATAFLOW_SCHEMA_REF_NOT_FOUND',
        level: 'error',
        message: `schemaRef "${source.schemaRef}" cannot be resolved: no schemaRegistry provided`,
        path: 'schemaRef',
        details: { schemaRef: source.schemaRef },
      }]);
    }
    const schemaArtifact = registry.get(source.schemaRef);
    if (!schemaArtifact) {
      throw new DataflowCompileError([{
        code: 'DATAFLOW_SCHEMA_REF_NOT_FOUND',
        level: 'error',
        message: `Schema artifact not found: ${source.schemaRef}`,
        path: 'schemaRef',
        details: { schemaRef: source.schemaRef },
      }]);
    }
    return schemaArtifact.schema;
  }
  throw new DataflowCompileError([{
    code: 'DATAFLOW_SCHEMA_MISSING',
    level: 'error',
    message: 'Either schema or schemaRef must be present'
  }]);
}
