import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Fresh temp store per test, imported dynamically so the module re-reads NOTIF_STORE.
async function freshModule() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'notif-'));
  process.env.NOTIF_STORE = path.join(dir, 'notifications.json');
  const mod = await import(`../src/notifications.js?t=${Date.now()}-${Math.random()}`);
  return { mod, file: process.env.NOTIF_STORE };
}

test('record appends and list returns newest-first', async () => {
  const { mod } = await freshModule();
  mod.record({ title: 'a', body: '1' });
  mod.record({ title: 'b', body: '2' });
  const items = mod.list();
  assert.equal(items.length, 2);
  assert.equal(items[0].title, 'b'); // newest first
  assert.equal(items[1].title, 'a');
  assert.ok(items[0].id && typeof items[0].ts === 'number');
});

test('ring buffer keeps only the last 100', async () => {
  const { mod } = await freshModule();
  for (let i = 0; i < 130; i++) mod.record({ title: `t${i}`, body: 'x' });
  const items = mod.list();
  assert.equal(items.length, 100);
  assert.equal(items[0].title, 't129'); // newest
  assert.equal(items[99].title, 't30'); // oldest kept (dropped t0..t29)
});

test('remove deletes by id', async () => {
  const { mod } = await freshModule();
  const rec = mod.record({ title: 'a', body: '1' });
  mod.record({ title: 'b', body: '2' });
  assert.equal(mod.remove(rec.id), true);
  assert.equal(mod.remove('nope'), false);
  assert.deepEqual(mod.list().map((n) => n.title), ['b']);
});

test('tag is stored only when present', async () => {
  const { mod } = await freshModule();
  mod.record({ title: 'a', body: '1' });
  mod.record({ title: 'b', body: '2', tag: 'build' });
  const [b, a] = mod.list();
  assert.equal(a.tag, undefined);
  assert.equal(b.tag, 'build');
});

test('corrupt store file degrades to empty at load', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'notif-corrupt-'));
  const file = path.join(dir, 'notifications.json');
  fs.writeFileSync(file, 'not json at all');
  process.env.NOTIF_STORE = file;
  const mod = await import(`../src/notifications.js?t=${Date.now()}-corrupt`);
  assert.deepEqual(mod.list(), []); // bad file → readJsonArray returns [], never throws
  mod.record({ title: 'x', body: 'y' }); // and it recovers: recording works over the bad file
  assert.equal(mod.list().length, 1);
});
