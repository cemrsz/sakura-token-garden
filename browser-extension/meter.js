// Sakura Sohbet Bahçesi — claude.ai sayfasında çalışan ölçer (sayfanın kendi dünyasında, MAIN).
//
// Sayfanın fetch çağrılarını sarar ve yalnızca iki tür yanıtın bir kopyasını okur:
//   POST …/chat_conversations/<id>/completion  -> Claude'un yanıt akışı (SSE)
//   GET  …/chat_conversations/<id>             -> sohbet geçmişi (bağlam uzunluğu için)
// Metinlerden yalnızca karakter sayısı çıkarılır; içerik hiçbir yere gönderilmez. Köprü betiğine
// (bridge.js) giden ölçüm: sohbet kimliği, başlığı, model adı ve karakter sayılarıdır.
// Sayfanın aldığı yanıt değişmez: akış tee edilir, sayfa kendi kopyasını olduğu gibi okur.
(() => {
  'use strict';

  const FLAG = '__sakuraChatMeter';
  if (window[FLAG]) return;
  window[FLAG] = true;

  const CHANNEL = 'sakura-chat-meter';
  const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
  const COMPLETION = new RegExp(`/chat_conversations/(${UUID})/(?:retry_)?completion(?:[?#]|$)`, 'i');
  const CONVERSATION = new RegExp(`/chat_conversations/(${UUID})(?:[?#]|$)`, 'i');

  // Sohbet başına bilinen bağlam: geçmişin karakter uzunluğu, başlık ve model.
  const conversations = new Map();
  const conversation = (id) => {
    if (!conversations.has(id)) conversations.set(id, { context: 0, title: '', model: '' });
    return conversations.get(id);
  };

  const len = (value) => (typeof value === 'string' ? value.length : 0);

  // Bir içerik bloğundaki (ya da dizisindeki) metin, araç girdisi ve araç sonucu karakterleri.
  // Düşünme blokları sonraki turlarda modele geri verilmediği için bağlama sayılmaz.
  function contentChars(node, depth = 0) {
    if (!node || depth > 8) return 0;
    if (typeof node === 'string') return node.length;
    if (Array.isArray(node)) return node.reduce((sum, item) => sum + contentChars(item, depth + 1), 0);
    if (typeof node !== 'object') return 0;
    if (node.type === 'thinking' || node.type === 'redacted_thinking') return 0;
    let sum = len(node.text);
    if (node.input && typeof node.input === 'object') sum += JSON.stringify(node.input).length;
    if (node.content) sum += contentChars(node.content, depth + 1);
    return sum;
  }

  function messageChars(message) {
    if (!message || typeof message !== 'object') return 0;
    let sum = Array.isArray(message.content) ? contentChars(message.content) : len(message.text);
    for (const file of Array.isArray(message.attachments) ? message.attachments : []) sum += len(file && file.extracted_content);
    return sum;
  }

  // Sohbet ağacında yalnızca görünen dal (son mesajdan köke) bağlamdır.
  function branch(data) {
    const messages = Array.isArray(data.chat_messages) ? data.chat_messages : [];
    const leaf = data.current_leaf_message_uuid;
    if (!leaf) return messages;
    const byId = new Map(messages.map((message) => [message && message.uuid, message]));
    const path = [];
    const seen = new Set();
    for (let node = byId.get(leaf); node && !seen.has(node.uuid); node = byId.get(node.parent_message_uuid)) {
      seen.add(node.uuid);
      path.push(node);
    }
    return path.length ? path : messages;
  }

  function rememberConversation(id, data) {
    if (!data || typeof data !== 'object' || !Array.isArray(data.chat_messages)) return;
    const item = conversation(id);
    item.context = branch(data).reduce((sum, message) => sum + messageChars(message), 0);
    if (typeof data.name === 'string' && data.name) item.title = data.name;
    if (typeof data.model === 'string' && data.model) item.model = data.model;
  }

  // İstek gövdesi: yeni mesaj, ekler ve stil yönergesi bu turun yeni girdisidir.
  function requestInfo(body) {
    const info = { inputChars: 0, model: '' };
    if (typeof body !== 'string') return info;
    let data;
    try { data = JSON.parse(body); } catch { return info; }
    if (!data || typeof data !== 'object') return info;
    info.inputChars = len(data.prompt);
    for (const file of Array.isArray(data.attachments) ? data.attachments : []) info.inputChars += len(file && file.extracted_content);
    for (const style of Array.isArray(data.personalized_styles) ? data.personalized_styles : []) info.inputChars += len(style && style.prompt);
    if (typeof data.model === 'string') info.model = data.model;
    return info;
  }

  const USAGE_FIELDS = ['input_tokens', 'output_tokens', 'cache_creation_input_tokens', 'cache_read_input_tokens'];
  function mergeUsage(meter, usage) {
    if (!usage || typeof usage !== 'object') return;
    for (const field of USAGE_FIELDS) {
      if (Number.isFinite(usage[field])) meter.usage = { ...meter.usage, [field]: Math.max(usage[field], (meter.usage && meter.usage[field]) || 0) };
    }
  }

  // Tek bir SSE olayını (data: satırındaki JSON) ölçüme ekler.
  function measure(meter, event) {
    if (!event || typeof event !== 'object') return;
    switch (event.type) {
      case 'message_start': {
        const message = event.message || {};
        meter.uuid = message.uuid || message.id || meter.uuid;
        if (message.model) meter.model = message.model;
        mergeUsage(meter, message.usage);
        break;
      }
      case 'content_block_start': {
        const block = event.content_block || {};
        // Sunucu araçlarının (web araması vb.) sonucu modelin okuduğu girdidir.
        if (block.type === 'tool_result') meter.tool += contentChars(block.content);
        else if (block.type === 'thinking') meter.thinking += len(block.thinking);
        else meter.output += len(block.text);
        break;
      }
      case 'content_block_delta': {
        const delta = event.delta || {};
        if (delta.type === 'thinking_delta') meter.thinking += len(delta.thinking);
        else if (delta.type === 'input_json_delta') meter.output += len(delta.partial_json);
        else if (delta.type === 'text_delta' || typeof delta.text === 'string') meter.output += len(delta.text);
        break;
      }
      case 'message_delta':
        mergeUsage(meter, event.usage || (event.delta && event.delta.usage));
        break;
      case 'completion':
        // Eski claude.ai akış biçimi: her olay bir metin parçası taşır.
        meter.output += len(event.completion);
        if (event.id && !meter.uuid) meter.uuid = event.id;
        if (event.model) meter.model = event.model;
        break;
      default:
        break;
    }
  }

  async function readStream(stream, onData) {
    const reader = stream.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let data = [];
    const line = (raw) => {
      const text = raw.endsWith('\r') ? raw.slice(0, -1) : raw;
      if (!text) {
        if (data.length) onData(data.join('\n'));
        data = [];
      } else if (text.startsWith('data:')) {
        data.push(text.slice(5).trimStart());
      }
    };
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let index;
        while ((index = buffer.indexOf('\n')) !== -1) {
          line(buffer.slice(0, index));
          buffer = buffer.slice(index + 1);
        }
      }
    } finally {
      // Kullanıcı yanıtı durdursa da o ana kadar üretilen tokenlar harcanmıştır.
      if (buffer) line(buffer);
      line('');
    }
  }

  function post(event) {
    try { window.postMessage({ channel: CHANNEL, event }, window.location.origin); } catch { /* sayfa kapanıyor */ }
  }

  async function meterCompletion(id, request, response) {
    const meter = { uuid: '', model: '', output: 0, thinking: 0, tool: 0, usage: null };
    try {
      await readStream(response.body, (data) => {
        try { measure(meter, JSON.parse(data)); } catch { /* JSON olmayan satır */ }
      });
    } catch {
      // Akış yarıda kesildi; ölçülen kadarı yine de bildirilir.
    }
    const item = conversation(id);
    if (!request.inputChars && !meter.output && !meter.thinking && !meter.tool && !meter.usage) return;
    post({
      id: `${id}:${meter.uuid || `t${Date.now().toString(36)}`}`,
      ts: Date.now(),
      conversation: id,
      title: item.title,
      model: meter.model || request.model || item.model,
      host: window.location.host,
      inputChars: request.inputChars,
      contextChars: item.context,
      toolChars: meter.tool,
      outputChars: meter.output,
      thinkingChars: meter.thinking,
      usage: meter.usage,
    });
    // Sonraki turda bu soru ve yanıt da bağlamın parçası olur.
    item.context += request.inputChars + meter.tool + meter.output;
    if (meter.model) item.model = meter.model;
  }

  function inspect(input, init, response) {
    if (!response || !response.ok || !response.body) return;
    const url = typeof input === 'string' ? input : (input && input.url) || String(input);
    const method = String((init && init.method) || (input && input.method) || 'GET').toUpperCase();
    let match = method === 'POST' && COMPLETION.exec(url);
    if (match) {
      meterCompletion(match[1].toLowerCase(), requestInfo(init && init.body), response.clone());
      return;
    }
    match = method === 'GET' && CONVERSATION.exec(url);
    if (match) {
      const id = match[1].toLowerCase();
      response.clone().json().then((data) => rememberConversation(id, data), () => {});
    }
  }

  const nativeFetch = window.fetch;
  if (typeof nativeFetch !== 'function') return;
  window.fetch = function sakuraMeteredFetch(input, init) {
    const pending = nativeFetch.apply(window, arguments);
    return pending.then((response) => {
      try { inspect(input, init, response); } catch { /* ölçüm sayfayı asla bozmaz */ }
      return response;
    });
  };
})();
