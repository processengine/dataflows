export function formatDataflowDiagnostics(diagnostics) {
  if (!Array.isArray(diagnostics) || diagnostics.length === 0) return 'No diagnostics';
  return diagnostics.map(d => {
    const parts = [`[${(d.level ?? 'error').toUpperCase()}]`, d.code];
    if (d.path) parts.push(`path=${d.path}`);
    return `${parts.join(' ')} — ${d.message}`;
  }).join('\n');
}

export function formatDataflowRuntimeError(error) {
  if (!error) return '';
  const parts = [error.code ?? 'DATAFLOW_RUNTIME_ERROR', error.message ?? ''];
  if (error.details) parts.push(JSON.stringify(error.details));
  return parts.join(' | ');
}
