import { chmodSync, mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const deployScript = path.join(repoRoot, 'deploy.sh');

function executable(file, source) {
  writeFileSync(file, source);
  chmodSync(file, 0o755);
}

function fixture() {
  const root = mkdtempSync(path.join(tmpdir(), 'handmux-deploy-test-'));
  const bin = path.join(root, 'bin');
  const worktree = path.join(root, 'named-browser-tree');
  mkdirSync(bin);
  mkdirSync(path.join(worktree, 'server'), { recursive: true });
  mkdirSync(path.join(worktree, 'web'));
  writeFileSync(path.join(worktree, 'server/package.json'), '{"version":"9.9.9"}');
  writeFileSync(path.join(worktree, 'web/package.json'), '{}');
  executable(path.join(bin, 'git'), `#!/bin/sh
printf 'worktree %s\\nHEAD a\\nbranch refs/heads/master\\n\\nworktree %s\\nHEAD b\\nbranch refs/heads/feat/browser\\n\\n' '${repoRoot}' '${worktree}'
`);
  executable(path.join(bin, 'node'), '#!/bin/sh\necho 9.9.9\n');
  executable(path.join(bin, 'npm'), '#!/bin/sh\necho "npm:$PWD:$*"\n');
  executable(path.join(bin, 'handmux'), '#!/bin/sh\necho "handmux:$*"\n');
  return { root, bin, worktree };
}

describe('deploy.sh worktree source', () => {
  it('treats one unknown positional argument as a worktree name and deploys from its registered path', () => {
    const { root, bin, worktree } = fixture();
    const result = spawnSync('bash', [deployScript, 'named-browser-tree'], {
      encoding: 'utf8',
      env: { ...process.env, HOME: root, PATH: `${bin}:${process.env.PATH}` },
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain(`deploy source: ${worktree}`);
    expect(result.stdout).toContain(`npm:${path.join(worktree, 'server')}:pack`);
  });

  it('fails before packing when the worktree name is not registered', () => {
    const { root, bin } = fixture();
    const result = spawnSync('bash', [deployScript, 'missing-tree'], {
      encoding: 'utf8',
      env: { ...process.env, HOME: root, PATH: `${bin}:${process.env.PATH}` },
    });

    expect(result.status).toBe(1);
    expect(`${result.stdout}${result.stderr}`).toContain('worktree not found: missing-tree');
    expect(result.stdout).not.toContain('npm:');
  });
});
