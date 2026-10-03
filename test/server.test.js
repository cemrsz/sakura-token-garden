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
