import path from 'node:path';
import { execFile as execFileCallback } from 'node:child_process';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';
import { formatDockerFailure } from './docker/diagnostics.js';

const execFile = promisify(execFileCallback);
const dockerIt = process.env.HANDMUX_WORKSPACE_DOCKER === '1' ? it : it.skip;

describe('workspace recovery Docker integration', () => {
  dockerIt('round-trips a workspace across isolated tmux generations', async () => {
    let result;
    try {
      result = await execFile('sh', ['test/docker/workspace-recovery.sh'], {
        cwd: path.resolve('.'),
        maxBuffer: 10 * 1024 * 1024,
      });
    } catch (error) {
      throw new Error(formatDockerFailure(error), { cause: error });
    }

    expect(result.stderr).toBe('');
    expect(result.stdout).toContain('isolated socket: handmux-workspace-test');
    expect(result.stdout).toContain('workspace recovery Docker scenario: PASS');
  }, 900_000);
});
