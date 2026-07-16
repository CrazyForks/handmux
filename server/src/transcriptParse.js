// Pure: a Claude Code jsonl session log (array of lines) → normalized chat messages. No I/O.
// Only user/assistant turns become bubbles; every other top-level `type` (attachment, system, last-prompt,
// mode, permission-mode, ai-title, file-history-snapshot, queue-operation, …) is skipped. tool_use and its
// later tool_result are folded into ONE tool message (paired by tool_use_id); an unmatched tool_result is
// dropped (its tool_use is in an earlier, not-yet-loaded chunk). Bad/blank lines are skipped, never thrown.
const KEEP = new Set(['user', 'assistant']);

function resultText(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) return content.map((c) => (c && c.type === 'text' ? (c.text || '') : '')).join('');
  return '';
}

export function parseTranscript(lines) {
  const msgs = [];
  const byToolId = new Map(); // tool_use_id → the tool message awaiting its result
  let i = 0;
  for (const raw of lines) {
    const s = typeof raw === 'string' ? raw.trim() : '';
    if (!s) { i++; continue; }
    let o;
    try { o = JSON.parse(s); } catch { i++; continue; }
    const m = o && o.message;
    if (!KEEP.has(o && o.type) || !m || typeof m !== 'object') { i++; continue; }
    const role = m.role === 'user' ? 'user' : 'assistant';
    const items = typeof m.content === 'string'
      ? [{ type: 'text', text: m.content }]
      : Array.isArray(m.content) ? m.content : [];
    for (const it of items) {
      if (!it || typeof it !== 'object') continue;
      if (it.type === 'text' && it.text && it.text.trim()) {
        msgs.push({ i, role, type: 'text', text: it.text });
      } else if (it.type === 'thinking' && it.thinking) {
        msgs.push({ i, role: 'assistant', type: 'thinking', text: it.thinking });
      } else if (it.type === 'tool_use') {
        const tm = { i, role: 'assistant', type: 'tool', tool: { name: it.name || '', input: it.input || {}, result: null, isError: false } };
        if (it.id) byToolId.set(it.id, tm);
        msgs.push(tm);
      } else if (it.type === 'tool_result') {
        const tm = it.tool_use_id && byToolId.get(it.tool_use_id);
        if (tm) { tm.tool.result = resultText(it.content); tm.tool.isError = !!it.is_error; }
      }
    }
    i++;
  }
  return msgs;
}
