const Q_ESCAPED = new Set([
  '|', '&', ';', '<', '>', '(', ')', '$', '`', '\\', '"', "'", '*', '?', '[', '#', ' ', '=', '%',
]);

export function tmuxFormat(fields) {
  if (!Array.isArray(fields) || fields.length === 0) throw new Error('tmux format fields are required');
  return fields.map((field) => {
    if (typeof field !== 'string' || !/^@?[A-Za-z0-9_]+$/.test(field)) {
      throw new Error(`invalid tmux format field: ${String(field)}`);
    }
    return `#{q:${field}}`;
  }).join('|');
}

export function parseTmuxFields(line, columns, label = 'tmux') {
  const value = String(line);
  const fields = [];
  let field = '';
  for (let i = 0; i < value.length; i++) {
    const char = value[i];
    if (char === '|') {
      fields.push(field);
      field = '';
      continue;
    }
    if (char !== '\\') {
      field += char;
      continue;
    }
    if (i + 1 >= value.length) throw new Error(`invalid ${label} format: dangling escape`);
    const escaped = value[++i];
    if (!Q_ESCAPED.has(escaped)) throw new Error(`invalid ${label} format: unsupported escape`);
    field += escaped;
  }
  fields.push(field);
  if (fields.length !== columns) throw new Error(`invalid ${label} format: expected ${columns} fields`);
  return fields;
}

export function parseTmuxRows(output, columns, label = 'tmux') {
  const value = String(output ?? '');
  if (value === '' || value === '\n' || value === '\r\n') return [];
  return value.replace(/\r?\n$/, '').split(/\r?\n/)
    .map((line) => parseTmuxFields(line, columns, label));
}
