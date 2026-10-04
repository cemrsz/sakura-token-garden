// Sakura Sohbet Bahçesi — arka plan (service worker).
// claude.ai sekmelerinden gelen ölçümleri kuyruğa alır ve bilgisayardaki Sakura Token Bahçesi'ne
// (http://127.0.0.1:4870–4879) gönderir. Uygulama kapalıysa ölçümler kuyrukta bekler ve dakikada
// bir yeniden denenir; uygulama açıldığında hepsi sırayla aktarılır.

const APP_ID = 'sakura-token-garden';
const PORTS = Array.from({ length: 10 }, (_, index) => 4870 + index);
const MAX_QUEUE = 2000;
const BATCH = 100;
const ALARM = 'sakura-flush';
const CLAUDE_PAGE = /^https:\/\/claude\.ai\//;

// Depolama okuma-yazmaları sırayla yapılır; aynı anda gelen iki ölçüm birbirini ezmez.
let chain = Promise.resolve();
const serial = (task) => {
  const run = chain.then(task);
  chain = run.catch(() => {});
  return run;
};

const store = {
  get: (keys) => chrome.storage.local.get(keys),
  set: (items) => chrome.storage.local.set(items),
};

function dayKey(ts = Date.now()) {
  const date = new Date(ts);
  const pad = (value) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

const count = (value) => (Number.isFinite(value) && value > 0 ? Math.round(value) : 0);
const text = (value, max) => (typeof value === 'string' ? value.slice(0, max) : '');

function sanitize(raw) {
  if (!raw || typeof raw !== 'object' || typeof raw.id !== 'string' || !raw.id) return null;
  let usage = null;
  if (raw.usage && typeof raw.usage === 'object') {
    for (const [key, value] of Object.entries(raw.usage)) {
      if (/^(input|output|cache_creation_input|cache_read_input)_tokens$/.test(key) && Number.isFinite(value)) usage = { ...usage, [key]: count(value) };
    }
  }
  return {
    id: text(raw.id, 160),
    ts: Number.isFinite(raw.ts) ? raw.ts : Date.now(),
    conversation: text(raw.conversation, 80),
    title: text(raw.title, 120),
    model: text(raw.model, 60),
    host: text(raw.host, 60),
    inputChars: count(raw.inputChars),
    contextChars: count(raw.contextChars),
    toolChars: count(raw.toolChars),
    outputChars: count(raw.outputChars),
    thinkingChars: count(raw.thinkingChars),
    usage,
  };
}

async function findServer(preferred) {
  const order = [preferred, ...PORTS.filter((port) => port !== preferred)].filter(Boolean);
  for (const port of order) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/health`, { cache: 'no-store', signal: AbortSignal.timeout(700) });
      const data = await response.json();
      if (data && data.app === APP_ID) return port;
    } catch {
      // Bu portta Sakura yok.
    }
  }
  return null;
}

async function enqueue(event) {
  const { queue = [], enabled = true, today } = await store.get(['queue', 'enabled', 'today']);
  if (enabled === false) return false;
  const day = dayKey();
  const stats = today && today.day === day ? today : { day, replies: 0, outputChars: 0, inputChars: 0 };
  stats.replies += 1;
  stats.outputChars += event.outputChars + event.thinkingChars;
  stats.inputChars += event.inputChars + event.toolChars;
  queue.push(event);
  await store.set({ queue: queue.slice(-MAX_QUEUE), today: stats });
  return true;
}

async function retryLater(connection) {
  await store.set({ connection: { ...connection, at: Date.now() } });
  await chrome.alarms.create(ALARM, { periodInMinutes: 1 });
}

async function flush() {
  let { queue = [], port } = await store.get(['queue', 'port']);
  if (!queue.length) {
    await chrome.alarms.clear(ALARM);
    return;
  }
  const found = await findServer(port);
  if (!found) return retryLater({ ok: false, reason: 'offline' });
  while (queue.length) {
    const batch = queue.slice(0, BATCH);
    let response;
    try {
      response = await fetch(`http://127.0.0.1:${found}/api/ingest`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ events: batch }),
      });
    } catch {
      return retryLater({ ok: false, reason: 'offline', port: found });
    }
    // 400/413/415: bu paket hiçbir zaman kabul edilmeyecek, kuyruğu tıkamasın.
    const poison = [400, 413, 415, 422].includes(response.status);
    if (!response.ok && !poison) {
      // 403/404: uygulamanın bu sürümü ölçüm kabul etmiyor; 503: demo modu.
      return retryLater({ ok: false, reason: response.status === 503 ? 'demo' : 'update', port: found });
    }
    queue = queue.slice(batch.length);
    await store.set({ queue, port: found, lastSent: Date.now(), connection: { ok: true, port: found, at: Date.now() } });
  }
  await chrome.alarms.clear(ALARM);
}

async function status() {
  const { queue = [], enabled = true, connection = null, port = null, lastSent = 0, today } = await store.get(['queue', 'enabled', 'connection', 'port', 'lastSent', 'today']);
  const day = dayKey();
  return {
    enabled: enabled !== false,
    queued: queue.length,
    connection,
    port,
    lastSent,
    today: today && today.day === day ? today : { day, replies: 0, outputChars: 0, inputChars: 0 },
  };
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (sender.id !== chrome.runtime.id || !message || typeof message !== 'object') return undefined;
  if (message.type === 'chat-event') {
    if (!sender.tab || !CLAUDE_PAGE.test(sender.url || '')) return undefined;
    const event = sanitize(message.event);
    if (event) serial(() => enqueue(event)).then((added) => added && serial(flush)).catch(() => {});
    return undefined;
  }
  if (message.type === 'status') {
    serial(flush).catch(() => {}).then(() => serial(status)).then(sendResponse, () => sendResponse(null));
    return true;
  }
  if (message.type === 'set-enabled') {
    serial(() => store.set({ enabled: Boolean(message.enabled) })).then(() => serial(status)).then(sendResponse, () => sendResponse(null));
    return true;
  }
  return undefined;
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ALARM) serial(flush).catch(() => {});
});
chrome.runtime.onStartup.addListener(() => serial(flush).catch(() => {}));
chrome.runtime.onInstalled.addListener(() => serial(flush).catch(() => {}));
