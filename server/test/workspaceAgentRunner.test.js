import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import { launchAgentRequest, validateAgentRequest } from '../src/workspace/agentRunner.js';

const ID = 'aaaaaaaa-0000-4000-8000-000000000001';

function childProcess() {
  const child = new EventEmitter();
  child.once = child.once.bind(child);
  return child;
}

describe('workspace agent runner', () => {
  it('validates the allowlist again and passes checkpoint session id only as a spawn argv token', async () => {
    vi.useFakeTimers();
    const child = childProcess();
    const spawn = vi.fn(() => child);
    const launched = launchAgentRequest({ cmd: 'claude', args: ['--resume', ID] }, { spawn, readinessMs: 50 });
    child.emit('spawn');
    await vi.advanceTimersByTimeAsync(50);
    expect(await launched.ready).toEqual({ status: 'ready' });
    expect(spawn).toHaveBeenCalledWith('claude', ['--resume', ID], expect.objectContaining({ shell: false, stdio: 'inherit' }));
    child.emit('exit', 0, null);
    expect(await launched.completion).toEqual({ code: 0, signal: null });
    vi.useRealTimers();
  });

  it.each([
    [{ cmd: 'claude', args: ['--resume', `${ID}; touch /tmp/x`] }],
    [{ cmd: 'codex', args: ['resume', '../bad'] }],
    [{ cmd: 'sh', args: ['-c', 'anything'] }],
  ])('rejects unsafe persisted requests before spawn', (request) => {
    expect(() => validateAgentRequest(request)).toThrow(/unsafe agent request/i);
  });

  it('reports binary absence and immediate nonzero exit before readiness', async () => {
    for (const trigger of ['error', 'exit']) {
      vi.useFakeTimers();
      const child = childProcess();
      const launched = launchAgentRequest({ cmd: 'codex', args: ['resume', ID] }, { spawn: () => child, readinessMs: 100 });
      if (trigger === 'error') child.emit('error', Object.assign(new Error('spawn codex ENOENT'), { code: 'ENOENT' }));
      else child.emit('exit', 127, null);
      await expect(launched.ready).resolves.toMatchObject({ status: 'failed', error: expect.stringMatching(/not found|exited 127/i) });
      vi.useRealTimers();
    }
  });
});
