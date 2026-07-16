// web/src/chatGate.js
// Derive the pending action gate for the 对话 lens from the transcript + the pane's hook state.
// P1 handles exactly TWO gate types: a generic tool permission (允许/拒绝) and an AskUserQuestion
// (one button per option). ExitPlanMode (plan approval) is intentionally NOT handled here — the ChatView
// tells the user to switch to the terminal for it.
//
// KEY PROTOCOL (verified against live Claude Code in Task 3 — REPLACE the sequences below with the
// observed truth if they differ):
//   允许        → ['Enter']            (❯ defaults to the first "Yes" option)
//   拒绝        → ['Escape']
//   选第 i 项   → i×['Down'] then ['Enter']   (0-based i; the list starts on option 0)
const ALLOW_KEYS = ['Enter'];
const DENY_KEYS = ['Escape'];
const optionKeys = (idx) => [...Array(idx).fill('Down'), 'Enter'];

export function pendingGate(messages, kind) {
  if (kind !== 'permission') return null;
  const lastTool = [...messages].reverse().find((m) => m.type === 'tool');
  const name = lastTool && lastTool.tool && lastTool.tool.name;
  if (name === 'ExitPlanMode') return null; // P1: plan approval → use the terminal
  if (name === 'AskUserQuestion') {
    const q = lastTool.tool.input && lastTool.tool.input.questions && lastTool.tool.input.questions[0];
    const opts = (q && Array.isArray(q.options) ? q.options : [])
      .map((o, idx) => ({ label: o && o.label ? o.label : String(idx + 1), keys: optionKeys(idx) }));
    if (opts.length) return { type: 'question', prompt: (q && (q.question || q.header)) || '需要你回答', options: opts };
  }
  return {
    type: 'permission',
    prompt: '需要你确认',
    options: [{ label: '允许', keys: ALLOW_KEYS }, { label: '拒绝', keys: DENY_KEYS }],
  };
}
