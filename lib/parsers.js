'use strict';
// Transcript satırlarını token olaylarına çeviren saf fonksiyonlar.
// Token olayı: { id, ts, source, session, project, model, input, output, cacheWrite, cacheRead, total }
//   id    -> veritabanında tekilleştirme anahtarı (aynı model çağrısı her okunuşta aynı id)
//   total -> o id için şimdiye kadar görülen tam değerler (veritabanı max ile birleştirir)
//   input      -> önbelleğe alınmamış girdi tokenı
//   cacheWrite -> önbelleğe yazılan girdi tokenı
//   cacheRead  -> önbellekten okunan girdi tokenı
//   output     -> çıktı tokenı (düşünme/reasoning dahil)

const path = require('node:path');

const FIELDS = ['input', 'output', 'cacheWrite', 'cacheRead'];

const num = (value) => (Number.isFinite(value) && value > 0 ? value : 0);
const isEmpty = (usage) => FIELDS.every((field) => !usage[field]);
const projectName = (cwd) => (cwd ? path.basename(String(cwd).replace(/[\\/]+$/, '')) : '');

// Claude Code: her asistan mesajı, içerik bloğu başına bir satır olarak yazılır ve
// hepsi aynı usage nesnesini taşır. Ayrıca --resume ile açılan oturumlar eski mesajları
// yeni dosyaya kopyalar. Bu yüzden message.id + requestId ile global tekilleştirme yapılır;
// aynı anahtar daha büyük değerlerle tekrar gelirse yalnızca fark sayılır.
function createClaudeParser() {
  const seen = new Map();

  return function parseClaudeLine(line, fallback = {}) {
    if (!line.includes('"usage"')) return null;
    let entry;
    try { entry = JSON.parse(line); } catch { return null; }
    const message = entry && entry.message;
    if (entry.type !== 'assistant' || !message || !message.usage) return null;
    if (message.model === '<synthetic>') return null;

    const raw = message.usage;
    const current = {
      input: num(raw.input_tokens),
      output: num(raw.output_tokens),
      cacheWrite: num(raw.cache_creation_input_tokens),
      cacheRead: num(raw.cache_read_input_tokens),
    };

    let delta = current;
    let total = current;
    const key = message.id ? `${message.id}:${entry.requestId || ''}` : null;
    if (key) {
      const previous = seen.get(key);
      if (previous) {
        delta = {};
        total = {};
        for (const field of FIELDS) {
          delta[field] = Math.max(0, current[field] - previous[field]);
          total[field] = Math.max(current[field], previous[field]);
        }
      }
      seen.set(key, total);
    }
    if (isEmpty(delta)) return null;

    const ts = Date.parse(entry.timestamp) || Date.now();
    return {
      id: key ? `c:${key}` : `c:${entry.sessionId || fallback.session || ''}:${entry.uuid || ts}`,
      total,
      ts,
      source: 'claude',
      session: entry.sessionId || fallback.session || '',
      project: projectName(entry.cwd) || fallback.project || '',
      model: message.model || '',
      ...delta,
    };
  };
}

// Codex: token_count olayları oturum başına kümülatif toplam taşır (total_token_usage).
// Aynı toplam birden fazla kez yazılabildiği için ardışık toplamların farkı alınır.
// Dosyadaki ilk olayda, devralınmış (resume) toplamları saymamak için last_token_usage kullanılır.
function codexUsage(raw) {
  if (!raw) return null;
  const input = num(raw.input_tokens);
  const cacheRead = num(raw.cached_input_tokens);
  const cacheWrite = num(raw.cache_write_input_tokens);
  return {
    // input_tokens önbellek kategorilerini de içerir (total = input + output).
    input: Math.max(0, input - cacheRead - cacheWrite),
    output: num(raw.output_tokens),
    cacheWrite,
    cacheRead,
  };
}

const codexTotal = (raw) => (raw ? num(raw.total_tokens) || num(raw.input_tokens) + num(raw.output_tokens) : 0);

function createCodexFileState(fallback = {}) {
  return { prev: null, session: fallback.session || '', project: fallback.project || '', model: '' };
}

function parseCodexLine(line, state) {
  const interesting = line.includes('token_count') || line.includes('session_meta') || line.includes('turn_context');
  if (!interesting) return null;
  let entry;
  try { entry = JSON.parse(line); } catch { return null; }
  const payload = entry && entry.payload;
  if (!payload) return null;

  if (entry.type === 'session_meta') {
    state.session = payload.id || payload.session_id || state.session;
    state.project = projectName(payload.cwd) || state.project;
    return null;
  }
  if (entry.type === 'turn_context') {
    if (payload.cwd) state.project = projectName(payload.cwd) || state.project;
    if (payload.model) state.model = payload.model;
    return null;
  }
  if (payload.type !== 'token_count' || !payload.info) return null;

  const total = payload.info.total_token_usage;
  const last = payload.info.last_token_usage;
  let delta = null;

  if (!total) {
    delta = codexUsage(last);
  } else if (!state.prev) {
    delta = codexUsage(last) || codexUsage(total);
    state.prev = total;
  } else {
    const change = codexTotal(total) - codexTotal(state.prev);
    if (change === 0) return null;
    if (change < 0) {
      delta = codexUsage(last);
    } else {
      const now = codexUsage(total);
      const before = codexUsage(state.prev);
      delta = {};
      for (const field of FIELDS) delta[field] = Math.max(0, now[field] - before[field]);
    }
    state.prev = total;
  }
  if (!delta || isEmpty(delta)) return null;

  const ts = Date.parse(entry.timestamp) || Date.now();
  return {
    // Kümülatif toplam oturum içinde her artışta değişir; aynı satır her okunuşta aynı id'yi verir.
    id: `x:${state.session}:${total ? codexTotal(total) : ts}`,
    total: delta,
    ts,
    source: 'codex',
    session: state.session,
    project: state.project,
    model: state.model,
    ...delta,
  };
}

// VS Code eklentisinin yazdığı satır kayıtları:
// {"id":"…","ts":…,"lines":3,"chars":120,"language":"javascript","project":"Sakura_Visualizer"}
function parseVscodeLine(line) {
  if (!line.includes('"lines"')) return null;
  let entry;
  try { entry = JSON.parse(line); } catch { return null; }
  if (!entry || typeof entry.id !== 'string' || !Number.isFinite(entry.ts)) return null;
  const lines = num(entry.lines);
  const chars = num(entry.chars);
  if (!lines && !chars) return null;
  return {
    id: `v:${entry.id}`,
    ts: entry.ts,
    source: 'vscode',
    session: String(entry.window || ''),
    project: String(entry.project || '').slice(0, 120),
    model: String(entry.language || '').slice(0, 60),
    lines: Math.round(lines),
    chars: Math.round(chars),
    input: 0,
    output: 0,
    cacheWrite: 0,
    cacheRead: 0,
  };
}

// claude.ai sohbetleri (browser-extension/). Eklenti sayfadaki yanıt akışını ölçer, yalnızca
// karakter sayılarını yerel sunucuya yollar; sunucu her ölçümü claude-web klasörüne bir satır yazar:
// {"id":"<sohbet>:<mesaj>","ts":…,"conversation":"…","title":"…","model":"…","inputChars":120,
//  "contextChars":5400,"toolChars":0,"outputChars":900,"thinkingChars":300,"usage":null}
// Akışta gerçek usage yoksa token, karakterden tahmin edilir. Sohbet geçmişi her turda modele
// yeniden okutulur; claude.ai bunu önbellekten okuduğu için bağlam önbellek okuması sayılır.
const CHARS_PER_TOKEN = 3.5;
const estimateTokens = (chars) => Math.round(num(chars) / CHARS_PER_TOKEN);
const text = (value, max) => String(value || '').slice(0, max);

function webTokens(entry) {
  const usage = entry.usage && typeof entry.usage === 'object' ? entry.usage : {};
  const hasInput = Number.isFinite(usage.input_tokens);
  return {
    input: hasInput ? num(usage.input_tokens) : estimateTokens(num(entry.inputChars) + num(entry.toolChars)),
    output: num(usage.output_tokens) || estimateTokens(num(entry.outputChars) + num(entry.thinkingChars)),
    cacheWrite: hasInput ? num(usage.cache_creation_input_tokens) : 0,
    cacheRead: hasInput ? num(usage.cache_read_input_tokens) : estimateTokens(entry.contextChars),
  };
}

// Eklenti bağlantı koptuğunda aynı ölçümü yeniden gönderebilir; id ile bir kez sayılır.
function createWebParser() {
  const seen = new Set();

  return function parseWebLine(line) {
    if (!line.includes('"conversation"')) return null;
    let entry;
    try { entry = JSON.parse(line); } catch { return null; }
    if (!entry || typeof entry.id !== 'string' || !entry.id || !Number.isFinite(entry.ts)) return null;
    if (seen.has(entry.id)) return null;
    const tokens = webTokens(entry);
    if (isEmpty(tokens)) return null;
    seen.add(entry.id);
    return {
      id: `w:${entry.id}`,
      total: tokens,
      ts: entry.ts,
      source: 'chat',
      session: text(entry.conversation, 80),
      project: text(entry.title, 120) || text(entry.host, 60) || 'claude.ai',
      model: text(entry.model, 60),
      ...tokens,
    };
  };
}

module.exports = {
  FIELDS,
  CHARS_PER_TOKEN,
  estimateTokens,
  createClaudeParser,
  createCodexFileState,
  parseCodexLine,
  parseVscodeLine,
  createWebParser,
  projectName,
};
