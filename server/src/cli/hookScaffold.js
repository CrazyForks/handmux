// Shared IO scaffolding for the coding-agent hook installers (claudeHooks.js, codexHooks.js) and the
// statusLine capturer. The FORMAT each installer merges into differs (settings.json vs config.toml's marked
// region vs the single statusLine slot) and stays in its own module — but the plumbing underneath is
// identical: deploy the shared scripts, write the env, remove them on uninstall, and write atomically.
import fs from 'node:fs';
import path from 'node:path';

// The two scripts every agent hook installer deploys. Shared because the stdin payloads are identical across
// agents (Codex mirrors Claude's hook contract), so the same notify/write pair drives both.
export const HOOK_SCRIPTS = ['handmux-notify.sh', 'handmux-write.cjs'];

// Atomic write (tmp + rename) so a crash can't leave a half-written config file. Text in, text out — callers
// pass raw TOML for config.toml, or use writeJsonAtomic for pretty-printed settings.json.
export function writeFileAtomic(file, text) {
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, text);
  fs.renameSync(tmp, file);
}
export const writeJsonAtomic = (file, obj) => writeFileAtomic(file, JSON.stringify(obj, null, 2));

// Deploy the shared notify/write scripts into `hooksDir` and point their env at the shared state file. Same
// bytes for every agent — only the registration target (settings.json vs config.toml) differs per installer.
export function deployHookScripts(hooksDir, srcDir, stateFile) {
  fs.mkdirSync(hooksDir, { recursive: true });
  for (const f of HOOK_SCRIPTS) fs.copyFileSync(path.join(srcDir, f), path.join(hooksDir, f));
  fs.chmodSync(path.join(hooksDir, 'handmux-notify.sh'), 0o755);
  fs.writeFileSync(path.join(hooksDir, 'handmux-notify.env'), `HANDMUX_STATE=${stateFile}\n`, { mode: 0o600 });
}

// Remove the deployed scripts + env (uninstall). Best-effort: a missing file is fine.
export function removeHookScripts(hooksDir) {
  for (const f of [...HOOK_SCRIPTS, 'handmux-notify.env']) {
    try { fs.unlinkSync(path.join(hooksDir, f)); } catch { /* already gone */ }
  }
}
