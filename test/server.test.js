'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { SakuraServer } = require('../lib/app-server');

test('sunucu anlık görüntüsü: 7 günlük bahçe dizisi ve Bahçem bilgisi ayrı alanlarda', async (t) => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sakura-srv-'));
  const server = new SakuraServer({ demo: true, dataDir, port: 4970 });
  const started = await server.start();
  t.after(async () => {
    await server.stop();
    fs.rmSync(dataDir, { recursive: true, force: true });
  });
  assert.ok(started.port >= 4970);

  const snap = server.snapshot();
  assert.ok(Array.isArray(snap.garden), 'garden: 7 günlük / sezon dizisi');
  assert.deepEqual(snap.gardenInfo, { count: 0, autoPlanted: undefined });
  assert.ok(snap.db && Number.isFinite(snap.db.revision));

  // Hazır olmayan ağaç dikilemez.
  assert.equal(server.plantTree('claude').status, 409);

  const stats = server.stats(14, 4);
  assert.equal(stats.available, true);
  assert.equal(stats.days.length, 14);
  assert.equal(stats.weeks.length, 4);
});

test('eklenti ölçümleri /api/ingest ile alınır, Claude sohbet ağacını büyütür', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sakura-ingest-'));
  const previous = process.env.SAKURA_DATA_DIR;
  process.env.SAKURA_DATA_DIR = root;
  const server = new SakuraServer({ dataDir: path.join(root, 'data'), port: 4975, roots: { web: [path.join(root, 'claude-web')] } });
  const { port } = await server.start();
  t.after(async () => {
    await server.stop();
    if (previous === undefined) delete process.env.SAKURA_DATA_DIR;
    else process.env.SAKURA_DATA_DIR = previous;
    fs.rmSync(root, { recursive: true, force: true });
  });

  const post = (pathname, body, headers = {}) => fetch(`http://127.0.0.1:${port}${pathname}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: 'chrome-extension://abcdefghijklmnop', ...headers },
    body: JSON.stringify(body),
  });
  const measured = { id: 'conv-1:msg-1', ts: Date.now(), conversation: 'conv-1', title: 'Deneme', model: 'claude-test', inputChars: 70, contextChars: 0, outputChars: 3500, thinkingChars: 0, usage: null };

  const response = await post('/api/ingest', { events: [measured, { id: 'kötü id!', ts: Date.now(), outputChars: 5 }] });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true, received: 2, accepted: 1 });
  const files = fs.readdirSync(path.join(root, 'claude-web'));
  assert.equal(files.length, 1);
  assert.match(files[0], /^\d{4}-\d{2}-\d{2}\.jsonl$/);

  await server.tracker.enqueue(() => server.tracker.discover());
  const snap = server.snapshot();
  assert.equal(snap.bySource.chat.events, 1);
  assert.equal(snap.bySource.chat.value, 1020); // 20 girdi + 1000 çıktı tokenı (ağırlıklı)
  assert.ok(snap.trees.some((tree) => tree.id === 'chat'));
  assert.equal(server.db.totals().find((row) => row.source === 'chat').output, 1000);

  // Eklenti kökeni ayarlara dokunamaz; başka siteler ve JSON olmayan istekler reddedilir.
  assert.equal((await post('/api/settings', { target: 1000 })).status, 403);
  assert.equal((await post('/api/ingest', { events: [measured] }, { Origin: 'https://example.com' })).status, 403);
  assert.equal((await post('/api/ingest', { events: [measured] }, { 'Content-Type': 'text/plain' })).status, 415);
});

test('demo sunucusu eklenti ölçümlerini diske yazmaz', async (t) => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sakura-demo-ingest-'));
  const server = new SakuraServer({ demo: true, dataDir, port: 4985 });
  const { port } = await server.start();
  t.after(async () => {
    await server.stop();
    fs.rmSync(dataDir, { recursive: true, force: true });
  });
  const response = await fetch(`http://127.0.0.1:${port}/api/ingest`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"events":[]}' });
  assert.equal(response.status, 503);
});

test('istek gövdesinde ikiye bölünen Türkçe harf bozulmaz', async (t) => {
  const http = require('node:http');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sakura-utf8-'));
  const previous = process.env.SAKURA_DATA_DIR;
  process.env.SAKURA_DATA_DIR = root;
  const server = new SakuraServer({ dataDir: path.join(root, 'data'), port: 4990, roots: { web: [path.join(root, 'claude-web')] } });
  const { port } = await server.start();
  t.after(async () => {
    await server.stop();
    if (previous === undefined) delete process.env.SAKURA_DATA_DIR;
    else process.env.SAKURA_DATA_DIR = previous;
    fs.rmSync(root, { recursive: true, force: true });
  });

  const title = 'Ümit ğüşiöç çiçeği';
  const body = Buffer.from(JSON.stringify({ events: [{ id: 'c:utf8', ts: Date.now(), conversation: 'c', title, outputChars: 70 }] }));
  const cut = body.indexOf(Buffer.from('ğ')) + 1; // iki baytlık harfin ortası
  const status = await new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path: '/api/ingest', method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': body.length } }, (res) => {
      res.resume();
      res.on('end', () => resolve(res.statusCode));
    });
    req.on('error', reject);
    req.write(body.subarray(0, cut));
    setTimeout(() => req.end(body.subarray(cut)), 30);
  });
  assert.equal(status, 200);
  const [file] = fs.readdirSync(path.join(root, 'claude-web'));
  assert.equal(JSON.parse(fs.readFileSync(path.join(root, 'claude-web', file), 'utf8').trim()).title, title);
});
