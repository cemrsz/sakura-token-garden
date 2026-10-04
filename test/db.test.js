'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { UsageDb } = require('../lib/db');
const garden = require('../lib/garden');
const { buildStats, toCsv } = require('../lib/stats');

const tokenEvent = (id, ts, source, output, extra = {}) => ({ id, ts, source, session: 's', project: 'p', model: 'm', input: 0, output, cacheWrite: 0, cacheRead: 0, ...extra });

test('veritabanı: aynı kayıt tekrar gelince çift sayılmaz, büyüyen değer güncellenir', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sakura-db-'));
  const db = new UsageDb(path.join(dir, 'test.db'));
  t.after(() => { db.close(); fs.rmSync(dir, { recursive: true, force: true }); });
  const ts = new Date(2026, 9, 4, 10).getTime();

  db.addEvents([tokenEvent('c:a', ts, 'claude', 100), tokenEvent('c:b', ts, 'claude', 50)]);
  db.addEvents([tokenEvent('c:a', ts, 'claude', 100)]);
  db.addEvents([tokenEvent('c:b', ts, 'claude', 10, { total: { input: 0, output: 80, cacheWrite: 0, cacheRead: 0 } })]);
  db.addEvents([{ id: 'v:1', ts, source: 'vscode', lines: 7, chars: 200 }]);

  const rows = db.daily('2026-10-01');
  const claude = rows.find((row) => row.source === 'claude');
  assert.equal(claude.calls, 2);
  assert.equal(claude.output, 180);
  assert.equal(rows.find((row) => row.source === 'vscode').lines, 7);
  assert.equal(db.info().events, 3);

  db.setMeta('last_run', 123);
  assert.equal(db.getMeta('last_run'), '123');
});

test('istatistik: günlük seri, pazartesi başlayan haftalar ve ölçü', () => {
  const state = garden.applySettings(garden.defaultState(), { metric: 'output', target: 1000 }, Date.now());
  const now = new Date(2026, 9, 4, 15).getTime(); // 4 Ekim 2026 Pazar
  const rows = [
    { day: '2026-10-04', source: 'claude', calls: 2, input: 5, output: 300, cacheWrite: 0, cacheRead: 0, lines: 0, chars: 0 },
    { day: '2026-10-04', source: 'vscode', calls: 4, input: 0, output: 0, cacheWrite: 0, cacheRead: 0, lines: 42, chars: 900 },
    { day: '2026-09-28', source: 'codex', calls: 1, input: 0, output: 200, cacheWrite: 0, cacheRead: 0, lines: 0, chars: 0 },
    { day: '2026-09-27', source: 'claude', calls: 1, input: 0, output: 70, cacheWrite: 0, cacheRead: 0, lines: 0, chars: 0 },
  ];
  const stats = buildStats(rows, { state, now, days: 14, weeks: 3 });
  assert.equal(stats.days.length, 14);
  assert.equal(stats.summary.today.tokens.claude, 300);
  assert.equal(stats.summary.today.lines, 42);
  // Bu hafta = 28 Eyl (Pzt) – 4 Eki (Paz); 27 Eylül geçen haftadadır.
  assert.equal(stats.summary.thisWeek.tokens.total, 500);
  assert.equal(stats.summary.lastWeek.tokens.total, 70);
  assert.equal(stats.weeks.at(-1).range, '28 Eyl – 4 Eki');

  const csv = toCsv(rows, state);
  assert.match(csv, /gun,kaynak,cagri/);
  assert.match(csv, /2026-10-04,vscode,4,0,0,0,0,0,42,900/);
});

test('istatistiklerde Claude sohbet tokenları ayrı seride', () => {
  const now = new Date(2026, 9, 4, 12).getTime();
  const rows = [
    { day: '2026-10-04', source: 'claude', calls: 2, input: 0, output: 100, cacheWrite: 0, cacheRead: 0, lines: 0, chars: 0 },
    { day: '2026-10-04', source: 'chat', calls: 1, input: 0, output: 40, cacheWrite: 0, cacheRead: 0, lines: 0, chars: 0 },
  ];
  const stats = buildStats(rows, { state: garden.applySettings(garden.defaultState(), { metric: 'output' }, now), now, days: 7, weeks: 4 });
  assert.deepEqual(stats.summary.today.tokens, { total: 140, claude: 100, chat: 40, codex: 0 });
  assert.equal(stats.weeks.at(-1).tokens.chat, 40);
});
