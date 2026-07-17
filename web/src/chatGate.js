// web/src/chatGate.js
// Derive the pending action gate for the 对话 lens from the transcript + the pane's hook state.
// P1 handles exactly TWO gate types: a generic tool permission (允许/拒绝) and an AskUserQuestion
// (one button per option). ExitPlanMode (plan approval) is intentionally NOT handled here — the ChatView
// tells the user to switch to the terminal for it.
//
// KEY PROTOCOL (VERIFIED against live Claude Code 2026-07-17 by sampling real gates via tmux send-keys):
//   允许        → ['Enter']            permission menu's ❯ defaults to "1. Yes" — Enter selects it
//   拒绝        → ['Escape']           both menus footer-document "Esc to cancel"
//   选第 i 项   → i×['Down'] then ['Enter']   AskUserQuestion footer: "↑/↓ to navigate · Enter to select";
//                                            the ❯ starts on option 0, so Down×i lands on the i-th option
//                                            (verified: Down+Enter selected the 2nd option). 0-based i.
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
