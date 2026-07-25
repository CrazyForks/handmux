import { spawn } from 'node:child_process';
import { WebSocketServer } from 'ws';
import { tokenEquals } from './auth.js';
import { isPaneId } from './tmux/commands.js';

const MAX_BUFFERED_BYTES = 1024 * 1024;
const START_TIMEOUT_MS = 5000;

export function decodeControlData(data) {
  const bytes = [];
  for (let i = 0; i < data.length;) {
    if (data[i] === 0x5c && data[i + 1] === 0x5c) {
      bytes.push(0x5c);
      i += 2;
      continue;
    }
    if (data[i] === 0x5c && i + 3 < data.length) {
      const a = data[i + 1];
      const b = data[i + 2];
      const c = data[i + 3];
      if (a >= 0x30 && a <= 0x37 && b >= 0x30 && b <= 0x37 && c >= 0x30 && c <= 0x37) {
        bytes.push(((a - 0x30) << 6) | ((b - 0x30) << 3) | (c - 0x30));
        i += 4;
        continue;
      }
    }
    bytes.push(data[i]);
    i += 1;
  }
  return Buffer.from(bytes);
}

class PaneControlStream {
  constructor({ ws, pane, session, spawnControl = spawn }) {
    this.ws = ws;
    this.pane = pane;
    this.buffer = Buffer.alloc(0);
    this.waiters = [];
    this.response = null;
    this.phase = 'attach';
    this.pendingOutput = [];
    this.attached = new Promise((resolve, reject) => {
      this.resolveAttached = resolve;
      this.rejectAttached = reject;
    });
    this.startTimer = setTimeout(
      () => this.rejectAttached(new Error('tmux control mode attach timed out')),
      START_TIMEOUT_MS,
    );
    this.child = spawnControl('tmux', ['-C', 'attach-session', '-t', session], {
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    this.child.stdout.on('data', (chunk) => this.onChunk(chunk));
    this.child.stderr.on('data', (chunk) => { this.lastError = chunk.toString('utf8'); });
    this.child.on('error', (error) => this.fail(error));
    this.child.on('exit', (code) => {
      if (this.phase !== 'closed') this.fail(new Error(this.lastError || `tmux control mode exited (${code})`));
    });
  }

  onChunk(chunk) {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    for (;;) {
      const newline = this.buffer.indexOf(0x0a);
      if (newline < 0) break;
      const line = this.buffer.subarray(0, newline);
      this.buffer = this.buffer.subarray(newline + 1);
      this.onLine(line.at(-1) === 0x0d ? line.subarray(0, -1) : line);
    }
  }

  onLine(line) {
    if (line.subarray(0, 8).toString('ascii') === '%output ') {
      const split = line.indexOf(0x20, 8);
      if (split < 0 || line.subarray(8, split).toString('ascii') !== this.pane) return;
      const output = decodeControlData(line.subarray(split + 1));
      if (this.phase === 'buffer') this.pendingOutput.push(output);
      else if (this.phase === 'live') this.sendOutput(output);
      return;
    }
    if (line.subarray(0, 7).toString('ascii') === '%begin ') {
      this.response = { lines: [], waiter: this.waiters.shift() ?? null };
      return;
    }
    const end = line.subarray(0, 5).toString('ascii') === '%end ';
    const error = line.subarray(0, 7).toString('ascii') === '%error ';
    if (end || error) {
      const response = this.response;
      this.response = null;
      if (response?.waiter) {
        response.waiter.onEnd?.();
        if (error) response.waiter.reject(new Error(Buffer.concat(response.lines).toString('utf8')));
        else response.waiter.resolve(response.lines);
      }
      return;
    }
    if (this.response) {
      this.response.lines.push(Buffer.from(line));
      return;
    }
    if (line.subarray(0, 17).toString('ascii') === '%session-changed ') {
      clearTimeout(this.startTimer);
      this.resolveAttached();
    }
  }

  request(command, onEnd) {
    return new Promise((resolve, reject) => {
      this.waiters.push({ resolve, reject, onEnd });
      this.child.stdin.write(`${command}\n`);
    });
  }

  sendOutput(output) {
    if (this.ws.bufferedAmount > MAX_BUFFERED_BYTES) {
      this.ws.close(1013, 'stream fell behind');
      return;
    }
    this.ws.send(output, { binary: true });
  }

  async start() {
    await this.attached;
    const captureLines = await this.request(
      `capture-pane -p -e -N -t ${this.pane}`,
      () => { this.phase = 'buffer'; },
    );
    const infoLines = await this.request(
      `display-message -p -t ${this.pane} "#{pane_width}\\t#{pane_height}\\t#{cursor_x}\\t#{cursor_y}\\t#{cursor_flag}\\t#{alternate_on}"`,
    );
    const [width, height, cursorX, cursorY, cursorFlag, alternateOn] = Buffer.concat(infoLines)
      .toString('utf8').split('\t').map(Number);
    const ansi = Buffer.concat(captureLines.flatMap((line) => [line, Buffer.from('\n')])).toString('utf8');
    this.ws.send(JSON.stringify({ type: 'seed', ansi, width, height, alt: alternateOn === 1 }));
    for (const output of this.pendingOutput) this.sendOutput(output);
    this.ws.send(JSON.stringify({
      type: 'ready',
      cur: { row: height - 1 - cursorY, col: cursorX, vis: cursorFlag === 1 },
    }));
    this.pendingOutput = [];
    this.phase = 'live';
  }

  fail(error) {
    clearTimeout(this.startTimer);
    this.rejectAttached(error);
    for (const waiter of this.waiters.splice(0)) waiter.reject(error);
    if (this.ws.readyState < 2) this.ws.close(1011, 'tmux stream failed');
  }

  close() {
    clearTimeout(this.startTimer);
    this.phase = 'closed';
    try { this.child.kill(); } catch { /* already gone */ }
  }
}

export function createTerminalStream({ token, commands, spawnControl } = {}) {
  const wss = new WebSocketServer({ noServer: true });
  const streams = new Set();

  wss.on('connection', (ws) => {
    let authenticating = false;
    let stream = null;
    ws.on('message', async (raw, binary) => {
      if (binary || authenticating || stream) return;
      let message;
      try { message = JSON.parse(raw.toString()); } catch { ws.close(1003, 'bad message'); return; }
      if (message.type !== 'subscribe'
        || !tokenEquals(message.token ?? '', token)
        || !isPaneId(message.pane)) {
        ws.close(4001, 'unauthorized');
        return;
      }
      authenticating = true;
      try {
        const session = await commands.paneSession(message.pane);
        if (ws.readyState !== 1) return;
        stream = new PaneControlStream({ ws, pane: message.pane, session, spawnControl });
        streams.add(stream);
        await stream.start();
      } catch {
        if (ws.readyState < 2) ws.close(1011, 'stream setup failed');
      }
    });
    ws.on('close', () => {
      if (stream) {
        stream.close();
        streams.delete(stream);
      }
    });
  });

  const onUpgrade = (req, socket, head) => {
    let pathname;
    try { pathname = new URL(req.url, 'http://handmux.local').pathname; } catch { return false; }
    if (pathname !== '/api/terminal-stream') return false;
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
    return true;
  };

  const close = () => {
    for (const stream of streams) stream.close();
    streams.clear();
    wss.close();
  };

  return { onUpgrade, close };
}
