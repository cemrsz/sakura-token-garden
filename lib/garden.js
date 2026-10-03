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

const SOURCES = ['claude', 'codex'];
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
    sources: { claude: true, codex: true },
    history: [],
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
  if (raw.sources && typeof raw.sources === 'object') {
    for (const source of SOURCES) {
      if (typeof raw.sources[source] === 'boolean') state.sources[source] = raw.sources[source];
    }
  }
  if (Array.isArray(raw.history)) state.history = raw.history.filter((item) => item && Number.isFinite(item.start)).slice(-50);
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
  const next = normalizeState({ ...state, sources: { ...state.sources } });
  if (!patch || typeof patch !== 'object') return next;
  if (METRICS[patch.metric] && patch.metric !== next.metric) {
    next.metric = patch.metric;
    if (!Number.isFinite(patch.target)) next.target = METRICS[patch.metric].target;
  }
  if (Number.isFinite(patch.target) && patch.target >= 1000 && patch.target <= 1e12) next.target = Math.round(patch.target);
  if (LAYOUTS.includes(patch.layout)) next.layout = patch.layout;
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

function emptyTotals() {
  return { input: 0, output: 0, cacheWrite: 0, cacheRead: 0 };
}

// Hangi AI ağaçlarının gösterileceğine karar verir.
// split: bu sezon token harcayan her etkin AI bir ağaç alır; hiçbiri harcamadıysa en son kullanılan AI'ın tohumu görünür.
// single: tek ağaç, türünü bu sezon en çok harcayan AI belirler.
// focus: panelde ayrıntısı gösterilen ağaç (en son çalışan AI).
function plantTrees(state, bySource, total, seen) {
  const enabled = SOURCES.filter((source) => state.sources[source]);
  const byRecent = [...enabled].sort((a, b) => (seen[b] || 0) - (seen[a] || 0));
  const fallback = byRecent.find((source) => seen[source]) || enabled[0] || 'claude';
  let trees;
  if (state.layout === 'single') {
    const dominant = [...enabled].sort((a, b) => bySource[b].value - bySource[a].value || (seen[b] || 0) - (seen[a] || 0))[0] || fallback;
    trees = [{ id: dominant, value: Math.round(total), progress: total / state.target, combined: true, lastAt: seen[dominant] || 0 }];
  } else {
    const used = enabled.filter((source) => bySource[source].value > 0);
    trees = (used.length ? used : [fallback]).map((id) => ({
      id, value: bySource[id].value, progress: bySource[id].value / state.target, combined: false, lastAt: seen[id] || 0,
    }));
  }
  const focus = [...trees].sort((a, b) => b.lastAt - a.lastAt)[0].id;
  return { trees, focus };
}

function snapshot(state, events, now, extra = {}) {
  const metric = METRICS[state.metric];
  const current = season(state, now);
  const totals = emptyTotals();
  const bySource = {};
  for (const source of SOURCES) bySource[source] = { value: 0, events: 0, lastAt: 0, enabled: state.sources[source] };

  const sessions = new Map();
  const gardenStart = dayStart(now) - (GARDEN_DAYS - 1) * DAY;
  const days = new Map();
  let value = 0;
  let count = 0;
  let rate = 0;
  let lastEventAt = 0;
  const sourceSeen = {};

  for (const event of events) {
    if (!state.sources[event.source]) continue;
    const amount = metric.value(event);
    if (event.ts > lastEventAt) lastEventAt = event.ts;
    if (event.ts > (sourceSeen[event.source] || 0)) sourceSeen[event.source] = event.ts;
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
    const session = sessions.get(id) || { source: event.source, project: event.project, model: event.model, value: 0, lastAt: 0 };
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
  const { trees, focus } = plantTrees(state, bySource, value, sourceSeen);

  return {
    now,
    settings: {
      mode: state.mode,
      manualStart: state.manualStart,
      metric: state.metric,
      target: state.target,
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
    lastEventAt,
    garden,
    ...extra,
  };
}

module.exports = {
  METRICS,
  LAYOUTS,
  DAY,
  GARDEN_DAYS,
  defaultState,
  normalizeState,
  loadState,
  saveState,
  season,
  applySettings,
  replant,
  snapshot,
  dayKey,
  dayStart,
};
