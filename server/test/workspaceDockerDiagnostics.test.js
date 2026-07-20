import { describe, expect, it } from 'vitest';
import { formatDockerFailure } from './docker/diagnostics.js';

describe('workspace Docker diagnostics', () => {
  it('includes sanitized stdout, stderr, exit code, and signal', () => {
    expect(formatDockerFailure({
      code: 7,
      signal: 'SIGTERM',
      stdout: 'phase a\rprogress\0done',
      stderr: 'tmux failed',
    })).toBe([
      'workspace recovery Docker failed (exit: 7, signal: SIGTERM)',
      'stdout:',
      'phase a\nprogress?done',
      'stderr:',
      'tmux failed',
    ].join('\n'));
  });
});
