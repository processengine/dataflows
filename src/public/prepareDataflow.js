import { prepareDataflowArtifact } from '../compile/prepare.js';

export function prepareDataflow(source, options = {}) {
  return prepareDataflowArtifact(source, options);
}
