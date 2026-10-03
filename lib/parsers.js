'use strict';
// Transcript satırlarını token olaylarına çeviren saf fonksiyonlar.
// Olay biçimi: { ts, source, session, project, model, input, output, cacheWrite, cacheRead }
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
    const key = message.id ? `${message.id}:${entry.requestId || ''}` : null;
    if (key) {
      const previous = seen.get(key);
      if (previous) {
        delta = {};
        const merged = {};
        for (const field of FIELDS) {
          delta[field] = Math.max(0, current[field] - previous[field]);
          merged[field] = Math.max(current[field], previous[field]);
        }
        seen.set(key, merged);
      } else {
        seen.set(key, current);
      }
    }
    if (isEmpty(delta)) return null;

    return {
      ts: Date.parse(entry.timestamp) || Date.now(),
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

  return {
    ts: Date.parse(entry.timestamp) || Date.now(),
    source: 'codex',
    session: state.session,
    project: state.project,
    model: state.model,
    ...delta,
  };
}

module.exports = { FIELDS, createClaudeParser, createCodexFileState, parseCodexLine, projectName };
