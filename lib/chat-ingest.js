'use strict';
// Tarayıcı eklentisinden (browser-extension/) gelen claude.ai ölçümlerini doğrular ve
// claude-web klasörüne günlük JSONL dosyaları olarak yazar. İzleyici bu klasörü okur; böylece
// masaüstü uygulaması ile tarayıcı sürümü aynı kayıtları görür ve veritabanına aktarım
// diğer kaynaklarla aynı yoldan geçer. Yalnızca sayılar, model adı ve sohbet başlığı saklanır;
// mesaj içeriği eklentiden hiç çıkmaz.

const fs = require('node:fs');
const path = require('node:path');
const { dayKey } = require('./garden');

const MAX_EVENTS = 200;
const MAX_COUNT = 20_000_000;
// Uygulama kapalıyken eklenti ölçümleri kuyrukta bekletir; bir aydan eskisi kabul edilmez.
const MAX_AGE = 30 * 24 * 60 * 60 * 1000;
const USAGE_FIELDS = ['input_tokens', 'output_tokens', 'cache_creation_input_tokens', 'cache_read_input_tokens'];

const clean = (value, max) => String(value == null ? '' : value).replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, max);
const count = (value) => {
  const n = Math.round(Number(value));
  return Number.isFinite(n) && n > 0 ? Math.min(n, MAX_COUNT) : 0;
};

function sanitizeChatEvent(raw, now = Date.now()) {
  if (!raw || typeof raw !== 'object') return null;
  const id = clean(raw.id, 160);
  if (!/^[\w.:-]{3,160}$/.test(id)) return null;
  const ts = Number(raw.ts);
  if (!Number.isFinite(ts) || ts < now - MAX_AGE || ts > now + 5 * 60 * 1000) return null;
  let usage = null;
  if (raw.usage && typeof raw.usage === 'object') {
    for (const field of USAGE_FIELDS) {
      const n = Number(raw.usage[field]);
      if (Number.isFinite(n) && n >= 0) usage = { ...usage, [field]: Math.min(Math.round(n), MAX_COUNT) };
    }
  }
  const event = {
    id,
    ts: Math.round(ts),
    conversation: clean(raw.conversation, 80),
    title: clean(raw.title, 120),
    model: clean(raw.model, 60),
    host: clean(raw.host, 60),
    inputChars: count(raw.inputChars),
    contextChars: count(raw.contextChars),
    toolChars: count(raw.toolChars),
    outputChars: count(raw.outputChars),
    thinkingChars: count(raw.thinkingChars),
    usage,
  };
  if (!event.inputChars && !event.toolChars && !event.outputChars && !event.thinkingChars && !usage) return null;
  return event;
}

function appendChatEvents(dir, events) {
  const byFile = new Map();
  for (const event of events) {
    const file = path.join(dir, `${dayKey(event.ts)}.jsonl`);
    byFile.set(file, (byFile.get(file) || '') + `${JSON.stringify(event)}\n`);
  }
  fs.mkdirSync(dir, { recursive: true });
  for (const [file, text] of byFile) fs.appendFileSync(file, text);
}

// body: { events: [...] } → geçerli olanlar diske yazılır.
function ingestChat(dir, body, now = Date.now()) {
  const list = body && Array.isArray(body.events) ? body.events.slice(0, MAX_EVENTS) : [];
  const events = list.map((raw) => sanitizeChatEvent(raw, now)).filter(Boolean);
  if (events.length) appendChatEvents(dir, events);
  return { received: list.length, accepted: events.length };
}

module.exports = { sanitizeChatEvent, appendChatEvents, ingestChat, MAX_EVENTS };
