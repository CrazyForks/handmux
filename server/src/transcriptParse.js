// Pure: a Claude Code jsonl session log (array of lines) → normalized chat messages. No I/O.
// Only user/assistant turns become bubbles; every other top-level `type` (attachment, system, last-prompt,
// mode, permission-mode, ai-title, file-history-snapshot, queue-operation, …) is skipped. tool_use and its
// later tool_result are folded into ONE tool message (paired by tool_use_id); an unmatched tool_result is
// dropped (its tool_use is in an earlier, not-yet-loaded chunk). Bad/blank lines are skipped, never thrown.
//
// Meta scaffolding is DROPPED so the 对话 lens shows only real turns; the reliable signal is the top-level
// boolean flags — `isMeta` (skill/workflow injections, "Base directory for this skill…", caveats) and
// `isCompactSummary` (the "session is being continued…" wall) — NOT text matching.
//
// Slash commands (`/compact`, `/model`, `/clear`, …) are NOT dropped — they surface as a quiet 'slash'
// marker (a centered system row), because a command the user ran IS part of the conversation and hiding it
// leaves the phone with no feedback. Claude Code logs each as a `<command-name>/x</command-name>` USER turn
// (the canonical form; the bare "/x" input is a separate queue-operation / plain user line we still drop, to
// avoid a double). The command's `<local-command-stdout>` echo is folded onto the preceding marker as its
// `.result` (ANSI-stripped, capped) — and its PRESENCE means the command COMPLETED. An interactive picker
// (bare `/model`, `/plugin`, …) still open in the terminal has written no result yet, which is exactly how
// the UI tells a finished command from one that needs the user to drop to the terminal lens and pick.
// Matching is a tag prefix ANCHORED at the start of a USER turn's text: an assistant reply that merely
// mentions `<command-name>` in prose (e.g. discussing this very code) must NOT be caught.
const KEEP = new Set(['user', 'assistant']);
const SCAFFOLD_RE = /^\s*<(?:command-name|command-message|command-args|local-command-stdout|local-command-caveat|bash-input|bash-stdout|bash-stderr)>/;
// Besides the <command-name> scaffold form, Claude Code ALSO logs the raw slash-command input as a plain,
// flagless user turn (content exactly "/compact", "/model sonnet", …) — redundant with the scaffold marker,
// and after a /compact it's the LAST turn, so leaving it in would make the 对话 lens read a trailing user
// bubble and light the "reply coming" typing wave forever. Drop it — anchored to a single leading /command
// token followed by whitespace/EOL, so a path-like message ("/Users/demo/foo.js …") or prose is NOT eaten.
const SLASH_CMD_RE = /^\s*\/[a-z][\w-]*(?:\s|$)/i;
// The canonical scaffold form of a slash command: capture the name and any args, so the marker can tell a
// bare `/model` (may open a picker) from `/model sonnet` (applies directly). The stdout echo is a separate
// user turn right after; its inner text (closing tag stripped, ANSI stripped, capped) becomes the result.
const CMD_NAME_RE = /^\s*<command-name>\s*\/?([\w-]+)\s*<\/command-name>/i;
const CMD_ARGS_RE = /<command-args>([\s\S]*?)<\/command-args>/i;
const STDOUT_RE = /^\s*<local-command-stdout>([\s\S]*)$/i;
const ANSI_RE = /\x1b\[[0-9;?]*[ -/]*[@-~]/g;
const SLASH_RESULT_CAP = 140;
const stripAnsi = (s) => (typeof s === 'string' ? s.replace(ANSI_RE, '') : '');

// A file-edit diff from a jsonl line's top-level `toolUseResult`, or null if the tool didn't edit a file.
// Non-empty structuredPatch → count +/- lines and keep the hunks (for the expandable coloured view). Empty
// patch but a create → every content line is an addition. Anything else (Bash/Read/…) → null.
function extractDiff(r) {
  if (!r || typeof r !== 'object') return null;
  const patch = Array.isArray(r.structuredPatch) ? r.structuredPatch : null;
  if (patch && patch.length) {
    let added = 0, removed = 0;
    const hunks = [];
    for (const h of patch) {
      const lines = Array.isArray(h.lines) ? h.lines : [];
      for (const ln of lines) { const c = typeof ln === 'string' ? ln[0] : ''; if (c === '+') added++; else if (c === '-') removed++; }
      hunks.push({ oldStart: h.oldStart, newStart: h.newStart, lines });
    }
    return { added, removed, hunks };
  }
  if (r.type === 'create' && typeof r.content === 'string') {
    return { added: r.content ? r.content.split('\n').length : 0, removed: 0, hunks: null, created: true };
  }
  return null;
}

function resultText(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) return content.map((c) => (c && c.type === 'text' ? (c.text || '') : '')).join('');
  return '';
}

// Leading text of a message's content (string as-is, or the first text item of an array) — used only to
// probe for a scaffolding tag at the very start. tool_result-only user turns yield '' and are never matched.
function leadingText(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    const t = content.find((c) => c && c.type === 'text');
    return t ? (t.text || '') : '';
  }
  return '';
}

// Stateful form used by the transcript route's append-only file cache. `push()` may be called with
// successive complete JSONL batches: tool results and slash-command stdout in a later batch can still
// update the tool/slash message created by an earlier batch. The one-shot `parseTranscript()` wrapper
// below preserves the public pure-function API used everywhere else.
export function createTranscriptParser() {
  const msgs = [];
  const byToolId = new Map(); // tool_use_id → the tool message awaiting its result
  let i = 0;
  function push(lines) {
    for (const raw of lines) {
    const s = typeof raw === 'string' ? raw.trim() : '';
    if (!s) { i++; continue; }
    let o;
    try { o = JSON.parse(s); } catch { i++; continue; }
    const m = o && o.message;
    if (!KEEP.has(o && o.type) || !m || typeof m !== 'object') { i++; continue; }
    if (o.isMeta === true) { i++; continue; }
    // A compaction wall (isCompactSummary): don't render the (huge) summary text as a bubble, but DO leave a
    // quiet divider marker where it happened, so the 对话 lens shows "上下文已压缩" between the old and new
    // context instead of the conversation silently jumping. (A no-op /compact writes no such entry → no
    // divider, correctly.) Rendered centered like the interrupt marker.
    if (o.isCompactSummary === true) {
      msgs.push({ i, type: 'compact', ts: typeof o.timestamp === 'string' ? o.timestamp : undefined });
      i++; continue;
    }
    // The jsonl line's wall-clock (ISO string) — carried onto each message so the 对话 lens can show a
    // time separator between turns. Absent on some lines (older logs) → undefined; the UI shows nothing
    // rather than a fabricated time ("有地方取就要，没有就不要").
    const ts = typeof o.timestamp === 'string' ? o.timestamp : undefined;
    const role = m.role === 'user' ? 'user' : 'assistant';
    if (role === 'user') {
      const lead = leadingText(m.content);
      // A slash command → a quiet centered 'slash' marker (see the header note). Name + optional args.
      const nameM = CMD_NAME_RE.exec(lead);
      if (nameM) {
        const argsM = CMD_ARGS_RE.exec(lead);
        const args = argsM ? argsM[1].trim() : '';
        const mk = { i, type: 'slash', name: '/' + nameM[1], ts };
        if (args) mk.args = args;
        msgs.push(mk);
        i++; continue;
      }
      // Its stdout echo → fold onto the marker just pushed as `.result` (presence ⇒ the command completed).
      const outM = STDOUT_RE.exec(lead);
      if (outM) {
        const last = msgs[msgs.length - 1];
        if (last && last.type === 'slash' && last.result === undefined) {
          const txt = stripAnsi(outM[1].replace(/<\/local-command-stdout>\s*$/i, '')).trim();
          if (txt) last.result = txt.length > SLASH_RESULT_CAP ? txt.slice(0, SLASH_RESULT_CAP) + '…' : txt;
        }
        i++; continue;
      }
      // Other scaffolding (<command-message>, caveat, bash-*) and the bare "/x" input line: still dropped.
      if (SCAFFOLD_RE.test(lead) || SLASH_CMD_RE.test(lead)) { i++; continue; }
    }
    // ESC-interrupt: Claude Code appends a standalone user line carrying a top-level `interruptedMessageId`
    // (content is just "[Request interrupted by user…]"). It's NOT something the user typed — surface it as a
    // quiet 'interrupt' marker (rendered as a small centered hint), never as a prominent user bubble. Detect
    // by the structural field, falling back to the marker text for older logs.
    if (typeof o.interruptedMessageId === 'string' || (role === 'user' && /^\[Request interrupted by user/.test(leadingText(m.content)))) {
      msgs.push({ i, type: 'interrupt', ts });
      i++; continue;
    }
    const items = typeof m.content === 'string'
      ? [{ type: 'text', text: m.content }]
      : Array.isArray(m.content) ? m.content : [];
    for (const it of items) {
      if (!it || typeof it !== 'object') continue;
      // .trim() here is a truthiness guard only (dropping whitespace-only text items to avoid empty
      // bubbles) — the pushed `it.text` below is the untrimmed original, so real text's internal/
      // leading/trailing whitespace is preserved verbatim.
      if (it.type === 'text' && it.text && it.text.trim()) {
        msgs.push({ i, role, type: 'text', text: it.text, ts });
      } else if (it.type === 'thinking' && it.thinking) {
        msgs.push({ i, role: 'assistant', type: 'thinking', text: it.thinking, ts });
      } else if (it.type === 'tool_use') {
        const tm = { i, role: 'assistant', type: 'tool', ts, tool: { name: it.name || '', input: it.input || {}, result: null, isError: false } };
        if (it.id) byToolId.set(it.id, tm);
        msgs.push(tm);
      } else if (it.type === 'tool_result') {
        const tm = it.tool_use_id && byToolId.get(it.tool_use_id);
        if (tm) {
          tm.tool.result = resultText(it.content);
          tm.tool.isError = !!it.is_error;
          // Claude Code stores a real per-hunk diff for file edits on the SAME line's top-level
          // `toolUseResult.structuredPatch` (hunks of {oldStart,newStart,lines[]}, each line prefixed
          // +/-/space) — the exact data the CLI renders. Fold it into the tool message so the 对话 chip
          // can show +A/−B and open the coloured diff, instead of the bland "…updated successfully" string.
          // A file CREATE has an empty patch but `type:'create'` + `content` → treat every line as added.
          tm.tool.diff = extractDiff(o.toolUseResult);
        }
      }
    }
    i++;
    }
    return msgs;
  }
  return { push, messages: msgs };
}

export function parseTranscript(lines) {
  return createTranscriptParser().push(lines);
}
