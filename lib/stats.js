'use strict';
// Veritabanındaki günlük satırlardan istatistik ekranı için günlük / haftalık seriler,
// özet kutuları ve CSV üretir. Token değerleri seçili ölçüyle (ağırlıklı vb.) hesaplanır.

const { METRICS, TOKEN_SOURCES, CODE_SOURCES, dayKey, dayStart, DAY } = require('./garden');

const MONTHS = ['Oca', 'Şub', 'Mar', 'Nis', 'May', 'Haz', 'Tem', 'Ağu', 'Eyl', 'Eki', 'Kas', 'Ara'];
const WEEKDAYS = ['Paz', 'Pzt', 'Sal', 'Çar', 'Per', 'Cum', 'Cmt'];

const shortDate = (ts) => {
  const date = new Date(ts);
  return `${date.getDate()} ${MONTHS[date.getMonth()]}`;
};

// Pazartesi başlangıçlı hafta.
function weekStart(ts) {
  const start = new Date(dayStart(ts));
  const shift = (start.getDay() + 6) % 7;
  start.setDate(start.getDate() - shift);
  return start.getTime();
}

function emptyBucket() {
  const tokens = { total: 0 };
  for (const source of TOKEN_SOURCES) tokens[source] = 0;
  return { tokens, lines: 0, chars: 0, calls: 0, input: 0, output: 0, cacheWrite: 0, cacheRead: 0 };
}

function addRow(bucket, row, metric) {
  if (CODE_SOURCES.includes(row.source)) {
    bucket.lines += row.lines || 0;
    bucket.chars += row.chars || 0;
    return;
  }
  const value = metric.value({ input: row.input || 0, output: row.output || 0, cacheWrite: row.cacheWrite || 0, cacheRead: row.cacheRead || 0 });
  bucket.tokens[row.source] = (bucket.tokens[row.source] || 0) + value;
  bucket.tokens.total += value;
  bucket.calls += row.calls || 0;
  bucket.input += row.input || 0;
  bucket.output += row.output || 0;
  bucket.cacheWrite += row.cacheWrite || 0;
  bucket.cacheRead += row.cacheRead || 0;
}

function rounded(bucket) {
  const tokens = {};
  for (const [key, value] of Object.entries(bucket.tokens)) tokens[key] = Math.round(value);
  return { ...bucket, tokens };
}

function buildStats(rows, { state, now = Date.now(), days = 30, weeks = 12 } = {}) {
  const metric = METRICS[state.metric] || METRICS.weighted;
  const byDay = new Map();
  for (const row of rows) {
    const bucket = byDay.get(row.day) || emptyBucket();
    addRow(bucket, row, metric);
    byDay.set(row.day, bucket);
  }

  const today = dayStart(now);
  const dayList = [];
  for (let i = days - 1; i >= 0; i -= 1) {
    const ts = today - i * DAY + DAY / 2;
    const key = dayKey(ts);
    dayList.push({ key, label: shortDate(ts), weekday: WEEKDAYS[new Date(ts).getDay()], ...rounded(byDay.get(key) || emptyBucket()) });
  }

  const thisWeek = weekStart(now);
  const weekList = [];
  for (let i = weeks - 1; i >= 0; i -= 1) {
    const start = new Date(thisWeek);
    start.setDate(start.getDate() - i * 7);
    const bucket = emptyBucket();
    for (let d = 0; d < 7; d += 1) {
      const day = new Date(start);
      day.setDate(day.getDate() + d);
      const row = byDay.get(dayKey(day.getTime()));
      if (!row) continue;
      for (const source of TOKEN_SOURCES) bucket.tokens[source] += row.tokens[source] || 0;
      bucket.tokens.total += row.tokens.total;
      for (const field of ['lines', 'chars', 'calls', 'input', 'output', 'cacheWrite', 'cacheRead']) bucket[field] += row[field];
    }
    const end = new Date(start);
    end.setDate(end.getDate() + 6);
    weekList.push({ key: dayKey(start.getTime()), label: shortDate(start.getTime()), range: `${shortDate(start.getTime())} – ${shortDate(end.getTime())}`, current: i === 0, ...rounded(bucket) });
  }

  const sum = (list) => {
    const bucket = emptyBucket();
    for (const item of list) {
      for (const source of TOKEN_SOURCES) bucket.tokens[source] += item.tokens[source] || 0;
      bucket.tokens.total += item.tokens.total;
      for (const field of ['lines', 'chars', 'calls']) bucket[field] += item[field];
    }
    return rounded(bucket);
  };

  return {
    metric: { id: state.metric, label: metric.label },
    target: state.target,
    codeTarget: state.codeTarget,
    days: dayList,
    weeks: weekList,
    summary: {
      today: dayList[dayList.length - 1],
      yesterday: dayList[dayList.length - 2] || rounded(emptyBucket()),
      thisWeek: weekList[weekList.length - 1],
      lastWeek: weekList[weekList.length - 2] || rounded(emptyBucket()),
      last30: sum(dayList.slice(-30)),
    },
  };
}

function toCsv(rows, state) {
  const metric = METRICS[state.metric] || METRICS.weighted;
  const header = ['gun', 'kaynak', 'cagri', 'girdi', 'cikti', 'onbellek_yazma', 'onbellek_okuma', `token_${state.metric}`, 'kod_satiri', 'karakter'];
  const lines = [header.join(',')];
  for (const row of rows) {
    const isCode = CODE_SOURCES.includes(row.source);
    const value = isCode ? 0 : Math.round(metric.value({ input: row.input || 0, output: row.output || 0, cacheWrite: row.cacheWrite || 0, cacheRead: row.cacheRead || 0 }));
    lines.push([row.day, row.source, row.calls, row.input, row.output, row.cacheWrite, row.cacheRead, value, row.lines, row.chars].join(','));
  }
  return `﻿${lines.join('\r\n')}\r\n`;
}

module.exports = { buildStats, toCsv, weekStart };
