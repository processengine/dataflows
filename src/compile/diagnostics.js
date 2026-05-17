export function makeDiagnostic({ code, level = 'error', message, path, details }) {
  const d = { code, level, message };
  if (path != null) d.path = path;
  if (details != null) d.details = details;
  return Object.freeze(d);
}

export function hasErrors(diagnostics) {
  return diagnostics.some(d => d.level === 'error');
}
