// Install/uninstall the Claude Code lifecycle hooks that feed the handmux inbox. This ports the idempotent
// merge from scripts/install-hooks.sh into testable JS so the OSS CLI (and the phone, via the server) can
// turn the inbox on — opt-in, since writing ~/.claude/settings.json edits another tool's config.
//
// Iron rule: only ever touch ~/.handmux/ and — after explicit opt-in — ~/.claude/. If ~/.claude is absent
// (no Claude Code), skip and report 'no-claude'; never create it.
import fs from 'node:fs';
import path from 'node:path';
import { homedir } from 'node:os';

// The six events the inbox reads. src is the arg passed to handmux-notify.sh; only PostToolUse is scoped to
// a matcher (the two "需要你" interaction tools) — every other Read/Bash/Edit must NOT wake the hook, or
// many concurrent Claude panes would each spawn the hook on every tool call. Keep this table in sync with
// the hook scripts in ../../hooks.
export const HOOK_EVENTS = [
  { event: 'Stop', src: 'stop' },
  { event: 'Notification', src: 'notify' },
  { event: 'UserPromptSubmit', src: 'prompt' },
  { event: 'SessionEnd', src: 'end' },
  { event: 'PostToolUse', src: 'resume', matcher: 'AskUserQuestion|ExitPlanMode' },
  { event: 'PermissionRequest', src: 'permreq' },
];

const HOOK_MARK = 'handmux-notify.sh'; // identifies our hooks among the user's own

// True if `settings.hooks[event]` already has one of our hooks (command references the dest script).
function alreadyHas(hooks, event) {
  return (hooks[event] || []).some((g) => (g.hooks || []).some(
    (h) => typeof h.command === 'string' && h.command.includes(HOOK_MARK)));
}

// Pure: return a NEW settings object with our six hooks merged into settings.hooks, idempotently, leaving
// the user's own hooks and other keys untouched. `dest` is the absolute path to the copied notify script.
export function mergeHooks(settings, dest) {
  const s = { ...(settings || {}) };
  const hooks = (s.hooks && typeof s.hooks === 'object' && !Array.isArray(s.hooks)) ? { ...s.hooks } : {};
  for (const e of HOOK_EVENTS) {
    if (alreadyHas(hooks, e.event)) continue;
    const groups = hooks[e.event] = [...(hooks[e.event] || [])];
    groups.push({ matcher: e.matcher || '', hooks: [{ type: 'command', command: `${dest} ${e.src}`, async: true, timeout: 5 }] });
  }
  s.hooks = hooks;
  return s;
}

// Pure: return a NEW settings object with all of OUR hooks removed (uninstall). An event group that ends up
// empty is dropped; the user's own hooks and other keys are untouched.
export function stripHooks(settings) {
  const s = { ...(settings || {}) };
  if (!s.hooks || typeof s.hooks !== 'object' || Array.isArray(s.hooks)) return s;
  const hooks = {};
  for (const [event, groups] of Object.entries(s.hooks)) {
    const kept = (groups || [])
      .map((g) => ({ ...g, hooks: (g.hooks || []).filter((h) => !(typeof h.command === 'string' && h.command.includes(HOOK_MARK))) }))
      .filter((g) => (g.hooks || []).length > 0);
    if (kept.length) hooks[event] = kept;
  }
  s.hooks = hooks;
  return s;
}

// Path helpers (also used by the IO shell in the next task).
function claudeDir(home = homedir()) { return path.join(home, '.claude'); }
function settingsPath(home = homedir()) { return path.join(claudeDir(home), 'settings.json'); }

// 'no-claude' → ~/.claude absent (don't prompt to enable). 'installed' → our hooks present. 'absent' →
// Claude Code is here but our hooks aren't (offer to enable).
export function hooksStatus(home = homedir()) {
  if (!fs.existsSync(claudeDir(home))) return 'no-claude';
  let settings = {};
  try { settings = JSON.parse(fs.readFileSync(settingsPath(home), 'utf8')); } catch { /* missing/corrupt → {} */ }
  const hooks = (settings && settings.hooks && typeof settings.hooks === 'object' && !Array.isArray(settings.hooks)) ? settings.hooks : {};
  return Object.keys(hooks).some((ev) => alreadyHas(hooks, ev)) ? 'installed' : 'absent';
}

const SCRIPTS = ['handmux-notify.sh', 'handmux-write.cjs'];

// Atomic JSON write (tmp + rename) so a crash can't leave a half-written settings.json.
function writeJsonAtomic(file, obj) {
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(obj, null, 2));
  fs.renameSync(tmp, file);
}

// Install (opt-in): copy the bundled hook scripts to ~/.claude/hooks/, write the env pointing at the state
// file, and merge our six hooks into settings.json. Returns { status }. NEVER creates ~/.claude — if it's
// absent the user doesn't run Claude Code, so we report 'no-claude' and do nothing.
//   srcDir   = the bundled hooks dir (server/hooks)
//   stateFile = the unified ~/.handmux/claude-state.json path the hook writes and the server reads
export function installHooks(home = homedir(), { srcDir, stateFile } = {}) {
  if (!fs.existsSync(claudeDir(home))) return { status: 'no-claude' };
  const hooksDir = path.join(claudeDir(home), 'hooks');
  fs.mkdirSync(hooksDir, { recursive: true });
  for (const f of SCRIPTS) fs.copyFileSync(path.join(srcDir, f), path.join(hooksDir, f));
  fs.chmodSync(path.join(hooksDir, 'handmux-notify.sh'), 0o755);
  fs.writeFileSync(path.join(hooksDir, 'handmux-notify.env'), `HANDMUX_STATE=${stateFile}\n`, { mode: 0o600 });

  const dest = path.join(hooksDir, 'handmux-notify.sh');
  let settings = {};
  try { settings = JSON.parse(fs.readFileSync(settingsPath(home), 'utf8')); } catch { /* missing/corrupt → {} */ }
  writeJsonAtomic(settingsPath(home), mergeHooks(settings, dest));
  return { status: 'installed' };
}

// Uninstall: strip our hooks from settings.json and remove the copied scripts/env. Best-effort on the file
// deletes (a missing file is fine). Leaves ~/.claude and the user's own hooks intact.
export function uninstallHooks(home = homedir()) {
  let settings = {};
  try { settings = JSON.parse(fs.readFileSync(settingsPath(home), 'utf8')); } catch { /* nothing to strip */ }
  if (fs.existsSync(settingsPath(home))) writeJsonAtomic(settingsPath(home), stripHooks(settings));
  const hooksDir = path.join(claudeDir(home), 'hooks');
  for (const f of [...SCRIPTS, 'handmux-notify.env']) {
    try { fs.unlinkSync(path.join(hooksDir, f)); } catch { /* already gone */ }
  }
  return { status: 'absent' };
}
