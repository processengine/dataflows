import { executeDataflowArtifact } from '../runtime/execute.js';

export function executeDataflow(artifact, input, options = {}) {
  return executeDataflowArtifact(artifact, input, options);
}
