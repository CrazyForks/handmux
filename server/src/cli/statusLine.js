// Install/uninstall the handmux Claude statusLine — the capturer that snapshots the 5h/weekly rate-limit %
// (from Claude Code's statusLine stdin, the only documented local source) to ~/.handmux/claude-usage.json
// for the phone's Usage page. Opt-in, and NON-DESTRUCTIVE by design: Claude allows exactly one statusLine,
// so if the user already has their OWN we NEVER clobber it — we report 'foreign' and the CLI prints a
// one-line compose snippet instead. We only ever write settings.statusLine when it's absent or already ours.
//
// Iron rule (same as claudeHooks): only ever touch ~/.handmux/ and — after opt-in — ~/.claude/. Never
// create ~/.claude.
import fs from 'node:fs';
import path from 'node:path';
import { homedir } from 'node:os';

const STATUS_MARK = 'handmux-statusline.cjs'; // identifies our statusLine command among the user's own
const SCRIPT = 'handmux-statusline.cjs';

function claudeDir(home = homedir()) { return path.join(home, '.claude'); }
function settingsPath(home = homedir()) { return path.join(claudeDir(home), 'settings.json'); }

function readSettings(home) {
  try { return JSON.parse(fs.readFileSync(settingsPath(home), 'utf8')); } catch { return {}; }
}
function writeJsonAtomic(file, obj) {
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(obj, null, 2));
  fs.renameSync(tmp, file);
}

function isOurs(sl) {
  return !!(sl && typeof sl.command === 'string' && sl.command.includes(STATUS_MARK));
}

// 'no-claude' → ~/.claude absent. 'ours' → our statusLine is installed. 'foreign' → the user has their own
// statusLine (we must not touch it). 'absent' → Claude Code is here but no statusLine configured.
export function statusLineStatus(home = homedir()) {
  if (!fs.existsSync(claudeDir(home))) return 'no-claude';
  const sl = readSettings(home).statusLine;
  if (isOurs(sl)) return 'ours';
  if (sl && (sl.command || sl.type)) return 'foreign';
  return 'absent';
}

// The exact command a user with an EXISTING statusline appends to capture without changing their display:
// pipe their statusline's stdin through our capturer in TEE mode first. Returned so the CLI can print it.
export function composeHint(home = homedir(), { usageFile } = {}) {
  const dest = path.join(claudeDir(home), 'hooks', SCRIPT);
  return `HANDMUX_STATUS_TEE=1 node ${dest} ${usageFile} | <your existing statusline>`;
}

// Install (opt-in): copy the capturer to ~/.claude/hooks/ and point settings.statusLine at it — but ONLY
// when it's safe (absent or already ours). A 'foreign' statusLine is left untouched. Returns { status }.
//   srcDir    = bundled hooks dir (server/hooks)
//   usageFile = ~/.handmux/claude-usage.json (the snapshot the server reads)
export function installStatusLine(home = homedir(), { srcDir, usageFile } = {}) {
  if (!fs.existsSync(claudeDir(home))) return { status: 'no-claude' };
  const status = statusLineStatus(home);
  if (status === 'foreign') return { status: 'foreign' }; // never clobber the user's own statusline
  const hooksDir = path.join(claudeDir(home), 'hooks');
  fs.mkdirSync(hooksDir, { recursive: true });
  const dest = path.join(hooksDir, SCRIPT);
  fs.copyFileSync(path.join(srcDir, SCRIPT), dest);
  const settings = readSettings(home);
  settings.statusLine = { type: 'command', command: `node ${dest} ${usageFile}` };
  writeJsonAtomic(settingsPath(home), settings);
  return { status: 'installed' };
}

// Uninstall: drop settings.statusLine only if it's ours, and remove the copied script. Leaves a foreign
// statusLine and everything else intact.
export function uninstallStatusLine(home = homedir()) {
  const settings = readSettings(home);
  if (isOurs(settings.statusLine)) {
    delete settings.statusLine;
    if (fs.existsSync(settingsPath(home))) writeJsonAtomic(settingsPath(home), settings);
  }
  try { fs.unlinkSync(path.join(claudeDir(home), 'hooks', SCRIPT)); } catch { /* already gone */ }
  return { status: 'absent' };
}
