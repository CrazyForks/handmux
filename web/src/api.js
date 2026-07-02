import { getToken } from './storage.js';
import { mimeFromName } from './mime.js';
import { t } from './i18n';

export class UnauthorizedError extends Error {}

async function req(path, opts = {}) {
  const token = getToken();
  const { timeoutMs, ...rest } = opts;
  const headers = { Authorization: `Bearer ${token ?? ''}`, ...(rest.headers || {}) };
  if (rest.body) headers['Content-Type'] = 'application/json';
  let controller = null;
  let to = null;
  if (timeoutMs) {
    controller = new AbortController();
    to = setTimeout(() => controller.abort(), timeoutMs);
  }
  try {
    const res = await fetch(path, { cache: 'no-store', ...rest, headers, signal: controller?.signal });
    if (res.status === 401) throw new UnauthorizedError();
    if (!res.ok) {
      // Surface the server's {error} message (e.g. "port not listening") so callers can show why.
      let msg = `${path} -> ${res.status}`;
      try { const body = await res.json(); if (body?.error) msg = body.error; } catch { /* not json */ }
      throw new Error(msg);
    }
    if (res.status === 204) return { unchanged: true }; // conditional poll: server says nothing changed
    return await res.json();
  } catch (e) {
    // An abort surfaces as a DOMException — normalize it to a plain Error so callers only ever
    // special-case UnauthorizedError and treat everything else (incl. timeouts) as a poll failure.
    if (controller?.signal.aborted) throw new Error(`${path} -> timeout`);
    throw e;
  } finally {
    if (to) clearTimeout(to);
  }
}

export const getSessions = () => req('/api/sessions');
export const getWindows = (session) => req(`/api/windows?session=${encodeURIComponent(session)}`);
export const getPanes = (window) => req(`/api/panes?window=${encodeURIComponent(window)}`);
export const getHistory = (pane, lines = 1500, since) =>
  req(`/api/history?pane=${encodeURIComponent(pane)}&lines=${lines}${since ? `&since=${since}` : ''}`, { timeoutMs: 8000 });
export const sendText = (pane, text, enter = true) =>
  req('/api/send', { method: 'POST', body: JSON.stringify({ pane, text, enter }) });
export const sendKeys = (pane, keys) =>
  req('/api/keys', { method: 'POST', body: JSON.stringify({ pane, keys }) });
export const resizeWindow = (window, cols, rows) =>
  req('/api/resize', { method: 'POST', body: JSON.stringify({ window, cols, rows }) });
export const resizePane = (pane, cols) =>
  req('/api/resize', { method: 'POST', body: JSON.stringify({ pane, cols }) });
export const getWindowLayout = (window) =>
  req(`/api/layout?window=${encodeURIComponent(window)}`);
export const restoreWindowSize = (window, layout) =>
  req('/api/resize', { method: 'POST', body: JSON.stringify({ window, auto: true, layout }) });
export const createSession = (name, cwd, cmd) =>
  req('/api/sessions', { method: 'POST', body: JSON.stringify({ name, cwd, cmd }) });
export const createWindow = (session, pane, name, cwd, cmd) =>
  req('/api/windows', { method: 'POST', body: JSON.stringify({ session, pane, name, cwd, cmd }) });
export const renameSession = (id, name) =>
  req('/api/sessions', { method: 'PATCH', body: JSON.stringify({ id, name }) });
export const renameWindow = (id, name) =>
  req('/api/windows', { method: 'PATCH', body: JSON.stringify({ id, name }) });
export const deleteWindow = (id) =>
  req(`/api/windows?window=${encodeURIComponent(id)}`, { method: 'DELETE' });
export const swapWindows = (a, b) =>
  req('/api/windows/swap', { method: 'POST', body: JSON.stringify({ a, b }) });
export const createDir = (dir, name) =>
  req('/api/dir', { method: 'POST', body: JSON.stringify({ dir, name }) });

export const fetchDoc = (path) =>
  req(`/api/file?path=${encodeURIComponent(path)}`, { timeoutMs: 8000 });
export const fetchDir = (path) =>
  req(`/api/dir${path ? `?path=${encodeURIComponent(path)}` : ''}`, { timeoutMs: 8000 });
// A pane's current working directory (absolute) — used to land the file browser on the session's dir.
export const fetchPaneCwd = (pane) =>
  req(`/api/pane-cwd?pane=${encodeURIComponent(pane)}`, { timeoutMs: 8000 });
// Mint a short-lived signed iFlytek IAT WebSocket URL (server holds the secret). The browser then
// connects to iFlytek directly. 8s timeout so a hung sign call doesn't freeze the mic press.
export const signAsr = () => req('/api/asr/sign', { timeoutMs: 8000 });

// Which optional integrations this install has configured (e.g. { asr: true }). Drives the UI hiding
// controls that can't work — voice/ASR ships disabled on open-source installs without iFlytek keys.
export const getConfig = () => req('/api/config', { timeoutMs: 8000 });
// Enable the Claude Code lifecycle hooks on the host (one-tap from the inbox). Token-gated like every API;
// 15s timeout covers the file copy + settings merge. Returns { ok, status }.
export const installClaudeHooks = () => req('/api/hooks/install', { method: 'POST', timeoutMs: 15000 });
// Scope the inbox roster to the sessions this device has bound — the server returns only those panes.
export const getStates = (sessions = []) =>
  req(`/api/states?sessions=${encodeURIComponent(sessions.join(','))}`, { timeoutMs: 4000 });

// Orphan Claude sessions running outside tmux (see server/src/orphans.js). getOrphans returns the roster;
// takeoverOrphan spawns `claude --resume` in tmux and (default) SIGTERMs the original. Takeover involves a
// process scan + tmux spawn + up-poll, so it gets a longer timeout.
export const getOrphans = () => req('/api/orphans', { timeoutMs: 8000 });
export const takeoverOrphan = (body) =>
  req('/api/orphans/takeover', { method: 'POST', body: JSON.stringify(body), timeoutMs: 15000 });

// --- git viewer (read-only) ---
export const gitRepos = (dir) => req(`/api/git/repos?dir=${encodeURIComponent(dir)}`, { timeoutMs: 8000 });
export const gitStatus = (repo) => req(`/api/git/status?repo=${encodeURIComponent(repo)}`, { timeoutMs: 8000 });
export const gitLog = (repo, { limit = 50, ref } = {}) => {
  let url = `/api/git/log?repo=${encodeURIComponent(repo)}&limit=${limit}`;
  if (ref) url += `&ref=${encodeURIComponent(ref)}`;
  return req(url, { timeoutMs: 8000 });
};
export const gitBranches = (repo) => req(`/api/git/branches?repo=${encodeURIComponent(repo)}`, { timeoutMs: 8000 });
export const gitDiff = (repo, { path, commit, staged } = {}) => {
  let url = `/api/git/diff?repo=${encodeURIComponent(repo)}&path=${encodeURIComponent(path ?? '')}`;
  if (commit) url += `&commit=${encodeURIComponent(commit)}`;
  if (staged) url += '&staged=1';
  return req(url, { timeoutMs: 8000 });
};
export const gitCommit = (repo, hash) =>
  req(`/api/git/commit?repo=${encodeURIComponent(repo)}&hash=${encodeURIComponent(hash)}`, { timeoutMs: 8000 });

// Download a file under $HOME. Can't use a plain <a href> (no Authorization header, and the token
// would leak into the URL / history / access log), so XHR with the Bearer header, then save the
// blob via a throwaway object-URL anchor. onProgress(fraction 0..1) fires as bytes arrive (XHR, not
// fetch, so we get progress events for free). 50MB cap is enforced server-side.
export function downloadFile(path, onProgress) {
  return new Promise((resolve, reject) => {
    const token = getToken();
    const xhr = new XMLHttpRequest();
    xhr.open('GET', `/api/download?path=${encodeURIComponent(path)}`);
    xhr.setRequestHeader('Authorization', `Bearer ${token ?? ''}`);
    xhr.responseType = 'blob';
    xhr.onprogress = (e) => { if (onProgress && e.lengthComputable) onProgress(e.loaded / e.total); };
    xhr.onerror = () => reject(new Error('download failed'));
    xhr.onload = () => {
      if (xhr.status === 401) return reject(new UnauthorizedError());
      if (xhr.status < 200 || xhr.status >= 300) return reject(new Error(`download -> ${xhr.status}`));
      const name = path.split('/').pop() || 'download';
      // Re-tag the blob from its extension when the server's type is generic/empty, so the OS records
      // the right MIME and "Open" launches the gallery/viewer instead of showing raw bytes.
      let blob = xhr.response;
      const mime = mimeFromName(name);
      if (mime && blob && blob.type !== mime) blob = blob.slice(0, blob.size, mime);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      // iOS Safari / Android Chrome 异步读取 blob URL：立刻 revoke 会下载到空文件。延迟到下载已开始
      // 再释放(blob 仅占内存,延迟无害)。
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      resolve();
    };
    xhr.send();
  });
}

// Fetch an image file under $HOME for INLINE viewing — reuses /api/download (which streams any file
// with the right Content-Type, 50MB cap) but keeps the bytes as a blob instead of saving. XHR with the
// Bearer header (an <img src> can't send Authorization, and we won't leak the token into a URL); the
// blob is re-tagged from the extension when the server's type is generic, then turned into an
// object-URL the caller assigns to <img> (and must revokeObjectURL when done).
export function fetchImageUrl(path) {
  return new Promise((resolve, reject) => {
    const token = getToken();
    const xhr = new XMLHttpRequest();
    xhr.open('GET', `/api/download?path=${encodeURIComponent(path)}`);
    xhr.setRequestHeader('Authorization', `Bearer ${token ?? ''}`);
    xhr.responseType = 'blob';
    xhr.onerror = () => reject(new Error(t('api.loadFailed')));
    xhr.onload = () => {
      if (xhr.status === 401) return reject(new UnauthorizedError());
      if (xhr.status < 200 || xhr.status >= 300) return reject(new Error(`image -> ${xhr.status}`));
      let blob = xhr.response;
      const mime = mimeFromName(path.split('/').pop() || '');
      if (mime && blob && blob.type !== mime) blob = blob.slice(0, blob.size, mime);
      resolve(URL.createObjectURL(blob));
    };
    xhr.send();
  });
}

// Preview registry. previewUrl carries the token so a raw browser navigation can set the preview
// cookie. Static → same-origin /preview path; dynamic → the wildcard subdomain (needs `domain`).
export const previewUrl = (entry, domain) => {
  const t = encodeURIComponent(getToken() ?? '');
  if (entry?.kind === 'dynamic') return `https://${encodeURIComponent(entry.name)}.${domain}/?token=${t}`;
  return `/preview/${encodeURIComponent(entry?.name)}/?token=${t}`;
};
// opts = { dir } (static) | { port } (dynamic).
export const createPreview = (name, opts = {}) =>
  req('/api/previews', { method: 'POST', body: JSON.stringify(opts.port != null ? { name, port: opts.port } : { name, dir: opts.dir }) });
export const getPreviews = () => req('/api/previews');
export const deletePreview = (name) =>
  req(`/api/previews/${encodeURIComponent(name)}`, { method: 'DELETE' });

// Upload one file into `dir` (an absolute path under $HOME). `dir` is appended BEFORE the file so
// the server sees the field before the file part (busboy emits parts in order). XHR (not fetch) so
// upload progress is reportable via onProgress(fraction 0..1). We do NOT set Content-Type — the
// browser adds multipart/form-data with the correct boundary.
// stash=true → 传到 ~/.handmux/uploads 下按 cwd 分的空间(服务端按需创建,dir 此时是会话 cwd);
// 返回体含文件绝对路径。文件落在家目录、不进项目树,避免被误提交。
export function uploadFile(dir, file, onProgress, stash = false) {
  return new Promise((resolve, reject) => {
    const token = getToken();
    const fd = new FormData();
    fd.append('dir', dir);
    if (stash) fd.append('stash', '1');
    fd.append('file', file, file.name);
    const xhr = new XMLHttpRequest();
    xhr.open('POST', '/api/upload');
    xhr.setRequestHeader('Authorization', `Bearer ${token ?? ''}`);
    xhr.upload.onprogress = (e) => { if (onProgress && e.lengthComputable) onProgress(e.loaded / e.total); };
    xhr.onerror = () => reject(new Error(t('api.uploadFailed')));
    xhr.onload = () => {
      if (xhr.status === 401) return reject(new UnauthorizedError());
      if (xhr.status >= 200 && xhr.status < 300) {
        try { return resolve(JSON.parse(xhr.responseText)); } catch { return resolve({}); }
      }
      const msg = {
        400: t('api.uploadBadDir'),
        409: t('api.uploadDuplicate'),
        413: t('api.uploadTooLarge'),
        415: t('api.uploadBadType'),
      }[xhr.status] || t('api.uploadFailed');
      reject(new Error(msg));
    };
    xhr.send(fd);
  });
}
