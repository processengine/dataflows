import { validateDataflowSource } from '../compile/validate.js';

export function validateDataflow(source, options = {}) {
  return validateDataflowSource(source, options);
}
