// NOTE: this project's server suite runs on VITEST (describe/it/expect), not node:test.
import { describe, it, expect } from 'vitest';
import express from 'express';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { transcriptRoutes } from '../src/routes/transcript.js';
import { encodeProjectDir } from '../src/agents/scanUtils.js';

async function call(app, url) {
  const server = app.listen(0);
  const { port } = server.address();
  try {
    const res = await fetch(`http://127.0.0.1:${port}${url}`);
    const body = res.status === 204 ? null : await res.json();
    return { status: res.status, body };
  } finally { server.close(); }
}

function fixtureSession(cwd) {
  const dir = path.join(os.homedir(), '.claude', 'projects', encodeProjectDir(cwd));
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'test-sess.jsonl');
  fs.writeFileSync(file, [
    JSON.stringify({ type: 'user', cwd, message: { role: 'user', content: '嗨' } }),
  ].join('\n') + '\n');
  return file;
}

describe('GET /api/transcript', () => {
  it('returns normalized messages for a pane', async () => {
    const cwd = path.join(os.tmpdir(), 'chatlens-fixture-' + process.pid);
    const file = fixtureSession(cwd);
    const app = express();
    app.use(transcriptRoutes({ commands: { paneCwd: async () => cwd } }));
    try {
      const { status, body } = await call(app, '/transcript?pane=%25' + '0');
      expect(status).toBe(200);
      expect(body.messages[0].text).toBe('嗨');
      expect(body.hash).toBeTruthy();
    } finally { fs.rmSync(file, { force: true }); }
  });

  it('400 on bad pane id', async () => {
    const app = express();
    app.use(transcriptRoutes({ commands: { paneCwd: async () => '/x' } }));
    const { status } = await call(app, '/transcript?pane=notapane');
    expect(status).toBe(400);
  });
});
