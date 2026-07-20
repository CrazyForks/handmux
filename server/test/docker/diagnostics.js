function sanitize(value) {
  return String(value ?? '')
    .replace(/\r\n?/g, '\n')
    .replace(/[^\t\n\x20-\x7e\u{a0}-\u{10ffff}]/gu, '?');
}

export function formatDockerFailure(error) {
  const exit = error?.code ?? 'unknown';
  const signal = error?.signal ?? 'none';
  const stdout = sanitize(error?.stdout) || '<empty>';
  const stderr = sanitize(error?.stderr) || '<empty>';
  return [
    `workspace recovery Docker failed (exit: ${exit}, signal: ${signal})`,
    'stdout:', stdout,
    'stderr:', stderr,
  ].join('\n');
}
