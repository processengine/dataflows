/**
 * PathRef utilities for @processengine/dataflows
 * PathRef: starts with "$.", e.g. "$.data.facts.x"
 */

const ALLOWED_READ_ROOTS = ['$.input', '$.data'];
const WRITE_ROOT = '$.data.';
const UNSAFE_OBJECT_KEYS = new Set(['__proto__', 'prototype', 'constructor']);

export function isValidPathRef(ref) {
  return typeof ref === 'string' && ref.startsWith('$.') && ref.length > 2;
}

export function isWritablePath(ref) {
  return isValidPathRef(ref) && ref.startsWith(WRITE_ROOT);
}

export function isReadablePath(ref) {
  return isValidPathRef(ref) && (
    ALLOWED_READ_ROOTS.some(root => ref === root || ref.startsWith(`${root}.`))
    || isStepLatestReadablePath(ref)
  );
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
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    if (cur == null || typeof cur !== 'object') return undefined;
    if (i === 2 && segments[0] === 'steps' && seg === 'latest') {
      cur = resolveLatestStepExecution(cur);
      if (cur === undefined) return undefined;
      continue;
    }
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
 * Dataflows v3 has one input contract shape: { refs: Record<InputTargetPath, PathRef> }.
 * The "$" target means "pass the resolved value as the whole child input" and
 * must not be mixed with named targets.
 */
export function getInputRefs(inputContract) {
  return inputContract?.refs;
}

export function inputTargetPathSegments(targetPath) {
  if (targetPath === '$') return [];
  if (typeof targetPath !== 'string' || targetPath.trim() === '') return null;
  const segments = targetPath.split('.');
  if (segments.some(segment => !isSafeObjectKey(segment))) return null;
  return segments;
}

function isSafeObjectKey(segment) {
  return typeof segment === 'string' && segment.trim() !== '' && !UNSAFE_OBJECT_KEYS.has(segment);
}

function isStepLatestReadablePath(ref) {
  const segments = ref.slice(2).split('.');
  if (segments.length < 4) return false;
  if (segments[0] !== 'steps') return false;
  if (!isSafeObjectKey(segments[1])) return false;
  if (segments[2] !== 'latest') return false;
  if (segments[3] !== 'command' && segments[3] !== 'subflow') return false;
  return segments.slice(4).every(isSafeObjectKey);
}

function resolveLatestStepExecution(stepRuntime) {
  if (!stepRuntime || typeof stepRuntime !== 'object') return undefined;
  const executions = Array.isArray(stepRuntime.executions) ? stepRuntime.executions : [];
  if (stepRuntime.latestExecutionId) {
    return executions.find(execution => execution?.executionId === stepRuntime.latestExecutionId);
  }
  return executions.length > 0 ? executions[executions.length - 1] : undefined;
}

export function setInputTargetPath(obj, targetPath, value) {
  const segments = inputTargetPathSegments(targetPath);
  if (!segments) return false;
  if (segments.length === 0) return false;
  let cur = obj;
  for (let i = 0; i < segments.length - 1; i++) {
    const segment = segments[i];
    if (cur[segment] == null || typeof cur[segment] !== 'object' || Array.isArray(cur[segment])) {
      cur[segment] = {};
    }
    cur = cur[segment];
  }
  cur[segments[segments.length - 1]] = value;
  return true;
}
