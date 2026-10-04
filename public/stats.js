// İstatistik ekranı: bilgisayardaki veritabanından günlük / haftalık token ve kod satırı geçmişi.
// Grafik bağımlılıksız SVG; her çubuk üzerine gelince ayrıntı gösterir, tablo görünümü ve CSV de var.

import { themeOf } from './themes.js';

const TOKEN_IDS = ['claude', 'chat', 'codex'];
const $ = (selector, root = document) => root.querySelector(selector);

let options = { preview: false, getSnapshot: () => null };
let data = null;
let view = 'days';
let unit = 'tokens';
let mode = 'chart';
let lastRevision = null;
let lastLoad = 0;
let loading = false;

const nf = (digits) => new Intl.NumberFormat('tr-TR', { maximumFractionDigits: digits });
function short(value) {
  const n = Math.max(0, value || 0);
  if (n < 1000) return nf(0).format(n);
  if (n < 1e6) return `${nf(n < 1e4 ? 1 : 0).format(n / 1e3)}K`;
  if (n < 1e9) return `${nf(n < 1e7 ? 2 : 1).format(n / 1e6)}M`;
  return `${nf(2).format(n / 1e9)}B`;
}
const full = (value) => nf(0).format(Math.round(value || 0));
const fmt = (value) => (unit === 'lines' ? full(value) : short(value));
const unitWord = () => (unit === 'lines' ? 'satır' : 'token');
const escapeHtml = (text) => String(text).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// Seçili birimde bir kovanın serileri: token → Claude Code + Claude + Codex, satır → VS Code.
function series() {
  if (unit === 'lines') return [{ id: 'vscode', color: themeOf('vscode').chart, label: `${themeOf('vscode').emoji} VS Code`, value: (b) => b.lines }];
  return TOKEN_IDS.map((id) => ({ id, color: themeOf(id).chart, label: `${themeOf(id).emoji} ${themeOf(id).ai}`, value: (b) => b.tokens[id] || 0 }));
}
const totalOf = (bucket) => series().reduce((sum, item) => sum + item.value(bucket), 0);

function niceMax(value) {
  if (value <= 0) return unit === 'lines' ? { step: 5, max: 20 } : { step: 250, max: 1000 };
  const rough = value / 4;
  const power = 10 ** Math.floor(Math.log10(rough));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * power).find((candidate) => candidate >= rough);
  return { step, max: Math.ceil(value / step) * step };
}

// --- veri ---------------------------------------------------------------------

function fakeStats() {
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
  const bucket = (scale) => {
    const claude = Math.round(rnd() * 6e6 * scale);
    const chat = Math.round(rnd() * 1.5e6 * scale);
    const codex = Math.round(rnd() * 3e6 * scale);
    return { tokens: { claude, chat, codex, total: claude + chat + codex }, lines: Math.round(rnd() * 320 * scale), chars: 0, calls: Math.round(rnd() * 200 * scale) };
  };
  const days = Array.from({ length: 30 }, (_, i) => ({ key: `d${i}`, label: `${i + 5} Eyl`, weekday: 'Pzt', ...bucket(i % 7 === 5 ? 0.2 : 1) }));
  const weeks = Array.from({ length: 12 }, (_, i) => ({ key: `w${i}`, label: `${i + 1}. hafta`, range: `${i + 1}. hafta`, current: i === 11, ...bucket(6) }));
  return {
    available: true, metric: { label: 'Ağırlıklı' }, target: 5e6, codeTarget: 250, days, weeks,
    summary: { today: days[29], yesterday: days[28], thisWeek: weeks[11], lastWeek: weeks[10], last30: bucket(25) },
    db: { path: '(önizleme)', size: 0, events: 0, firstDay: null }, backfill: null, allTime: {},
  };
}

async function load(force = false) {
  if (loading) return;
  if (!force && Date.now() - lastLoad < 3000) return;
  loading = true;
  try {
    data = options.preview ? fakeStats() : await (await fetch('/api/stats?days=30&weeks=12')).json();
    lastLoad = Date.now();
    render();
  } catch {
    $('#stats-body').innerHTML = '<p class="hint">İstatistikler yüklenemedi — sunucu çalışıyor mu?</p>';
  } finally {
    loading = false;
  }
}

// --- çizim ----------------------------------------------------------------------

function tile(label, bucket, compare) {
  const value = totalOf(bucket);
  let change = '';
  if (compare) {
    const before = totalOf(compare);
    if (before > 0) {
      const percent = Math.round(((value - before) / before) * 100);
      change = `<small class="change">${percent >= 0 ? '▲' : '▼'} %${Math.abs(percent)} geçen haftaya göre</small>`;
    }
  }
  const parts = series().length > 1
    ? `<small>${series().map((item) => `<span><i style="background:${item.color}"></i>${fmt(item.value(bucket))}</span>`).join('')}</small>`
    : '';
  return `<div class="tile"><span>${label}</span><strong>${fmt(value)}</strong>${change}${parts}</div>`;
}

function chartSvg(buckets, width) {
  const height = 250;
  const pad = { top: 16, right: 12, bottom: 28, left: 54 };
  const plotW = Math.max(100, width - pad.left - pad.right);
  const plotH = height - pad.top - pad.bottom;
  const items = series();
  const target = view === 'days' ? (unit === 'lines' ? data.codeTarget : data.target) : 0;
  const peak = Math.max(...buckets.map(totalOf), target ? target * 1.05 : 0);
  const { step, max } = niceMax(peak);
  const y = (value) => pad.top + plotH - (value / max) * plotH;
  const band = plotW / buckets.length;
  const barW = Math.max(4, Math.min(26, band * 0.66));

  let svg = `<svg class="chart" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" role="img" aria-label="${view === 'days' ? 'Son 30 gün' : 'Son 12 hafta'} ${unitWord()} grafiği">`;
  for (let value = 0; value <= max + step / 2; value += step) {
    const yy = y(value);
    svg += `<line class="grid" x1="${pad.left}" x2="${width - pad.right}" y1="${yy}" y2="${yy}"/>`;
    svg += `<text class="axis" x="${pad.left - 8}" y="${yy + 4}" text-anchor="end">${fmt(value)}</text>`;
  }
  if (target) {
    const yy = y(target);
    svg += `<line class="target" x1="${pad.left}" x2="${width - pad.right}" y1="${yy}" y2="${yy}"/>`;
    svg += `<text class="axis target-label" x="${width - pad.right}" y="${yy - 5}" text-anchor="end">Hedef ${fmt(target)}</text>`;
  }

  const labelEvery = Math.max(1, Math.ceil(buckets.length / Math.max(4, Math.floor(plotW / 64))));
  const peakIndex = buckets.reduce((best, bucket, index) => (totalOf(bucket) > totalOf(buckets[best]) ? index : best), 0);
  buckets.forEach((bucket, index) => {
    const cx = pad.left + band * (index + 0.5);
    const x0 = cx - barW / 2;
    let base = 0;
    const visible = items.filter((item) => item.value(bucket) > 0);
    visible.forEach((item, layer) => {
      const value = item.value(bucket);
      const top = y(base + value);
      // Segmentler arasında 2px yüzey boşluğu; en üstteki segmentin ucu 4px yuvarlak.
      const bottom = y(base) - (layer > 0 ? 2 : 0);
      const h = Math.max(1, bottom - top);
      if (layer === visible.length - 1) {
        const r = Math.min(4, h, barW / 2);
        svg += `<path fill="${item.color}" d="M${x0} ${top + h}V${top + r}Q${x0} ${top} ${x0 + r} ${top}H${x0 + barW - r}Q${x0 + barW} ${top} ${x0 + barW} ${top + r}V${top + h}Z"/>`;
      } else {
        svg += `<rect fill="${item.color}" x="${x0}" y="${top}" width="${barW}" height="${h}"/>`;
      }
      base += value;
    });
    // Seçici doğrudan etiket: son çubuk (bugün / bu hafta) ve en yüksek çubuk.
    const total = totalOf(bucket);
    if (total > 0 && (index === buckets.length - 1 || index === peakIndex)) {
      svg += `<text class="value-label" x="${cx}" y="${y(total) - 6}" text-anchor="middle">${fmt(total)}</text>`;
    }
    if (index % labelEvery === 0 || index === buckets.length - 1) {
      svg += `<text class="axis" x="${cx}" y="${height - 8}" text-anchor="middle">${escapeHtml(view === 'days' ? bucket.label : bucket.label)}</text>`;
    }
    svg += `<rect class="hit" data-index="${index}" x="${pad.left + band * index}" y="${pad.top}" width="${band}" height="${plotH}"/>`;
  });
  svg += `<line class="baseline" x1="${pad.left}" x2="${width - pad.right}" y1="${y(0)}" y2="${y(0)}"/>`;
  return `${svg}</svg>`;
}

function tooltipHtml(bucket) {
  const title = view === 'days' ? `${bucket.weekday} ${bucket.label}` : bucket.range;
  const rows = series().map((item) => `<div><i style="background:${item.color}"></i><span>${item.label}</span><b>${fmt(item.value(bucket))}</b></div>`).join('');
  const extra = unit === 'tokens'
    ? `<div class="muted"><span>Model çağrısı</span><b>${full(bucket.calls)}</b></div>`
    : `<div class="muted"><span>Yazılan karakter</span><b>${full(bucket.chars)}</b></div>`;
  const total = series().length > 1 ? `<div class="total"><span>Toplam</span><b>${fmt(totalOf(bucket))}</b></div>` : '';
  return `<strong>${escapeHtml(title)}</strong>${rows}${total}${extra}`;
}

function tableHtml(buckets) {
  const head = series().map((item) => `<th>${item.label}</th>`).join('');
  const rows = [...buckets].reverse().map((bucket) => {
    const cells = series().map((item) => `<td>${fmt(item.value(bucket))}</td>`).join('');
    const totalCell = series().length > 1 ? `<td><b>${fmt(totalOf(bucket))}</b></td>` : '';
    const last = unit === 'tokens' ? full(bucket.calls) : full(bucket.chars);
    return `<tr><th scope="row">${escapeHtml(view === 'days' ? `${bucket.weekday} ${bucket.label}` : bucket.range)}</th>${cells}${totalCell}<td>${last}</td></tr>`;
  }).join('');
  return `<div class="table-wrap"><table><thead><tr><th>${view === 'days' ? 'Gün' : 'Hafta'}</th>${head}${series().length > 1 ? '<th>Toplam</th>' : ''}<th>${unit === 'tokens' ? 'Çağrı' : 'Karakter'}</th></tr></thead><tbody>${rows}</tbody></table></div>`;
}

function render() {
  const body = $('#stats-body');
  if (!data) return;
  if (!data.available) {
    body.innerHTML = '<p class="hint">Veritabanı kullanılamıyor (Node 22.5+ gerekli).</p>';
    return;
  }
  for (const button of document.querySelectorAll('[data-stats-view]')) button.setAttribute('aria-pressed', String(button.dataset.statsView === view));
  for (const button of document.querySelectorAll('[data-stats-unit]')) button.setAttribute('aria-pressed', String(button.dataset.statsUnit === unit));
  for (const button of document.querySelectorAll('[data-stats-mode]')) button.setAttribute('aria-pressed', String(button.dataset.statsMode === mode));

  const s = data.summary;
  const backfill = data.backfill && data.backfill.running
    ? `<p class="hint progress-note">Geçmiş kayıtlar veritabanına aktarılıyor… ${data.backfill.done} / ${data.backfill.total} dosya</p>` : '';
  // claude.ai sohbetleri yanıt metninden tahmin edilir; lejantta bunu belirtir.
  const note = (id) => (id === 'chat' ? ' <small>(claude.ai tahmini + Cowork)</small>' : '');
  const legend = series().length > 1
    ? `<div class="legend">${series().map((item) => `<span><i style="background:${item.color}"></i>${item.label}${note(item.id)}</span>`).join('')}</div>`
    : `<div class="legend"><span><i style="background:${series()[0].color}"></i>${series()[0].label} · elle yazılan satır</span></div>`;
  const buckets = view === 'days' ? data.days : data.weeks;
  const width = Math.max(320, Math.round(body.clientWidth || 860));
  const info = data.db || {};
  const first = info.firstDay ? new Date(`${info.firstDay}T12:00:00`).toLocaleDateString('tr-TR', { dateStyle: 'long' }) : '—';

  body.innerHTML = `
    ${backfill}
    <div class="tiles">
      ${tile('Bugün', s.today)}
      ${tile('Dün', s.yesterday)}
      ${tile('Bu hafta', s.thisWeek, s.lastWeek)}
      ${tile('Geçen hafta', s.lastWeek)}
      ${tile('Son 30 gün', s.last30)}
    </div>
    ${legend}
    <div class="chart-area">${mode === 'chart' ? chartSvg(buckets, width) : tableHtml(buckets)}<div class="chart-tip" hidden></div></div>
    <p class="db-info">Veritabanı: <code>${escapeHtml(info.path || '')}</code> · ${full(info.events)} kayıt · ilk kayıt ${first} · ${nf(1).format((info.size || 0) / 1e6)} MB${unit === 'tokens' ? ` · ölçü: ${escapeHtml(data.metric.label)}` : ''}</p>`;

  const tip = $('.chart-tip', body);
  const area = $('.chart-area', body);
  for (const hit of body.querySelectorAll('.hit')) {
    const show = () => {
      const bucket = buckets[Number(hit.dataset.index)];
      for (const other of body.querySelectorAll('.hit.on')) other.classList.remove('on');
      hit.classList.add('on');
      tip.innerHTML = tooltipHtml(bucket);
      tip.hidden = false;
      const box = hit.getBoundingClientRect();
      const host = area.getBoundingClientRect();
      const left = box.left - host.left + box.width / 2;
      tip.style.left = `${Math.min(host.width - tip.offsetWidth / 2 - 4, Math.max(tip.offsetWidth / 2 + 4, left))}px`;
      tip.style.top = '6px';
    };
    hit.addEventListener('mouseenter', show);
    hit.addEventListener('focus', show);
  }
  area.addEventListener('mouseleave', () => {
    tip.hidden = true;
    for (const other of body.querySelectorAll('.hit.on')) other.classList.remove('on');
  });
}

// --- dışa açık ------------------------------------------------------------------

export function initStats(next) {
  options = { ...options, ...next };
  const dialog = $('#stats');
  $('[data-close]', dialog).addEventListener('click', () => dialog.close());
  dialog.addEventListener('click', (event) => {
    if (event.target === dialog) dialog.close();
    const button = event.target.closest('button');
    if (!button) return;
    if (button.dataset.statsView) view = button.dataset.statsView;
    if (button.dataset.statsUnit) unit = button.dataset.statsUnit;
    if (button.dataset.statsMode) mode = button.dataset.statsMode;
    if (button.dataset.statsView || button.dataset.statsUnit || button.dataset.statsMode) render();
  });
  addEventListener('resize', () => dialog.open && render());
}

export function openStats() {
  $('#stats').showModal();
  load(true);
}

// Yeni token / satır geldikçe açık ekran kendini tazeler.
export function statsOnSnapshot(snap) {
  const dialog = $('#stats');
  if (!dialog || !dialog.open || !snap) return;
  const revision = snap.db ? snap.db.revision : null;
  if (revision !== lastRevision || (snap.backfill && snap.backfill.running)) {
    lastRevision = revision;
    load();
  }
}
