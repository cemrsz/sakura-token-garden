'use strict';
// Tarayıcı eklentisi: ölçer (meter.js) sahte bir claude.ai sayfasında, arka plan (background.js)
// sahte chrome API'siyle çalıştırılır. Arka planın ağı yalnızca bu testin açtığı sunucuya
// yönlendirilir; bilgisayarda çalışan gerçek Sakura uygulamasına (4870) hiçbir istek gitmez.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');

const EXT = path.join(__dirname, '..', 'browser-extension');
const ORG = '/api/organizations/0b1c2d3e-0000-4000-8000-000000000001';
const CONV = '6f1d2c3b-4a59-4e68-8d7c-0123456789ab';

const waitFor = async (check, label, ms = 3000) => {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    const value = await check();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 15));
  }
  throw new Error(`zaman aşımı: ${label}`);
};

// Akışı küçük parçalar hâlinde, okundukça verir (çok baytlı harfler de ikiye bölünür).
// fail: yanıtın yarısında bağlantı kesilir (kullanıcı "Durdur"a bastı).
function sseResponse(events, { chunk = 7, fail = false } = {}) {
  const bytes = Buffer.from(events.map((event) => `event: ${event.type}\r\ndata: ${JSON.stringify(event)}\r\n\r\n`).join(''));
  const end = fail ? Math.floor(bytes.length / 2) : bytes.length;
  let offset = 0;
  const stream = new ReadableStream({
    // Ağdaki gibi parçalar arasında olay döngüsüne söz verilir; ölçer akışa yetişir.
    async pull(controller) {
      await new Promise((resolve) => setImmediate(resolve));
      if (offset >= end) {
        if (fail) controller.error(new Error('kullanıcı durdurdu'));
        else controller.close();
        return;
      }
      controller.enqueue(new Uint8Array(bytes.subarray(offset, Math.min(end, offset + chunk))));
      offset += chunk;
    },
  });
  return new Response(stream, { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
}

function loadMeter(route) {
  const posted = [];
  const window = {
    location: { origin: 'https://claude.ai', host: 'claude.ai' },
    fetch: async (input, init) => route(typeof input === 'string' ? input : input.url, init || {}),
    // Tarayıcıdaki gibi ileti kopyalanır (structured clone).
    postMessage: (message, origin) => posted.push({ ...structuredClone(message), origin }),
  };
  vm.runInContext(fs.readFileSync(path.join(EXT, 'meter.js'), 'utf8'), vm.createContext({ window, TextDecoder }));
  return { window, posted };
}

const conversationJson = {
  uuid: CONV,
  name: 'Tatil planı',
  model: 'claude-sohbet',
  current_leaf_message_uuid: 'm4',
  chat_messages: [
    { uuid: 'm1', parent_message_uuid: '00000000-0000-4000-8000-000000000000', sender: 'human', content: [{ type: 'text', text: 'a'.repeat(100) }], attachments: [{ extracted_content: 'b'.repeat(50) }] },
    { uuid: 'm2', parent_message_uuid: 'm1', sender: 'assistant', content: [{ type: 'thinking', thinking: 'x'.repeat(999) }, { type: 'text', text: 'c'.repeat(200) }] },
    // Düzenlenip bırakılmış dal bağlama girmez.
    { uuid: 'm3', parent_message_uuid: 'm1', sender: 'assistant', content: [{ type: 'text', text: 'z'.repeat(5000) }] },
    { uuid: 'm4', parent_message_uuid: 'm2', sender: 'human', text: 'd'.repeat(30) },
  ],
};

const replyEvents = [
  { type: 'message_start', message: { id: 'chatcompl_1', uuid: 'resp-1', model: 'claude-yanit', content: [] } },
  { type: 'content_block_start', index: 0, content_block: { type: 'thinking', thinking: '' } },
  { type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: 'düşünüyorum' } },
  { type: 'content_block_delta', index: 0, delta: { type: 'thinking_summary_delta', summary: { summary: 'sayılmaz' } } },
  { type: 'content_block_start', index: 1, content_block: { type: 'text', text: '' } },
  { type: 'content_block_delta', index: 1, delta: { type: 'text_delta', text: 'Merhaba! ' } },
  { type: 'content_block_delta', index: 1, delta: { type: 'text_delta', text: 'Çiçekler ğüşiöç açıyor.' } },
  { type: 'content_block_start', index: 2, content_block: { type: 'tool_use', name: 'web_search', input: {} } },
  { type: 'content_block_delta', index: 2, delta: { type: 'input_json_delta', partial_json: '{"q":"ume"}' } },
  { type: 'content_block_start', index: 3, content_block: { type: 'tool_result', content: [{ type: 'knowledge', title: 'Ume', text: 'r'.repeat(40) }] } },
  { type: 'message_delta', delta: { stop_reason: 'end_turn' } },
  { type: 'message_limit', message_limit: { type: 'within_limit' } },
  { type: 'message_stop' },
];
const REPLY_OUTPUT = 'Merhaba! '.length + 'Çiçekler ğüşiöç açıyor.'.length + '{"q":"ume"}'.length;

test('ölçer: geçmiş, istek ve yanıt akışı karakterlere çevrilir; sayfa yanıtı olduğu gibi alır', async () => {
  let reply = 0;
  const { window, posted } = loadMeter((url, init) => {
    if (url.endsWith(`/chat_conversations/${CONV}?tree=True&rendering_mode=messages`)) return new Response(JSON.stringify(conversationJson), { status: 200 });
    if (url.endsWith(`/chat_conversations/${CONV}/completion`) && init.method === 'POST') {
      reply += 1;
      return sseResponse(reply === 1 ? replyEvents : [
        { type: 'message_start', message: { uuid: 'resp-2', model: 'claude-yanit' } },
        { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Tamam.' } },
        { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 3 } },
      ]);
    }
    return new Response('{}', { status: 200 });
  });

  await (await window.fetch(`${ORG}/chat_conversations/${CONV}?tree=True&rendering_mode=messages`)).json();
  await new Promise((resolve) => setTimeout(resolve, 20));

  const body = JSON.stringify({ prompt: 'Selam ğüş', attachments: [{ extracted_content: 'e'.repeat(20) }], personalized_styles: [{ prompt: 'f'.repeat(10) }], files: [] });
  const page = await window.fetch(`${ORG}/chat_conversations/${CONV}/completion`, { method: 'POST', body });
  const pageText = await page.text();
  assert.match(pageText, /Çiçekler ğüşiöç açıyor/, 'sayfanın gördüğü akış bozulmamalı');
  await waitFor(() => posted.length === 1, 'ilk ölçüm');

  const [first] = posted;
  assert.equal(first.channel, 'sakura-chat-meter');
  assert.equal(first.origin, 'https://claude.ai');
  const event = first.event;
  assert.equal(event.id, `${CONV}:resp-1`);
  assert.deepEqual(
    [event.conversation, event.title, event.model, event.host],
    [CONV, 'Tatil planı', 'claude-yanit', 'claude.ai'],
  );
  assert.equal(event.contextChars, 100 + 50 + 200 + 30, 'yalnızca görünen dal, düşünme hariç');
  assert.equal(event.inputChars, 'Selam ğüş'.length + 20 + 10);
  assert.equal(event.thinkingChars, 'düşünüyorum'.length);
  assert.equal(event.outputChars, REPLY_OUTPUT);
  assert.equal(event.toolChars, 40);
  assert.equal(event.usage, null);

  // İkinci turda önceki soru, araç sonucu ve yanıt bağlama eklenmiş olur; gerçek usage taşınır.
  await (await window.fetch(`${ORG}/chat_conversations/${CONV}/completion`, { method: 'POST', body: JSON.stringify({ prompt: 'Peki?' }) })).text();
  await waitFor(() => posted.length === 2, 'ikinci ölçüm');
  const second = posted[1].event;
  assert.equal(second.contextChars, 380 + event.inputChars + 40 + REPLY_OUTPUT);
  assert.equal(second.inputChars, 5);
  assert.deepEqual(second.usage, { output_tokens: 3 });
});

test('ölçer: ilgisiz istekler ölçülmez, hatalı yanıtlar atlanır, durdurulan yanıtın ölçülen kısmı bildirilir', async () => {
  const { window, posted } = loadMeter((url, init) => {
    if (url.includes('/fail/')) return new Response('nope', { status: 500 });
    if (url.endsWith('completion') && url.includes('ffffffff')) return sseResponse(replyEvents, { fail: true });
    if (url.endsWith('completion')) {
      // Eski claude.ai akış biçimi.
      return sseResponse([{ type: 'completion', completion: 'Eski ', id: 'old-1', model: 'claude-2' }, { type: 'completion', completion: 'biçim.' }]);
    }
    return new Response(JSON.stringify({ chat_messages: [] }), { status: 200 });
  });

  await window.fetch(`${ORG}/chat_conversations?limit=30`);
  await window.fetch(`${ORG}/chat_conversations/${CONV}/title`, { method: 'POST', body: '{}' });
  await window.fetch(`${ORG}/fail/chat_conversations/${CONV}/completion`, { method: 'POST', body: '{"prompt":"x"}' });
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.equal(posted.length, 0);

  await (await window.fetch(`${ORG}/chat_conversations/${CONV}/retry_completion`, { method: 'POST', body: '{}' })).text();
  await waitFor(() => posted.length === 1, 'eski biçim');
  assert.deepEqual([posted[0].event.outputChars, posted[0].event.id, posted[0].event.model], ['Eski biçim.'.length, `${CONV}:old-1`, 'claude-2']);

  const stopped = await window.fetch(`${ORG}/chat_conversations/ffffffff-ffff-4fff-8fff-ffffffffffff/completion`, { method: 'POST', body: '{"prompt":"uzun"}' });
  await stopped.text().catch(() => {});
  await waitFor(() => posted.length === 2, 'durdurulan yanıt');
  const partial = posted[1].event;
  assert.equal(partial.inputChars, 4);
  assert.ok(partial.outputChars + partial.thinkingChars > 0 && partial.outputChars < REPLY_OUTPUT, 'yarım akış kısmen sayılır');
});

// --- Arka plan: kuyruk ve yerel uygulamaya aktarım ------------------------------------------

function loadBackground(netFetch) {
  const data = {};
  const listeners = { message: null, alarm: null };
  const alarms = new Set();
  const chrome = {
    runtime: {
      id: 'sakura-ext',
      onMessage: { addListener: (fn) => { listeners.message = fn; } },
      onStartup: { addListener: () => {} },
      onInstalled: { addListener: () => {} },
    },
    storage: {
      local: {
        get: async (keys) => Object.fromEntries(keys.filter((key) => key in data).map((key) => [key, structuredClone(data[key])])),
        set: async (items) => { Object.assign(data, structuredClone(items)); },
      },
    },
    alarms: {
      create: async (name) => { alarms.add(name); },
      clear: async (name) => alarms.delete(name),
      onAlarm: { addListener: (fn) => { listeners.alarm = fn; } },
    },
  };
  vm.runInContext(fs.readFileSync(path.join(EXT, 'background.js'), 'utf8'), vm.createContext({ chrome, fetch: netFetch, AbortSignal, console }));
  const send = (message, sender = { id: 'sakura-ext', tab: { id: 1 }, url: 'https://claude.ai/chat/x' }) => new Promise((resolve) => {
    const async = listeners.message(message, sender, resolve);
    if (!async) resolve(undefined);
  });
  return { data, alarms, listeners, send };
}

test('arka plan: ölçümler kuyruğa girer, uygulama açılınca aktarılır ve Ume ağacını büyütür', async (t) => {
  const { SakuraServer } = require('../lib/app-server');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sakura-ext-'));
  const previous = process.env.SAKURA_DATA_DIR;
  process.env.SAKURA_DATA_DIR = root;
  const server = new SakuraServer({ dataDir: path.join(root, 'data'), port: 4995, roots: { web: [path.join(root, 'claude-web')] } });
  const { port } = await server.start();
  t.after(async () => {
    await server.stop();
    if (previous === undefined) delete process.env.SAKURA_DATA_DIR;
    else process.env.SAKURA_DATA_DIR = previous;
    fs.rmSync(root, { recursive: true, force: true });
  });

  // Sahte ağ: 4873 bu testin sunucusuna gider, diğer portlar kapalıdır. "online" kapalıyken hepsi kapalı.
  let online = false;
  const calls = [];
  const netFetch = async (url, init) => {
    const target = new URL(url);
    calls.push(`${target.port}${target.pathname}`);
    if (!online || target.hostname !== '127.0.0.1' || target.port !== '4873') throw new TypeError('fetch failed');
    return fetch(`http://127.0.0.1:${port}${target.pathname}`, init);
  };
  const background = loadBackground(netFetch);
  const event = { id: `${CONV}:resp-9`, ts: Date.now(), conversation: CONV, title: 'Tatil planı', model: 'claude-test', host: 'claude.ai', inputChars: 70, contextChars: 0, toolChars: 0, outputChars: 3500, thinkingChars: 0, usage: null, extra: 'atılır' };

  // Başka bir siteden gelen ileti yok sayılır.
  await background.send({ type: 'chat-event', event }, { id: 'sakura-ext', tab: { id: 2 }, url: 'https://example.com/' });
  await background.send({ type: 'chat-event', event });
  await waitFor(() => background.alarms.has('sakura-flush'), 'yeniden deneme alarmı');
  assert.equal(background.data.queue.length, 1, 'uygulama kapalıyken ölçüm kuyrukta bekler');
  assert.equal(background.data.queue[0].extra, undefined);
  assert.equal(background.data.today.replies, 1);
  assert.equal(background.data.connection.ok, false);
  assert.ok(calls.every((call) => call.startsWith('487')), 'yalnızca 4870–4879 denenir');

  online = true;
  background.listeners.alarm({ name: 'sakura-flush' });
  await waitFor(() => background.data.queue.length === 0, 'kuyruğun boşalması');
  assert.deepEqual(background.data.connection.ok && background.data.port, 4873);
  assert.equal(background.alarms.has('sakura-flush'), false);

  await server.tracker.enqueue(() => server.tracker.discover());
  const snap = server.snapshot();
  assert.equal(snap.bySource.chat.events, 1);
  assert.equal(snap.bySource.chat.value, 1020);

  const status = await background.send({ type: 'status' }, { id: 'sakura-ext', url: 'chrome-extension://sakura-ext/popup.html' });
  assert.deepEqual([status.enabled, status.queued, status.today.replies, status.connection.port], [true, 0, 1, 4873]);

  // Ölçüm kapatılınca yeni yanıtlar kuyruğa girmez.
  await background.send({ type: 'set-enabled', enabled: false }, { id: 'sakura-ext', url: 'chrome-extension://sakura-ext/popup.html' });
  await background.send({ type: 'chat-event', event: { ...event, id: `${CONV}:resp-10` } });
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.equal(background.data.queue.length, 0);
  assert.equal(background.data.today.replies, 1);
});
