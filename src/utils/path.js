/**
 * PathRef utilities for @processengine/dataflows
 * PathRef: starts with "$.", e.g. "$.context.data.facts.x"
 */

const ALLOWED_READ_ROOTS = ['$.context.input.', '$.context.effects.', '$.context.data.'];
const WRITE_ROOT = '$.context.data.';

export function isValidPathRef(ref) {
  return typeof ref === 'string' && ref.startsWith('$.') && ref.length > 2;
}

export function isWritablePath(ref) {
  return isValidPathRef(ref) && ref.startsWith(WRITE_ROOT);
}

export function isReadablePath(ref) {
  return isValidPathRef(ref) && ALLOWED_READ_ROOTS.some(root => ref.startsWith(root));
}

export function isSchemaKey(ref) {
  return isValidPathRef(ref) && ref.startsWith(WRITE_ROOT);
}

/**
 * Returns true if `a` is a prefix of `b` or vice versa (parent/child conflict).
 * e.g. "$.a.b" and "$.a.b.c" conflict.
 */
export function pathsConflict(a, b) {
  if (a === b) return true;
  const shorter = a.length < b.length ? a : b;
  const longer = a.length < b.length ? b : a;
  return longer.startsWith(shorter + '.');
}

export function getByPath(obj, ref) {
  if (!isValidPathRef(ref)) return undefined;
  const segments = ref.slice(2).split('.');
  let cur = obj;
  for (const seg of segments) {
    if (cur == null || typeof cur !== 'object') return undefined;
    cur = cur[seg];
  }
  return cur;
}

export function setByPath(obj, ref, value) {
  const clone = JSON.parse(JSON.stringify(obj));
  const segments = ref.slice(2).split('.');
  let cur = clone;
  for (let i = 0; i < segments.length - 1; i++) {
    const seg = segments[i];
    if (cur[seg] == null || typeof cur[seg] !== 'object') cur[seg] = {};
    cur = cur[seg];
  }
  cur[segments[segments.length - 1]] = value;
  return clone;
}

/**
 * Dataflows v1 has one input contract shape: { ref: PathRef }.
 * Multiple-source assembly belongs outside this library version.
 */
export function getInputRef(inputContract) {
  return inputContract?.ref;
}
