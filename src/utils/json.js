/**
 * JSON-safe utilities — cycle-safe via WeakSet
 */
export function isJsonSafe(value, stack = new WeakSet()) {
  if (value === null) return true;
  const kind = typeof value;
  if (kind === 'string' || kind === 'boolean') return true;
  if (kind === 'number') return Number.isFinite(value);
  if (kind === 'undefined' || kind === 'function' || kind === 'symbol' || kind === 'bigint') return false;
  if (value instanceof Date || value instanceof Map || value instanceof Set) return false;
  if (Array.isArray(value)) {
    if (stack.has(value)) return false;
    stack.add(value);
    const ok = value.every(v => isJsonSafe(v, stack));
    stack.delete(value);
    return ok;
  }
  if (typeof value !== 'object') return false;
  if (stack.has(value)) return false;
  stack.add(value);
  const ok = Object.values(value).every(v => isJsonSafe(v, stack));
  stack.delete(value);
  return ok;
}

export function jsonSafeCopy(value) {
  return JSON.parse(JSON.stringify(value));
}
