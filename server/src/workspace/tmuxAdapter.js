import crypto from 'node:crypto';
import { createAgentRunner } from './agentRunner.js';
import { parseTmuxRows, tmuxFormat } from '../tmux/format.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NO_SERVER_RE = /^(?:no server running on(?: .+)?|no sessions)$/i;
const MISSING_OPTION_RE = /invalid option|unknown option|not set/i;
const SESSION_FORMAT = tmuxFormat(['session_id', 'session_name', 'session_last_attached', '@handmux_session_id']);
const WINDOW_FORMAT = tmuxFormat(['session_id', 'window_id', 'window_index', 'window_name', 'window_active', 'window_layout', '@handmux_window_id']);
const PANE_FORMAT = tmuxFormat(['window_id', 'pane_id', 'pane_index', 'pane_active', 'pane_current_path', '@handmux_pane_id']);
const ACTIVE_FORMAT = tmuxFormat(['session_id', 'window_id', 'pane_id']);

const text = (value) => String(value && typeof value === 'object' && 'stdout' in value ? value.stdout : value ?? '');
const compare = (a, b) => a < b ? -1 : a > b ? 1 : 0;
const byId = (a, b) => compare(a.id, b.id);
const byRuntime = (a, b) => compare(a.runtimeId, b.runtimeId);

function isUuid(value) { return typeof value === 'string' && UUID_RE.test(value); }
function isNoServer(error) {
  if (error?.code === 'ENOENT') return true;
  return NO_SERVER_RE.test(String(error?.stderr || error?.message || error || '').trim());
}
function isMissingOption(error) { return MISSING_OPTION_RE.test(String(error?.stderr || error?.message || error || '')); }

function rows(output, columns, label) {
  return parseTmuxRows(text(output), columns, label);
}

function index(value, label) {
  if (!/^\d+$/.test(value)) throw new Error(`invalid ${label}`);
  return Number(value);
}

function active(value, label) {
  if (value !== '0' && value !== '1') throw new Error(`invalid ${label}`);
  return value === '1';
}

function runtime(value, prefix, label) {
  if (!new RegExp(`^\\${prefix}\\d+$`).test(value)) throw new Error(`invalid ${label}`);
  return value;
}

function logicalAllocator(randomUUID) {
  const used = new Set();
  return {
    accept(candidate) {
      const id = candidate;
      if (!isUuid(id) || used.has(id)) return null;
      used.add(id);
      return id;
    },
    fresh() {
      for (let tries = 0; tries < 100; tries++) {
        const id = randomUUID();
        if (isUuid(id) && !used.has(id)) { used.add(id); return id; }
      }
      throw new Error('could not allocate a unique workspace logical id');
    },
  };
}

function requireLogicalId(value, label) {
  if (!isUuid(value)) throw new Error(`${label} must be a UUID`);
  return value;
}

function requireCreatedRuntime(value, prefix, label) {
  return runtime(value, prefix, label);
}

function isTmuxLayout(value) {
  if (typeof value !== 'string' || value.length === 0 || value.length > 8192) return false;
  if (!/^[0-9a-f]{4},\d+x\d+,\d+,\d+(?:,\d+|[\[{])/i.test(value)) return false;
  if (!/^[0-9a-fx,{}\[\]]+$/i.test(value)) return false;
  const stack = [];
  for (const char of value) {
    if (char === '{' || char === '[') stack.push(char);
    else if (char === '}' || char === ']') {
      const expected = char === '}' ? '{' : '[';
      if (stack.pop() !== expected) return false;
    }
  }
  return stack.length === 0;
}

function errorText(error) {
  return error instanceof Error ? error.message : String(error);
}

function withCleanupError(error, cleanupError) {
  if (!cleanupError) return error;
  const combined = new Error(`${errorText(error)}; cleanup failed: ${errorText(cleanupError)}`);
  combined.cause = error;
  return combined;
}

export function createdTargetGuard(created) {
  return (target) => {
    if (!created.has(target)) throw new Error(`workspace target was not created by this restore: ${target}`);
    return target;
  };
}

export function createWorkspaceTmux({ run, randomUUID = crypto.randomUUID, agentRunner = createAgentRunner(), readOnly = false } = {}) {
  if (typeof run !== 'function') throw new Error('workspace tmux run is required');
  const created = new Set();
  const guard = createdTargetGuard(created);
  const sessionWindows = new Map();
  const windowSession = new Map();
  const windowPanes = new Map();
  const paneWindow = new Map();

  function ensureWritable() {
    if (readOnly) throw new Error('workspace tmux adapter is read-only');
  }

  function trackWindow(sessionId, windowId, paneId) {
    const windows = sessionWindows.get(sessionId) || new Set();
    windows.add(windowId);
    sessionWindows.set(sessionId, windows);
    windowSession.set(windowId, sessionId);
    windowPanes.set(windowId, new Set([paneId]));
    paneWindow.set(paneId, windowId);
  }

  function trackPane(targetPaneId, paneId) {
    const windowId = paneWindow.get(targetPaneId);
    if (!windowId) throw new Error(`workspace pane owner is unavailable: ${targetPaneId}`);
    windowPanes.get(windowId).add(paneId);
    paneWindow.set(paneId, windowId);
  }

  function forgetWindow(windowId) {
    for (const paneId of windowPanes.get(windowId) || []) {
      created.delete(paneId);
      paneWindow.delete(paneId);
    }
    windowPanes.delete(windowId);
    const sessionId = windowSession.get(windowId);
    if (sessionId) sessionWindows.get(sessionId)?.delete(windowId);
    windowSession.delete(windowId);
    created.delete(windowId);
  }

  function forgetSession(sessionId) {
    for (const windowId of sessionWindows.get(sessionId) || []) forgetWindow(windowId);
    sessionWindows.delete(sessionId);
    created.delete(sessionId);
  }

  function revokeCreatedTargets() {
    created.clear();
    sessionWindows.clear();
    windowSession.clear();
    windowPanes.clear();
    paneWindow.clear();
  }

  async function cleanupSteps(steps) {
    const failures = [];
    for (const step of steps) {
      try { await step(); } catch (error) { failures.push(errorText(error)); }
    }
    if (failures.length) throw new Error(failures.join('; '));
  }

  async function cleanupSession(sessionId, windowId, paneId) {
    let killed = false;
    try {
      await cleanupSteps([
        () => run(['set-option', '-u', '-p', '-t', paneId, '@handmux_pane_id']),
        () => run(['set-option', '-u', '-w', '-t', windowId, '@handmux_window_id']),
        () => run(['set-option', '-u', '-t', sessionId, '@handmux_session_id']),
        async () => { await run(['kill-session', '-t', sessionId]); killed = true; },
      ]);
    } finally {
      if (killed) forgetSession(sessionId);
    }
  }

  async function cleanupWindow(windowId, paneId) {
    let killed = false;
    try {
      await cleanupSteps([
        () => run(['set-option', '-u', '-p', '-t', paneId, '@handmux_pane_id']),
        () => run(['set-option', '-u', '-w', '-t', windowId, '@handmux_window_id']),
        async () => { await run(['kill-window', '-t', windowId]); killed = true; },
      ]);
    } finally {
      if (killed) forgetWindow(windowId);
    }
  }

  async function cleanupPane(paneId) {
    let killed = false;
    try {
      await cleanupSteps([
        () => run(['set-option', '-u', '-p', '-t', paneId, '@handmux_pane_id']),
        async () => { await run(['kill-pane', '-t', paneId]); killed = true; },
      ]);
    } finally {
      if (killed) {
        created.delete(paneId);
        windowPanes.get(paneWindow.get(paneId))?.delete(paneId);
        paneWindow.delete(paneId);
      }
    }
  }

  async function observeEnvironment() {
    let current;
    try {
      current = text(await run(['show-options', '-gv', '@handmux_server_id'])).replace(/\r?\n$/, '');
    } catch (error) {
      if (isNoServer(error)) return { status: 'absent', tmuxServerId: null };
      if (!isMissingOption(error)) return { status: 'unknown' };
      current = '';
    }
    if (isUuid(current)) return { status: 'present', tmuxServerId: current };
    const tmuxServerId = randomUUID();
    if (!isUuid(tmuxServerId)) return { status: 'unknown' };
    if (readOnly) return { status: 'present', tmuxServerId };
    try {
      await run(['set-option', '-g', '@handmux_server_id', tmuxServerId]);
      return { status: 'present', tmuxServerId };
    } catch (error) {
      return isNoServer(error) ? { status: 'absent', tmuxServerId: null } : { status: 'unknown' };
    }
  }

  async function assignLogicalIds(items, option, scopeArgs) {
    const allocator = logicalAllocator(randomUUID);
    for (const item of [...items].sort(byRuntime)) {
      const accepted = allocator.accept(item.optionId);
      item.id = accepted || allocator.fresh();
      if (!accepted && !readOnly) await run(['set-option', ...scopeArgs, '-t', item.runtimeId, option, item.id]);
    }
  }

  async function captureTopology() {
    try {
      const environment = await observeEnvironment();
      if (environment.status === 'absent') return { status: 'empty', tmuxVersion: 'unknown', active: null, sessions: [], windows: [] };
      if (environment.status !== 'present') return { status: 'unknown', error: 'tmux environment unavailable' };

      const tmuxVersion = text(await run(['-V'])).trim().replace(/^tmux\s+/, '');
      if (!tmuxVersion) throw new Error('invalid tmux version');
      let sessionFields;
      try { sessionFields = rows(await run(['list-sessions', '-F', SESSION_FORMAT]), 4, 'session'); }
      catch (error) {
        if (isNoServer(error)) return { status: 'empty', tmuxVersion: 'unknown', active: null, sessions: [], windows: [] };
        throw error;
      }
      if (sessionFields.length === 0) return { status: 'empty', tmuxVersion: 'unknown', active: null, sessions: [], windows: [] };

      const sessions = sessionFields.map(([runtimeId, name, lastAttached, optionId]) => ({
        runtimeId: runtime(runtimeId, '$', 'session runtime id'), name,
        lastAttached: index(lastAttached === '' ? '0' : lastAttached, 'session last attached'), optionId,
        windowLinks: [], activeWindowId: null,
      }));
      if (new Set(sessions.map((item) => item.runtimeId)).size !== sessions.length) throw new Error('duplicate session runtime id');
      await assignLogicalIds(sessions, '@handmux_session_id', []);
      const sessionByRuntime = new Map(sessions.map((item) => [item.runtimeId, item]));

      const windowFields = rows(await run(['list-windows', '-a', '-F', WINDOW_FORMAT]), 7, 'window');
      const windowLinks = windowFields.map(([sessionRuntimeId, runtimeId, windowIndex, name, isActive, layout, optionId]) => {
        if (!sessionByRuntime.has(sessionRuntimeId)) throw new Error('window references unknown session');
        return {
          sessionRuntimeId, runtimeId: runtime(runtimeId, '@', 'window runtime id'), index: index(windowIndex, 'window index'),
          name, active: active(isActive, 'window active'), layout, optionId,
        };
      });
      const groupedWindows = new Map();
      for (const link of windowLinks) {
        const group = groupedWindows.get(link.runtimeId) || [];
        group.push(link);
        groupedWindows.set(link.runtimeId, group);
      }
      const windows = [...groupedWindows].map(([runtimeId, links]) => {
        const optionIds = new Set(links.map((item) => item.optionId).filter(Boolean));
        if (optionIds.size > 1) throw new Error('linked window has conflicting logical ids');
        return { runtimeId, optionId: optionIds.values().next().value || '', links };
      });
      await assignLogicalIds(windows, '@handmux_window_id', ['-w']);
      const windowByRuntime = new Map(windows.map((item) => [item.runtimeId, item]));

      for (const window of windows) {
        for (const link of window.links) {
          const session = sessionByRuntime.get(link.sessionRuntimeId);
          session.windowLinks.push({ windowId: window.id, index: link.index });
          if (link.active) session.activeWindowId = window.id;
        }
      }
      for (const session of sessions) {
        session.windowLinks.sort((a, b) => a.index - b.index || compare(a.windowId, b.windowId));
        if (!session.windowLinks.length || !session.activeWindowId) throw new Error('session has no active linked window');
      }

      const paneFields = rows(await run(['list-panes', '-a', '-F', PANE_FORMAT]), 6, 'pane');
      const paneByRuntime = new Map();
      for (const [windowRuntimeId, runtimeId, paneIndex, isActive, cwd, optionId] of paneFields) {
        if (!windowByRuntime.has(windowRuntimeId)) throw new Error('pane references unknown window');
        const pane = {
          windowRuntimeId, runtimeId: runtime(runtimeId, '%', 'pane runtime id'), index: index(paneIndex, 'pane index'),
          active: active(isActive, 'pane active'), cwd, optionId, agent: null,
        };
        const existing = paneByRuntime.get(pane.runtimeId);
        if (existing) {
          const fields = (item) => [item.windowRuntimeId, item.index, item.active, item.cwd, item.optionId];
          if (JSON.stringify(fields(existing)) !== JSON.stringify(fields(pane))) {
            throw new Error('duplicate pane runtime id has conflicting fields');
          }
        } else {
          paneByRuntime.set(pane.runtimeId, pane);
        }
      }
      const panes = [...paneByRuntime.values()];
      await assignLogicalIds(panes, '@handmux_pane_id', ['-p']);

      const canonicalSessions = sessions.sort(byId);
      const canonicalWindows = windows.map((window) => {
        const owner = [...window.links].sort((a, b) => compare(sessionByRuntime.get(a.sessionRuntimeId).id, sessionByRuntime.get(b.sessionRuntimeId).id))[0];
        const windowPanes = panes.filter((pane) => pane.windowRuntimeId === window.runtimeId).sort(byId);
        const activePane = windowPanes.find((pane) => pane.active);
        if (!activePane) throw new Error('window has no active pane');
        return {
          id: window.id, runtimeId: window.runtimeId, name: owner.name, index: owner.index, layout: owner.layout,
          activePaneId: activePane.id,
          panes: windowPanes.map(({ id, runtimeId, index: paneIndex, cwd, agent }) => ({ id, runtimeId, index: paneIndex, cwd, agent })),
        };
      }).sort(byId);

      const maxAttached = Math.max(...canonicalSessions.map((session) => session.lastAttached));
      const selected = canonicalSessions.find((session) => session.lastAttached === maxAttached);
      const [activeSessionRuntime, activeWindowRuntime, activePaneRuntime] = rows(
        await run(['display-message', '-p', '-t', selected.runtimeId, ACTIVE_FORMAT]), 3, 'active path',
      )[0] || [];
      const activeSession = sessionByRuntime.get(activeSessionRuntime);
      const activeWindow = windowByRuntime.get(activeWindowRuntime);
      const activePane = panes.find((pane) => pane.runtimeId === activePaneRuntime);
      if (!activeSession || !activeWindow || !activePane || activePane.windowRuntimeId !== activeWindowRuntime) throw new Error('invalid active path');

      return {
        status: 'ok', tmuxVersion,
        active: { sessionId: activeSession.id, windowId: activeWindow.id, paneId: activePane.id },
        sessions: canonicalSessions.map(({ id, runtimeId, name, windowLinks, activeWindowId }) => ({ id, runtimeId, name, windowLinks, activeWindowId })),
        windows: canonicalWindows,
      };
    } catch (error) {
      return { status: 'unknown', error: error?.message || String(error) };
    }
  }

  async function createTemporarySession({ cwd, sessionLogicalId, windowLogicalId, paneLogicalId, windowName, windowIndex }) {
    ensureWritable();
    requireLogicalId(sessionLogicalId, 'sessionLogicalId');
    const hasSeed = [windowLogicalId, paneLogicalId, windowName, windowIndex].some((value) => value !== undefined);
    if (hasSeed) {
      requireLogicalId(windowLogicalId, 'windowLogicalId');
      requireLogicalId(paneLogicalId, 'paneLogicalId');
      if (typeof windowName !== 'string' || !windowName) throw new Error('windowName must be a non-empty string');
      if (!Number.isInteger(windowIndex) || windowIndex < 0) throw new Error('windowIndex must be a non-negative integer');
    }
    const name = `hm-r-${randomUUID().replaceAll('-', '').slice(0, 8)}`;
    if (!/^hm-r-[0-9a-f]{8}$/i.test(name)) throw new Error('could not allocate temporary session name');
    const args = ['new-session', '-d', '-P', '-F', tmuxFormat(['session_id', 'window_id', 'pane_id', 'window_index']), '-s', name];
    if (hasSeed) args.push('-n', windowName);
    args.push('-c', cwd);
    const output = await run(args);
    let sessionId;
    let windowId;
    let paneId;
    let seedIndex;
    try {
      const parsed = rows(output, 4, 'created session')[0];
      if (!parsed) throw new Error('tmux did not return created session ids');
      [sessionId, windowId, paneId] = parsed;
      requireCreatedRuntime(sessionId, '$', 'created session id');
      requireCreatedRuntime(windowId, '@', 'created window id');
      requireCreatedRuntime(paneId, '%', 'created pane id');
      seedIndex = index(parsed[3], 'created window index');
    } catch (error) {
      let cleanupError;
      try { await run(['kill-session', '-t', `=${name}`]); } catch (failure) { cleanupError = failure; }
      throw withCleanupError(error, cleanupError);
    }
    created.add(sessionId); created.add(windowId); created.add(paneId);
    trackWindow(sessionId, windowId, paneId);
    try {
      const targetIndex = hasSeed ? windowIndex : 9999;
      if (seedIndex !== targetIndex) await run(['move-window', '-s', guard(windowId), '-t', `${guard(sessionId)}:${targetIndex}`]);
      if (hasSeed) {
        await run(['set-option', '-p', '-t', guard(paneId), '@handmux_pane_id', paneLogicalId]);
        await run(['set-option', '-w', '-t', guard(windowId), '@handmux_window_id', windowLogicalId]);
      }
      // Set the session id last: after this succeeds the helper has no remaining fallible setup step.
      await run(['set-option', '-t', guard(sessionId), '@handmux_session_id', sessionLogicalId]);
    } catch (error) {
      let cleanupError;
      try { await cleanupSession(sessionId, windowId, paneId); } catch (failure) { cleanupError = failure; }
      throw withCleanupError(error, cleanupError);
    }
    return { sessionId, windowId, paneId, name };
  }

  async function createWindow(sessionId, { name, index: windowIndex, cwd, windowLogicalId, paneLogicalId }) {
    ensureWritable();
    guard(sessionId);
    if (!Number.isInteger(windowIndex) || windowIndex < 0) throw new Error('window index must be a non-negative integer');
    requireLogicalId(windowLogicalId, 'windowLogicalId');
    requireLogicalId(paneLogicalId, 'paneLogicalId');
    const parsed = rows(await run(['new-window', '-d', '-P', '-F', tmuxFormat(['window_id', 'pane_id']), '-t', `${sessionId}:${windowIndex}`, '-n', name, '-c', cwd]), 2, 'created window')[0];
    if (!parsed) throw new Error('tmux did not return created window ids');
    const [windowId, paneId] = parsed;
    requireCreatedRuntime(windowId, '@', 'created window id');
    requireCreatedRuntime(paneId, '%', 'created pane id');
    created.add(windowId); created.add(paneId);
    trackWindow(sessionId, windowId, paneId);
    try {
      await run(['set-option', '-p', '-t', guard(paneId), '@handmux_pane_id', paneLogicalId]);
      await run(['set-option', '-w', '-t', guard(windowId), '@handmux_window_id', windowLogicalId]);
    } catch (error) {
      let cleanupError;
      try { await cleanupWindow(windowId, paneId); } catch (failure) { cleanupError = failure; }
      throw withCleanupError(error, cleanupError);
    }
    return { windowId, paneId };
  }

  async function splitPane(targetPaneId, { cwd, paneLogicalId }) {
    ensureWritable();
    guard(targetPaneId);
    requireLogicalId(paneLogicalId, 'paneLogicalId');
    const paneId = text(await run(['split-window', '-d', '-P', '-F', '#{pane_id}', '-t', targetPaneId, '-c', cwd])).trim();
    requireCreatedRuntime(paneId, '%', 'created pane id');
    created.add(paneId);
    trackPane(targetPaneId, paneId);
    try {
      await run(['set-option', '-p', '-t', guard(paneId), '@handmux_pane_id', paneLogicalId]);
    } catch (error) {
      let cleanupError;
      try { await cleanupPane(paneId); } catch (failure) { cleanupError = failure; }
      throw withCleanupError(error, cleanupError);
    }
    return paneId;
  }

  async function linkWindow(windowId, sessionId, windowIndex, { existing = false } = {}) {
    ensureWritable();
    if (existing) runtime(windowId, '@', 'existing window id');
    else guard(windowId);
    guard(sessionId);
    if (!Number.isInteger(windowIndex) || windowIndex < 0) throw new Error('window index must be a non-negative integer');
    await run(['link-window', '-s', windowId, '-t', `${sessionId}:${windowIndex}`]);
  }
  async function applyLayout(windowId, layout) {
    ensureWritable();
    const target = guard(windowId);
    if (!isTmuxLayout(layout)) throw new Error('invalid workspace layout');
    await run(['select-layout', '-t', target, layout]);
  }
  async function selectPane(paneId) { ensureWritable(); await run(['select-pane', '-t', guard(paneId)]); }
  async function selectWindow(windowId) { ensureWritable(); await run(['select-window', '-t', guard(windowId)]); }
  async function selectWindowInSession(sessionId, windowIndex) {
    ensureWritable();
    guard(sessionId);
    if (!Number.isInteger(windowIndex) || windowIndex < 0) throw new Error('window index must be a non-negative integer');
    await run(['select-window', '-t', `${sessionId}:${windowIndex}`]);
  }
  async function renameCreatedSession(sessionId, name) { ensureWritable(); await run(['rename-session', '-t', guard(sessionId), name]); }
  async function killCreatedSession(sessionId) {
    ensureWritable();
    guard(sessionId);
    let killed = false;
    try {
      await cleanupSteps([
        () => run(['set-option', '-u', '-t', sessionId, '@handmux_session_id']),
        async () => { await run(['kill-session', '-t', sessionId]); killed = true; },
      ]);
    } finally {
      if (killed) forgetSession(sessionId);
    }
  }
  async function killCreatedWindow(windowId) {
    ensureWritable();
    await run(['kill-window', '-t', guard(windowId)]);
    forgetWindow(windowId);
  }

  async function startAgent(paneId, cmd, args = []) {
    ensureWritable();
    guard(paneId);
    const valid = cmd === 'claude'
      ? args.length === 2 && args[0] === '--resume' && isUuid(args[1])
      : cmd === 'codex' && args.length === 2 && args[0] === 'resume' && isUuid(args[1]);
    if (!valid) throw new Error('unsafe agent command token');
    await agentRunner.prepare({ paneId, cmd, args });
    let foregroundStarted = false;
    try {
      await run(['send-keys', '-t', paneId, '-l', '--', agentRunner.command]);
      await run(['send-keys', '-t', paneId, 'Enter']);
      foregroundStarted = true;
      const ready = await agentRunner.waitReady(paneId);
      if (ready?.status !== 'ready') throw new Error(ready?.error || 'agent failed before readiness');
    } catch (error) {
      const cleanupFailures = [];
      if (foregroundStarted) {
        try { await run(['send-keys', '-t', paneId, 'C-c']); } catch (failure) { cleanupFailures.push(failure); }
      }
      if (typeof agentRunner.cancel === 'function') {
        try { await agentRunner.cancel(paneId); } catch (failure) { cleanupFailures.push(failure); }
      }
      const cleanupError = cleanupFailures.length
        ? new Error(cleanupFailures.map(errorText).join('; '))
        : null;
      throw withCleanupError(error, cleanupError);
    }
  }

  async function topologyFingerprint() {
    const topology = await captureTopology();
    if (topology.status === 'unknown') return topology;
    return crypto.createHash('sha256').update(JSON.stringify(topology)).digest('hex');
  }

  return {
    observeEnvironment,
    captureTopology,
    createTemporarySession,
    createWindow,
    splitPane,
    linkWindow,
    applyLayout,
    selectPane,
    selectWindow,
    selectWindowInSession,
    renameCreatedSession,
    killCreatedSession,
    killCreatedWindow,
    startAgent,
    topologyFingerprint,
    revokeCreatedTargets,
  };
}
