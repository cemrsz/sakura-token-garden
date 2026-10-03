'use strict';
// Uçtan uca: geçici klasörde sahte Claude/Codex transcriptleri oluşturur,
// izleyiciyi başlatır, sonra dosyalara satır ekleyip canlı olayların geldiğini doğrular.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { once } = require('node:events');
const { Tracker } = require('../lib/tracker');

const iso = (offset = 0) => new Date(Date.now() + offset).toISOString();

function claudeLine(id, output, offset = 0) {
  return `${JSON.stringify({
    type: 'assistant', timestamp: iso(offset), sessionId: 's1', cwd: '/work/garden', requestId: `r-${id}`,
    message: { id, model: 'claude-test', usage: { input_tokens: 1, cache_creation_input_tokens: 10, cache_read_input_tokens: 100, output_tokens: output } },
  })}\n`;
}

function codexLine(total) {
  const usage = { input_tokens: total, cached_input_tokens: 0, output_tokens: 10, total_tokens: total + 10 };
  return `${JSON.stringify({ timestamp: iso(), type: 'event_msg', payload: { type: 'token_count', info: { total_token_usage: usage, last_token_usage: usage } } })}\n`;
}

test('izleyici geçmişi okur, yeni satırları canlı yakalar', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sakura-test-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const claudeDir = path.join(root, 'claude', 'projects', 'proj');
  const codexDir = path.join(root, 'codex', 'sessions', '2026', '10', '04');
  fs.mkdirSync(claudeDir, { recursive: true });
  fs.mkdirSync(codexDir, { recursive: true });
  const claudeFile = path.join(claudeDir, 's1.jsonl');
  const codexFile = path.join(codexDir, 'rollout-test.jsonl');

  // Ufuk öncesi olay sayılmamalı; aynı mesajın ikinci bloğu tekrar sayılmamalı.
  fs.writeFileSync(claudeFile, claudeLine('old', 999, -2 * 3600_000) + claudeLine('m1', 50) + claudeLine('m1', 50));
  fs.writeFileSync(codexFile, codexLine(1000));

  const tracker = new Tracker({
    roots: { claude: [path.join(root, 'claude', 'projects')], codex: [path.join(root, 'codex', 'sessions')] },
    horizon: Date.now() - 3600_000,
  });
  await tracker.start();
  t.after(() => tracker.stop());

  assert.equal(tracker.events.length, 2);
  assert.equal(tracker.events.find((e) => e.source === 'claude').output, 50);
  assert.equal(tracker.info().claude.files, 1);

  // Yarım satır: satır sonu gelene kadar beklemeli.
  const partial = claudeLine('m2', 70);
  fs.appendFileSync(claudeFile, partial.slice(0, 40));
  await tracker.enqueue(() => tracker.readFile(claudeFile));
  assert.equal(tracker.events.length, 2);

  const live = once(tracker, 'events');
  fs.appendFileSync(claudeFile, partial.slice(40));
  fs.appendFileSync(codexFile, codexLine(3000));
  await tracker.enqueue(() => tracker.pollHot());
  const [fresh] = await Promise.race([live, new Promise((_, reject) => setTimeout(() => reject(new Error('zaman aşımı')), 4000))]);
  assert.ok(fresh.length >= 1);

  await tracker.enqueue(() => tracker.pollHot());
  const claudeEvents = tracker.events.filter((e) => e.source === 'claude');
  const codexEvents = tracker.events.filter((e) => e.source === 'codex');
  assert.deepEqual(claudeEvents.map((e) => e.output), [50, 70]);
  assert.deepEqual(codexEvents.map((e) => e.input), [1000, 2000]);
  assert.equal(claudeEvents[1].project, 'garden');

  // Yeni oturum dosyası da keşfedilmeli.
  fs.writeFileSync(path.join(claudeDir, 's2.jsonl'), claudeLine('m3', 5));
  await tracker.enqueue(() => tracker.discover());
  assert.equal(tracker.info().claude.files, 2);
  assert.equal(tracker.events.filter((e) => e.source === 'claude').length, 3);
});
