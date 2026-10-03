'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const garden = require('../lib/garden');

const event = (ts, source, fields = {}) => ({
  ts, source, session: `${source}-1`, project: 'demo', model: 'm',
  input: 0, output: 0, cacheWrite: 0, cacheRead: 0, ...fields,
});

test('ağırlıklı ölçü önbellek okumayı %10 sayar', () => {
  const value = garden.METRICS.weighted.value(event(0, 'claude', { input: 10, output: 20, cacheWrite: 30, cacheRead: 1000 }));
  assert.equal(value, 160);
});

test('günlük sezon yalnızca bugünün olaylarını sayar ve ilerlemeyi hesaplar', () => {
  const now = new Date(2026, 9, 4, 15, 0).getTime();
  const state = garden.applySettings(garden.defaultState(), { target: 1000, metric: 'output' }, now);
  const events = [
    event(new Date(2026, 9, 3, 23, 0).getTime(), 'claude', { output: 999 }),
    event(new Date(2026, 9, 4, 9, 0).getTime(), 'claude', { output: 300 }),
    event(new Date(2026, 9, 4, 14, 58).getTime(), 'codex', { output: 200 }),
  ];
  const snap = garden.snapshot(state, events, now);
  assert.equal(snap.value, 500);
  assert.equal(snap.progress, 0.5);
  assert.equal(snap.bySource.claude.value, 300);
  assert.equal(snap.bySource.codex.value, 200);
  assert.equal(snap.garden.length, 7);
  assert.equal(snap.garden[5].value, 999);
  assert.equal(snap.garden[6].current, true);
  assert.equal(snap.rate, 40); // son 5 dakikada 200 çıktı tokenı
});

test('kapatılan kaynak sayılmaz', () => {
  const now = Date.now();
  const state = garden.applySettings(garden.defaultState(), { metric: 'output', sources: { codex: false } }, now);
  const snap = garden.snapshot(state, [event(now - 1000, 'claude', { output: 10 }), event(now - 1000, 'codex', { output: 90 })], now);
  assert.equal(snap.value, 10);
});

test('ölçü değişince hedef o ölçünün varsayılanına döner', () => {
  const state = garden.applySettings(garden.defaultState(), { metric: 'output' }, Date.now());
  assert.equal(state.target, garden.METRICS.output.target);
  const custom = garden.applySettings(state, { metric: 'all', target: 12345 }, Date.now());
  assert.equal(custom.target, 12345);
});

test('yeni tohum geçmişe yazar ve şimdiden başlayan manuel sezon açar', () => {
  const now = Date.now();
  const before = garden.defaultState();
  const next = garden.replant(before, now, 1_500_000);
  assert.equal(next.mode, 'manual');
  assert.equal(next.manualStart, now);
  assert.equal(next.history.length, 1);
  assert.equal(next.history[0].value, 1_500_000);
  const snap = garden.snapshot(next, [event(now - 5000, 'claude', { output: 100 }), event(now + 1000, 'claude', { output: 100 })], now + 2000);
  assert.equal(snap.events, 1);
  assert.equal(snap.garden.at(-1).label, 'Şimdi');
  assert.equal(snap.garden.length, 2);
});

test('geçersiz ayarlar yok sayılır', () => {
  const state = garden.applySettings(garden.defaultState(), { target: -5, metric: 'yok', mode: 'haftalık', sources: { claude: 'evet' } }, Date.now());
  assert.deepEqual(state, garden.defaultState());
});

test('her AI kendi ağacını alır; yalnızca bu sezon harcayanlar dikilir', () => {
  const now = new Date(2026, 9, 4, 15, 0).getTime();
  const state = garden.applySettings(garden.defaultState(), { metric: 'output', target: 1000 }, now);
  const yesterday = new Date(2026, 9, 3, 12, 0).getTime();

  // Dün yalnızca Codex, bugün yalnızca Claude: bugünün bahçesinde tek Sakura.
  let snap = garden.snapshot(state, [event(yesterday, 'codex', { output: 50 }), event(now - 60_000, 'claude', { output: 400 })], now);
  assert.deepEqual(snap.trees.map((t) => t.id), ['claude']);
  assert.equal(snap.trees[0].progress, 0.4);
  assert.equal(snap.focus, 'claude');

  // Codex de çalışmaya başlarsa yanına Momiji dikilir; odak en son çalışan AI'dadır.
  snap = garden.snapshot(state, [event(now - 60_000, 'claude', { output: 400 }), event(now - 1000, 'codex', { output: 250 })], now);
  assert.deepEqual(snap.trees.map((t) => [t.id, t.value]), [['claude', 400], ['codex', 250]]);
  assert.equal(snap.focus, 'codex');

  // Bugün hiç token yoksa en son kullanılan AI'ın tohumu görünür.
  snap = garden.snapshot(state, [event(yesterday, 'codex', { output: 50 })], now);
  assert.deepEqual(snap.trees.map((t) => [t.id, t.progress]), [['codex', 0]]);
});

test('tek ağaç modunda tüm tokenlar toplanır, türü en çok harcayan AI belirler', () => {
  const now = Date.now();
  const state = garden.applySettings(garden.defaultState(), { metric: 'output', target: 1000, layout: 'single' }, now);
  const snap = garden.snapshot(state, [event(now - 5000, 'claude', { output: 100 }), event(now - 4000, 'codex', { output: 300 })], now);
  assert.equal(snap.trees.length, 1);
  assert.equal(snap.trees[0].id, 'codex');
  assert.equal(snap.trees[0].value, 400);
  assert.equal(snap.trees[0].combined, true);
});

test('VS Code ağacı satırla ve kendi hedefiyle büyür', () => {
  const now = Date.now();
  const state = garden.applySettings(garden.defaultState(), { metric: 'output', target: 1000, codeTarget: 100 }, now);
  const snap = garden.snapshot(state, [
    event(now - 5000, 'claude', { output: 500 }),
    { ...event(now - 1000, 'vscode'), lines: 25, chars: 700 },
  ], now);
  const code = snap.trees.find((tree) => tree.id === 'vscode');
  assert.equal(code.unit, 'lines');
  assert.equal(code.value, 25);
  assert.equal(code.progress, 0.25);
  assert.equal(snap.value, 500); // satırlar token toplamına karışmaz
  assert.equal(snap.focus, 'vscode');
  assert.equal(snap.settings.codeTarget, 100);
  assert.deepEqual(snap.settings.codePresets, [50, 100, 250, 1000, 5000]);
});

test('bahçeye dikme: hedef kadar değer düşülür, fazlası yeni ağaca devreder', () => {
  const now = Date.now();
  let state = garden.applySettings(garden.defaultState(), { metric: 'output', target: 1000 }, now);
  const events = [event(now - 1000, 'claude', { output: 2300 })];
  let snap = garden.snapshot(state, events, now);
  assert.equal(snap.trees[0].progress, 2.3);

  state = garden.harvest(state, 'claude', 1000, now);
  snap = garden.snapshot(state, events, now);
  assert.equal(snap.trees[0].value, 1300);
  assert.equal(snap.trees[0].planted, 1);
  assert.equal(snap.bySource.claude.value, 2300, 'kaynak toplamı değişmez, yalnızca ağaç ilerlemesi');

  // Sezon değişince ofsetler geçerliliğini yitirir.
  const tomorrow = now + garden.DAY;
  snap = garden.snapshot(state, [event(tomorrow - 1000, 'claude', { output: 100 })], tomorrow);
  assert.equal(snap.trees[0].value, 100);
});

test('kapanan sezonda tamamlanmış ama dikilmemiş ağaçlar hesaplanır', () => {
  const now = Date.now();
  let state = garden.applySettings(garden.defaultState(), { metric: 'output', target: 1000, codeTarget: 50 }, now);
  const key = garden.season(state, now).key;
  state = garden.harvest(state, 'claude', 1000, now);
  const totals = [
    { source: 'claude', input: 0, output: 3200, cacheWrite: 0, cacheRead: 0, lines: 0 },
    { source: 'codex', input: 0, output: 900, cacheWrite: 0, cacheRead: 0, lines: 0 },
    { source: 'vscode', input: 0, output: 0, cacheWrite: 0, cacheRead: 0, lines: 130 },
  ];
  const trees = garden.completedTrees(state, totals, key);
  assert.deepEqual(trees.map((tree) => [tree.source, tree.count, tree.unit]), [['claude', 2, 'tokens'], ['vscode', 2, 'lines']]);
});
