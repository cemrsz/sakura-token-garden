'use strict';
// Sezon (ağacın yaşam döngüsü), ölçüm ve kalıcı ayarlar.
// Günlük modda ağaç her gece yarısı yeniden tohumlanır; manuel modda "Yeni tohum"a
// basılana kadar büyümeye devam eder.

const fs = require('node:fs');
const path = require('node:path');

const METRICS = {
  weighted: {
    label: 'Ağırlıklı',
    description: 'Girdi + çıktı + önbellek yazma, önbellek okuma %10 ağırlıkla. Maliyete en yakın ölçü.',
    target: 5_000_000,
    value: (e) => e.input + e.cacheWrite + e.output + e.cacheRead * 0.1,
  },
  fresh: {
    label: 'Yeni tokenlar',
    description: 'Önbellekten okunanlar hariç; modelin gerçekten işlediği yeni girdi + çıktı.',
    target: 1_500_000,
    value: (e) => e.input + e.cacheWrite + e.output,
  },
  output: {
    label: 'Sadece çıktı',
    description: 'Yalnızca ajanın ürettiği tokenlar (düşünme dahil). En yavaş büyüyen ölçü.',
    target: 300_000,
    value: (e) => e.output,
  },
  all: {
    label: 'Tümü',
    description: 'Önbellek okumaları dahil her token. Bağlam büyüdükçe çok hızlı artar.',
    target: 40_000_000,
    value: (e) => e.input + e.cacheWrite + e.cacheRead + e.output,
  },
};

// Token kaynakları (AI'lar) ve kod kaynağı (VS Code eklentisi, birimi satır).
// claude -> Claude Code, chat -> Claude sohbetleri (claude.ai + Cowork), codex -> Codex.
const TOKEN_SOURCES = ['claude', 'chat', 'codex'];
const CODE_SOURCES = ['vscode'];
const SOURCES = [...TOKEN_SOURCES, ...CODE_SOURCES];
const CODE_PRESETS = [50, 100, 250, 1000, 5000];
const CODE_TARGET = 250;
// split: kullanılan her AI kendi ağacını büyütür; single: tüm tokenlar tek ağaçta.
const LAYOUTS = ['split', 'single'];
const WEEKDAYS = ['Paz', 'Pzt', 'Sal', 'Çar', 'Per', 'Cum', 'Cmt'];
const DAY = 24 * 60 * 60 * 1000;
const GARDEN_DAYS = 7;
const RATE_WINDOW = 5 * 60 * 1000;

function defaultState() {
  return {
    version: 1,
    mode: 'daily',
    manualStart: null,
    target: METRICS.weighted.target,
    metric: 'weighted',
    layout: 'split',
    codeTarget: CODE_TARGET,
    sources: { claude: true, chat: true, codex: true, vscode: true },
    history: [],
    // Bahçeye dikilen ağaçlar o sezonun değerinden düşülür; fazlası yeni ağaca devreder.
    harvest: { key: null, offsets: {} },
    // Kapanan sezonun tamamlanmış ağaçlarını otomatik dikmek için son görülen sezon.
    seasonSeen: null,
  };
}

function dayStart(ts) {
  const date = new Date(ts);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

function dayKey(ts) {
  const date = new Date(ts);
  const pad = (value) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function normalizeState(raw) {
  const state = defaultState();
  if (!raw || typeof raw !== 'object') return state;
  if (raw.mode === 'manual' || raw.mode === 'daily') state.mode = raw.mode;
  if (Number.isFinite(raw.manualStart)) state.manualStart = raw.manualStart;
  if (METRICS[raw.metric]) state.metric = raw.metric;
  if (LAYOUTS.includes(raw.layout)) state.layout = raw.layout;
  if (Number.isFinite(raw.target) && raw.target >= 1000) state.target = Math.round(raw.target);
  if (Number.isFinite(raw.codeTarget) && raw.codeTarget >= 1) state.codeTarget = Math.round(raw.codeTarget);
  if (raw.sources && typeof raw.sources === 'object') {
    for (const source of SOURCES) {
      if (typeof raw.sources[source] === 'boolean') state.sources[source] = raw.sources[source];
    }
  }
  if (Array.isArray(raw.history)) state.history = raw.history.filter((item) => item && Number.isFinite(item.start)).slice(-50);
  if (raw.harvest && typeof raw.harvest === 'object' && raw.harvest.offsets && typeof raw.harvest.offsets === 'object') {
    const offsets = {};
    for (const [key, value] of Object.entries(raw.harvest.offsets)) if (Number.isFinite(value) && value > 0) offsets[key] = value;
    state.harvest = { key: typeof raw.harvest.key === 'string' ? raw.harvest.key : null, offsets };
  }
  if (raw.seasonSeen && typeof raw.seasonSeen === 'object' && typeof raw.seasonSeen.key === 'string' && Number.isFinite(raw.seasonSeen.start)) {
    state.seasonSeen = { key: raw.seasonSeen.key, start: raw.seasonSeen.start };
  }
  if (state.mode === 'manual' && !state.manualStart) state.manualStart = Date.now();
  return state;
}

function loadState(file) {
  try {
    return normalizeState(JSON.parse(fs.readFileSync(file, 'utf8')));
  } catch {
    return defaultState();
  }
}

function saveState(file, state) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(state, null, 2));
  fs.renameSync(temp, file);
}

function season(state, now) {
  if (state.mode === 'manual') {
    return { key: `m:${state.manualStart}`, start: state.manualStart, label: 'Manuel sezon' };
  }
  return { key: `d:${dayKey(now)}`, start: dayStart(now), label: 'Bugün' };
}

// Ayar değişikliği; geçersiz alanlar sessizce yok sayılır.
function applySettings(state, patch, now) {
  const next = normalizeState({ ...state, sources: { ...state.sources }, harvest: { ...state.harvest, offsets: { ...state.harvest.offsets } } });
  if (!patch || typeof patch !== 'object') return next;
  if (METRICS[patch.metric] && patch.metric !== next.metric) {
    next.metric = patch.metric;
    if (!Number.isFinite(patch.target)) next.target = METRICS[patch.metric].target;
  }
  if (Number.isFinite(patch.target) && patch.target >= 1000 && patch.target <= 1e12) next.target = Math.round(patch.target);
  if (LAYOUTS.includes(patch.layout)) next.layout = patch.layout;
  if (Number.isFinite(patch.codeTarget) && patch.codeTarget >= 1 && patch.codeTarget <= 1e7) next.codeTarget = Math.round(patch.codeTarget);
  if (patch.sources && typeof patch.sources === 'object') {
    for (const source of SOURCES) {
      if (typeof patch.sources[source] === 'boolean') next.sources[source] = patch.sources[source];
    }
  }
  if ((patch.mode === 'manual' || patch.mode === 'daily') && patch.mode !== next.mode) {
    next.mode = patch.mode;
    next.manualStart = patch.mode === 'manual' ? now : null;
  }
  return next;
}

// Yeni tohum: mevcut sezonu bahçe geçmişine yazar ve şimdiden başlayan manuel sezon açar.
function replant(state, now, currentValue) {
  const next = normalizeState({ ...state, history: [...state.history] });
  const current = season(state, now);
  next.history.push({
    start: current.start,
    end: now,
    value: Math.round(currentValue),
    target: state.target,
    metric: state.metric,
  });
  next.history = next.history.slice(-50);
  next.mode = 'manual';
  next.manualStart = now;
  return next;
}

// Bir ağacı bahçeye diker: o sezon için hedef kadar değer ofsete eklenir.
function harvest(state, treeId, amount, now) {
  const current = season(state, now);
  const next = normalizeState({ ...state, harvest: { ...state.harvest, offsets: { ...state.harvest.offsets } } });
  if (next.harvest.key !== current.key) next.harvest = { key: current.key, offsets: {} };
  next.harvest.offsets[treeId] = (next.harvest.offsets[treeId] || 0) + amount;
  return next;
}

// Kapanan bir sezonun kaynak toplamlarından, henüz dikilmemiş tamamlanmış ağaçları hesaplar.
// totals: [{ source, input, output, cacheWrite, cacheRead, lines }]
function completedTrees(state, totals, seasonKey) {
  const metric = METRICS[state.metric];
  const offsets = state.harvest && state.harvest.key === seasonKey ? state.harvest.offsets : {};
  const value = {};
  for (const row of totals) {
    if (!state.sources[row.source]) continue;
    value[row.source] = CODE_SOURCES.includes(row.source)
      ? row.lines || 0
      : metric.value({ input: row.input || 0, output: row.output || 0, cacheWrite: row.cacheWrite || 0, cacheRead: row.cacheRead || 0 });
  }
  const result = [];
  const enabled = TOKEN_SOURCES.filter((source) => state.sources[source]);
  if (state.layout === 'single') {
    const total = enabled.reduce((sum, source) => sum + (value[source] || 0), 0);
    const dominant = [...enabled].sort((a, b) => (value[b] || 0) - (value[a] || 0))[0];
    const count = Math.floor(Math.max(0, total - (offsets.combined || 0)) / state.target);
    if (dominant && count > 0) result.push({ source: dominant, count, unit: 'tokens', target: state.target });
  } else {
    for (const source of enabled) {
      const count = Math.floor(Math.max(0, (value[source] || 0) - (offsets[source] || 0)) / state.target);
      if (count > 0) result.push({ source, count, unit: 'tokens', target: state.target });
    }
  }
  for (const source of CODE_SOURCES) {
    if (!state.sources[source]) continue;
    const count = Math.floor(Math.max(0, (value[source] || 0) - (offsets[source] || 0)) / state.codeTarget);
    if (count > 0) result.push({ source, count, unit: 'lines', target: state.codeTarget });
  }
  return result;
}

function emptyTotals() {
  return { input: 0, output: 0, cacheWrite: 0, cacheRead: 0 };
}

// Hangi AI ağaçlarının gösterileceğine karar verir.
// split: bu sezon token harcayan her etkin AI bir ağaç alır; hiçbiri harcamadıysa en son kullanılan AI'ın tohumu görünür.
// single: tek ağaç, türünü bu sezon en çok harcayan AI belirler.
// focus: panelde ayrıntısı gösterilen ağaç (en son çalışan AI).
// VS Code ağacı her iki düzende de ayrıdır: birimi token değil, elle yazılan kod satırıdır.
function plantTrees(state, bySource, total, seen, offsets = {}) {
  const enabled = TOKEN_SOURCES.filter((source) => state.sources[source]);
  const everything = SOURCES.filter((source) => state.sources[source]);
  const tokenTree = (id, raw, combined) => {
    const value = Math.max(0, raw - (offsets[combined ? 'combined' : id] || 0));
    return { id, unit: 'tokens', value: Math.round(value), progress: value / state.target, combined, lastAt: seen[id] || 0, planted: offsets[combined ? 'combined' : id] ? Math.round(offsets[combined ? 'combined' : id] / state.target) : 0 };
  };
  let trees = [];
  if (state.layout === 'single') {
    const dominant = [...enabled].sort((a, b) => bySource[b].value - bySource[a].value || (seen[b] || 0) - (seen[a] || 0))[0];
    if (dominant && total > 0) trees.push(tokenTree(dominant, total, true));
  } else {
    for (const id of enabled) if (bySource[id].value > 0) trees.push(tokenTree(id, bySource[id].value, false));
  }
  for (const id of CODE_SOURCES) {
    if (!state.sources[id] || bySource[id].value <= 0) continue;
    const value = Math.max(0, bySource[id].value - (offsets[id] || 0));
    trees.push({ id, unit: 'lines', value, progress: value / state.codeTarget, combined: false, lastAt: seen[id] || 0, planted: offsets[id] ? Math.round(offsets[id] / state.codeTarget) : 0 });
  }
  if (!trees.length) {
    // Bu sezon hiçbir şey yoksa en son kullanılan kaynağın tohumu görünür.
    const fallback = [...everything].sort((a, b) => (seen[b] || 0) - (seen[a] || 0)).find((id) => seen[id]) || enabled[0] || everything[0] || 'claude';
    trees = CODE_SOURCES.includes(fallback)
      ? [{ id: fallback, unit: 'lines', value: 0, progress: 0, combined: false, lastAt: seen[fallback] || 0 }]
      : [tokenTree(fallback, 0, state.layout === 'single')];
  }
  const focus = [...trees].sort((a, b) => b.lastAt - a.lastAt)[0].id;
  return { trees, focus };
}

function snapshot(state, events, now, extra = {}) {
  const metric = METRICS[state.metric];
  const current = season(state, now);
  const totals = emptyTotals();
  const bySource = {};
  for (const source of SOURCES) {
    bySource[source] = { value: 0, events: 0, lastAt: 0, enabled: state.sources[source], unit: CODE_SOURCES.includes(source) ? 'lines' : 'tokens', chars: 0 };
  }

  const sessions = new Map();
  const gardenStart = dayStart(now) - (GARDEN_DAYS - 1) * DAY;
  const days = new Map();
  let value = 0;
  let count = 0;
  let rate = 0;
  let lastEventAt = 0;
  let codeRate = 0;
  let codeChars = 0;
  const sourceSeen = {};

  for (const event of events) {
    if (!state.sources[event.source]) continue;
    if (event.ts > lastEventAt) lastEventAt = event.ts;
    if (event.ts > (sourceSeen[event.source] || 0)) sourceSeen[event.source] = event.ts;
    if (CODE_SOURCES.includes(event.source)) {
      if (event.ts >= now - RATE_WINDOW) codeRate += event.lines;
      if (event.ts < current.start) continue;
      const code = bySource[event.source];
      code.value += event.lines;
      code.chars += event.chars || 0;
      code.events += 1;
      codeChars += event.chars || 0;
      if (event.ts > code.lastAt) code.lastAt = event.ts;
      const codeId = `${event.source}:${event.project}`;
      const codeSession = sessions.get(codeId) || { source: event.source, project: event.project, model: event.model, value: 0, lastAt: 0, unit: 'lines' };
      codeSession.value += event.lines;
      if (event.ts >= codeSession.lastAt) codeSession.lastAt = event.ts;
      sessions.set(codeId, codeSession);
      continue;
    }
    const amount = metric.value(event);
    if (event.ts >= now - RATE_WINDOW) rate += amount;
    if (event.ts >= gardenStart) {
      const key = dayKey(event.ts);
      days.set(key, (days.get(key) || 0) + amount);
    }
    if (event.ts < current.start) continue;

    value += amount;
    count += 1;
    for (const field of Object.keys(totals)) totals[field] += event[field];
    const source = bySource[event.source];
    source.value += amount;
    source.events += 1;
    if (event.ts > source.lastAt) source.lastAt = event.ts;

    const id = `${event.source}:${event.session}`;
    // Proje adı oturumun ilk klasöründen gelir; ajan alt klasöre geçse de değişmez.
    const session = sessions.get(id) || { source: event.source, project: event.project, model: event.model, value: 0, lastAt: 0, unit: 'tokens' };
    session.value += amount;
    if (!session.project && event.project) session.project = event.project;
    if (event.ts >= session.lastAt) {
      session.lastAt = event.ts;
      if (event.model) session.model = event.model;
    }
    sessions.set(id, session);
  }

  let garden;
  if (state.mode === 'daily') {
    garden = [];
    for (let i = GARDEN_DAYS - 1; i >= 0; i -= 1) {
      const ts = dayStart(now) - i * DAY + DAY / 2;
      const key = dayKey(ts);
      const dayValue = i === 0 ? value : days.get(key) || 0;
      garden.push({
        key,
        label: i === 0 ? 'Bugün' : WEEKDAYS[new Date(ts).getDay()],
        value: Math.round(dayValue),
        progress: dayValue / state.target,
        current: i === 0,
      });
    }
  } else {
    garden = state.history.slice(-(GARDEN_DAYS - 1)).map((item, index) => ({
      key: `h:${item.start}`,
      label: `#${state.history.length - Math.min(state.history.length, GARDEN_DAYS - 1) + index + 1}`,
      value: item.value,
      progress: item.value / item.target,
      current: false,
    }));
    garden.push({ key: current.key, label: 'Şimdi', value: Math.round(value), progress: value / state.target, current: true });
  }

  const recentSessions = [...sessions.values()]
    .sort((a, b) => b.lastAt - a.lastAt)
    .slice(0, 4)
    .map((session) => ({ ...session, value: Math.round(session.value) }));

  for (const source of Object.values(bySource)) source.value = Math.round(source.value);
  const offsets = state.harvest && state.harvest.key === current.key ? state.harvest.offsets : {};
  const { trees, focus } = plantTrees(state, bySource, value, sourceSeen, offsets);

  return {
    now,
    settings: {
      mode: state.mode,
      manualStart: state.manualStart,
      metric: state.metric,
      target: state.target,
      codeTarget: state.codeTarget,
      codePresets: CODE_PRESETS,
      layout: state.layout,
      sources: { ...state.sources },
    },
    trees,
    focus,
    metrics: Object.fromEntries(Object.entries(METRICS).map(([id, item]) => [id, { label: item.label, description: item.description, target: item.target }])),
    season: current,
    value: Math.round(value),
    progress: value / state.target,
    events: count,
    totals,
    bySource,
    sessions: recentSessions,
    rate: Math.round(rate / (RATE_WINDOW / 60000)),
    codeRate: Math.round((codeRate / (RATE_WINDOW / 60000)) * 10) / 10,
    code: { lines: bySource.vscode.value, chars: codeChars, target: state.codeTarget },
    lastEventAt,
    garden,
    ...extra,
  };
}

module.exports = {
  METRICS,
  LAYOUTS,
  SOURCES,
  TOKEN_SOURCES,
  CODE_SOURCES,
  CODE_PRESETS,
  DAY,
  GARDEN_DAYS,
  defaultState,
  normalizeState,
  loadState,
  saveState,
  season,
  harvest,
  completedTrees,
  applySettings,
  replant,
  snapshot,
  dayKey,
  dayStart,
};
