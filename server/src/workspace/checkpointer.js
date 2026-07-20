import { captureWorkspace } from './capture.js';
import { detectEnvironmentChange } from './environment.js';
import { fingerprintSnapshot } from './schema.js';

function sameSnapshot(left, right) {
  return fingerprintSnapshot(left) === fingerprintSnapshot(right);
}

function snapshotEnvironment(observed) {
  return {
    id: observed.id,
    bootIdentity: observed.bootIdentity,
    tmuxServerId: observed.tmuxServerId,
  };
}

async function reconcileOnce(deps, cause) {
  const handle = await deps.lock.tryAcquire({ operationId: `checkpointer:${cause}` });
  if (!handle) return { status: 'locked' };
  try {
    const observed = await deps.observeEnvironment();
    if (!observed || observed.status === 'unknown') return { status: 'unknown' };

    const live = await deps.store.readLive();
    if (live.status === 'corrupt') return live;
    const previous = live.status === 'ok' ? live.value.environment : null;
    let change = detectEnvironmentChange(previous, observed);
    if (cause === 'confirmed-empty' && observed.status === 'absent' && change.status === 'unknown') {
      change = { status: 'same', reason: 'same', current: observed };
    }
    if (change.status === 'unknown') return change;

    // An absent tmux server is not proof of an intentionally empty workspace. The sole exception is an
    // API deletion that just succeeded and explicitly asks us to confirm emptiness.
    if (observed.status === 'absent' && cause !== 'confirmed-empty') return { status: 'unknown' };

    const captured = await deps.capture(snapshotEnvironment(change.current ?? observed));
    if (captured.status === 'changed-during-capture') {
      deps.scheduleRetry?.();
      return captured;
    }
    if (captured.status !== 'ok' && captured.status !== 'empty') return captured;
    if (captured.status === 'empty' && cause !== 'confirmed-empty' && observed.status !== 'present') {
      return { status: 'unknown' };
    }
    if (change.status === 'changed') {
      const archived = await deps.store.archiveEnvironment({
        endedReason: change.reason,
        detectedAt: new Date(deps.now()).toISOString(),
      });
      if (archived.status !== 'ok' && archived.status !== 'empty') return archived;
    }
    if (live.status === 'ok' && sameSnapshot(live.value, captured.snapshot)) return { status: 'unchanged' };
    await deps.store.writeLive(captured.snapshot);
    return { status: 'written', snapshot: captured.snapshot };
  } finally {
    await handle.release();
  }
}

export function createCheckpointer({
  setInterval = globalThis.setInterval,
  clearInterval = globalThis.clearInterval,
  setTimeout = globalThis.setTimeout,
  clearTimeout = globalThis.clearTimeout,
  now = Date.now,
  ...rest
} = {}) {
  const deps = { ...rest, now, setInterval, clearInterval, setTimeout, clearTimeout };
  let interval = null;
  let debounce = null;
  let running = null;
  let runningCause = null;
  let pendingConfirmation = null;

  function launch(cause) {
    const current = reconcileOnce(deps, cause);
    running = current;
    runningCause = cause;
    const settled = () => {
      if (running !== current) return;
      running = null;
      runningCause = null;
      if (pendingConfirmation) {
        const pending = pendingConfirmation;
        pendingConfirmation = null;
        launch('confirmed-empty').then(pending.resolve, pending.reject);
      }
    };
    current.then(settled, settled);
    return current;
  }

  function confirmEmpty() {
    if (!running) return launch('confirmed-empty');
    if (runningCause === 'confirmed-empty') return running;
    if (!pendingConfirmation) {
      let resolve;
      let reject;
      const promise = new Promise((onResolve, onReject) => { resolve = onResolve; reject = onReject; });
      pendingConfirmation = { promise, resolve, reject };
    }
    return pendingConfirmation.promise;
  }

  function reconcile(cause = 'timer') {
    if (cause === 'confirmed-empty') return confirmEmpty();
    return running || launch(cause);
  }

  function requestReconcile() {
    clearTimeout(debounce);
    debounce = setTimeout(() => {
      debounce = null;
      reconcile('event').catch(() => {});
    }, 2_000);
  }
  deps.scheduleRetry = requestReconcile;

  return {
    reconcile,
    start() {
      if (!interval) interval = setInterval(() => { reconcile('timer').catch(() => {}); }, 60_000);
      return reconcile('start');
    },
    requestReconcile,
    confirmEmpty,
    async stop() {
      if (interval) clearInterval(interval);
      if (debounce) clearTimeout(debounce);
      interval = null;
      debounce = null;
      await reconcile('shutdown').catch(() => {});
      while (running || pendingConfirmation) {
        await (running || pendingConfirmation.promise).catch(() => {});
      }
    },
  };
}

export function createWorkspaceBackground({ store, tmux, observeEnvironment, lock, stateFile, now = Date.now } = {}) {
  return createCheckpointer({
    store,
    observeEnvironment,
    lock,
    now,
    capture: (environment) => captureWorkspace({ tmux, stateFile, environment, now }),
  });
}

export function createGracefulShutdown({ events, workspace, server }) {
  let closing = null;
  return function shutdown() {
    if (!closing) {
      closing = (async () => {
        try {
          await events.stop();
        } finally {
          try { await workspace.stop(); } finally { server.close(); }
        }
      })();
    }
    return closing;
  };
}
