'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createClaudeParser, createCodexFileState, parseCodexLine } = require('../lib/parsers');

const claudeLine = ({ id = 'msg_1', requestId = 'req_1', usage, model = 'claude-test', type = 'assistant', cwd = 'C:\\work\\demo' }) => JSON.stringify({
  type,
  timestamp: '2026-10-04T10:00:00.000Z',
  sessionId: 'session-1',
  cwd,
  requestId,
  message: { id, model, usage },
});

const usage = (input, cacheWrite, cacheRead, output) => ({
  input_tokens: input,
  cache_creation_input_tokens: cacheWrite,
  cache_read_input_tokens: cacheRead,
  output_tokens: output,
});

test('Claude: usage alanları olaya çevrilir', () => {
  const parse = createClaudeParser();
  const event = parse(claudeLine({ usage: usage(2, 300, 4000, 150) }));
  assert.equal(event.source, 'claude');
  assert.equal(event.project, 'demo');
  assert.equal(event.session, 'session-1');
  assert.deepEqual([event.input, event.cacheWrite, event.cacheRead, event.output], [2, 300, 4000, 150]);
});

test('Claude: aynı mesajın içerik blokları bir kez sayılır', () => {
  const parse = createClaudeParser();
  const line = claudeLine({ usage: usage(2, 300, 4000, 150) });
  assert.ok(parse(line));
  assert.equal(parse(line), null);
  assert.equal(parse(line), null);
});

test('Claude: aynı mesaj daha büyük değerle gelirse yalnız fark sayılır', () => {
  const parse = createClaudeParser();
  parse(claudeLine({ usage: usage(2, 300, 4000, 10) }));
  const delta = parse(claudeLine({ usage: usage(2, 300, 4000, 150) }));
  assert.deepEqual([delta.input, delta.cacheWrite, delta.cacheRead, delta.output], [0, 0, 0, 140]);
});

test('Claude: farklı istekler ayrı sayılır, alakasız satırlar atlanır', () => {
  const parse = createClaudeParser();
  assert.ok(parse(claudeLine({ id: 'a', usage: usage(1, 0, 0, 5) })));
  assert.ok(parse(claudeLine({ id: 'b', usage: usage(1, 0, 0, 5) })));
  assert.equal(parse(claudeLine({ type: 'user', id: 'c', usage: usage(1, 0, 0, 5) })), null);
  assert.equal(parse(claudeLine({ id: 'd', model: '<synthetic>', usage: usage(0, 0, 0, 0) })), null);
  assert.equal(parse('{"type":"summary"}'), null);
  assert.equal(parse('bozuk json "usage"'), null);
});

const codexLine = (total, last, ts = '2026-10-04T10:00:00.000Z') => JSON.stringify({
  timestamp: ts,
  type: 'event_msg',
  payload: { type: 'token_count', info: { total_token_usage: total, last_token_usage: last } },
});
const codexUsage = (input, cached, output) => ({ input_tokens: input, cached_input_tokens: cached, output_tokens: output, total_tokens: input + output });

test('Codex: kümülatif toplamlar farka çevrilir, tekrarlar atlanır', () => {
  const state = createCodexFileState({ session: 'x' });
  parseCodexLine(JSON.stringify({ type: 'session_meta', payload: { id: 'sess-9', cwd: '/home/me/proj' } }), state);

  const first = parseCodexLine(codexLine(codexUsage(1000, 600, 50), codexUsage(1000, 600, 50)), state);
  assert.equal(first.session, 'sess-9');
  assert.equal(first.project, 'proj');
  assert.deepEqual([first.input, first.cacheRead, first.output], [400, 600, 50]);

  assert.equal(parseCodexLine(codexLine(codexUsage(1000, 600, 50), codexUsage(1000, 600, 50)), state), null);

  const second = parseCodexLine(codexLine(codexUsage(2500, 1800, 120), codexUsage(1500, 1200, 70)), state);
  assert.deepEqual([second.input, second.cacheRead, second.output], [300, 1200, 70]);
});

test('Codex: devralınmış toplam ilk olayda sayılmaz (resume)', () => {
  const state = createCodexFileState();
  const event = parseCodexLine(codexLine(codexUsage(900000, 800000, 9000), codexUsage(5000, 4000, 100)), state);
  assert.deepEqual([event.input, event.cacheRead, event.output], [1000, 4000, 100]);
});

test('Codex: sayaç sıfırlanırsa son tur kullanılır', () => {
  const state = createCodexFileState();
  parseCodexLine(codexLine(codexUsage(5000, 0, 100), codexUsage(5000, 0, 100)), state);
  const event = parseCodexLine(codexLine(codexUsage(300, 0, 20), codexUsage(300, 0, 20)), state);
  assert.deepEqual([event.input, event.output], [300, 20]);
});

test('olaylar kalıcı ve tekil id taşır; aynı satır tekrar okununca aynı id çıkar', () => {
  const first = createClaudeParser()(claudeLine({ id: 'msg_9', requestId: 'req_9', usage: usage(1, 2, 3, 4) }));
  const again = createClaudeParser()(claudeLine({ id: 'msg_9', requestId: 'req_9', usage: usage(1, 2, 3, 4) }));
  assert.equal(first.id, 'c:msg_9:req_9');
  assert.equal(first.id, again.id);
  assert.deepEqual(first.total, { input: 1, output: 4, cacheWrite: 2, cacheRead: 3 });

  const state = createCodexFileState({ session: 's' });
  const codex = parseCodexLine(codexLine(codexUsage(100, 0, 10), codexUsage(100, 0, 10)), state);
  assert.equal(codex.id, 'x:s:110');
});

test('VS Code satır kayıtları okunur', () => {
  const { parseVscodeLine } = require('../lib/parsers');
  const event = parseVscodeLine(JSON.stringify({ id: 'w1-5-1', ts: 1790000000000, window: 'w1', project: 'demo', language: 'javascript', lines: 3, chars: 90 }));
  assert.equal(event.source, 'vscode');
  assert.equal(event.id, 'v:w1-5-1');
  assert.deepEqual([event.lines, event.chars, event.project, event.model], [3, 90, 'demo', 'javascript']);
  assert.equal(parseVscodeLine('{"id":"x","ts":1,"lines":0,"chars":0}'), null);
  assert.equal(parseVscodeLine('bozuk "lines"'), null);
});
