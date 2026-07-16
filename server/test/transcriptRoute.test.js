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

// N alternating user/assistant messages, text = "msg-0", "msg-1", ... "msg-(N-1)" — so each message's k
// (its global ordinal) is recoverable from its own text for assertions.
const N = 15;

function fixtureSession(cwd) {
  const dir = path.join(os.homedir(), '.claude', 'projects', encodeProjectDir(cwd));
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'test-sess.jsonl');
  const lines = [];
  for (let k = 0; k < N; k++) {
    const role = k % 2 === 0 ? 'user' : 'assistant';
    lines.push(JSON.stringify({ type: role, cwd, message: { role, content: 'msg-' + k } }));
  }
  fs.writeFileSync(file, lines.join('\n') + '\n');
  return file;
}

describe('GET /api/transcript', () => {
  it('returns normalized messages for a pane', async () => {
    const cwd = path.join(os.tmpdir(), 'chatlens-fixture-' + process.pid);
    const file = fixtureSession(cwd);
    const app = express();
    app.use(transcriptRoutes({ commands: { paneCurrentPath: async () => cwd } }));
    try {
      const { status, body } = await call(app, '/transcript?pane=%25' + '0');
      expect(status).toBe(200);
      expect(body.hash).toBeTruthy();
    } finally { fs.rmSync(file, { force: true }); }
  });

  it('400 on bad pane id', async () => {
    const app = express();
    app.use(transcriptRoutes({ commands: { paneCurrentPath: async () => '/x' } }));
    const { status } = await call(app, '/transcript?pane=notapane');
    expect(status).toBe(400);
  });

  it('default limit returns only the last 10 messages, with hasMore + firstSeq', async () => {
    const cwd = path.join(os.tmpdir(), 'chatlens-fixture-limit-' + process.pid);
    const file = fixtureSession(cwd);
    const app = express();
    app.use(transcriptRoutes({ commands: { paneCurrentPath: async () => cwd } }));
    try {
      const { status, body } = await call(app, '/transcript?pane=%250');
      expect(status).toBe(200);
      expect(body.messages).toHaveLength(10);
      // Last 10 of N=15 → k = 5..14
      expect(body.messages[0].text).toBe('msg-5');
      expect(body.messages[9].text).toBe('msg-14');
      expect(body.messages[0].k).toBe(5);
      expect(body.messages[9].k).toBe(14);
      expect(body.hasMore).toBe(true);
      expect(body.firstSeq).toBe(5);
    } finally { fs.rmSync(file, { force: true }); }
  });

  it('before cursor pages the older batch (k < before)', async () => {
    const cwd = path.join(os.tmpdir(), 'chatlens-fixture-before-' + process.pid);
    const file = fixtureSession(cwd);
    const app = express();
    app.use(transcriptRoutes({ commands: { paneCurrentPath: async () => cwd } }));
    try {
      const first = await call(app, '/transcript?pane=%250');
      const firstSeq = first.body.firstSeq;
      expect(firstSeq).toBe(5);

      const { status, body } = await call(app, `/transcript?pane=%250&before=${firstSeq}&limit=10`);
      expect(status).toBe(200);
      // Older batch: k < 5 → only k = 0..4 exist (5 messages), fewer than limit.
      expect(body.messages).toHaveLength(5);
      expect(body.messages[0].k).toBe(0);
      expect(body.messages[0].text).toBe('msg-0');
      expect(body.messages[4].k).toBe(4);
      expect(body.messages[4].text).toBe('msg-4');
      expect(body.firstSeq).toBe(0);
      expect(body.hasMore).toBe(false);
      expect(body.hash).toBeUndefined();
    } finally { fs.rmSync(file, { force: true }); }
  });

  it('204 when the window hash is unchanged (not the whole file)', async () => {
    const cwd = path.join(os.tmpdir(), 'chatlens-fixture-hash-' + process.pid);
    const file = fixtureSession(cwd);
    const app = express();
    app.use(transcriptRoutes({ commands: { paneCurrentPath: async () => cwd } }));
    try {
      const first = await call(app, '/transcript?pane=%250');
      const { status } = await call(app, `/transcript?pane=%250&since=${first.body.hash}`);
      expect(status).toBe(204);
    } finally { fs.rmSync(file, { force: true }); }
  });
});
