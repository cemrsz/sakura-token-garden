// "Bahçem": hedefe ulaşıp dikilen ağaçlar, perspektifli bir çayırda.
// Her ağaç kendi tohumuyla bir kez çizilir (renderTreeImage) ve sahneye kopyalanır.

import { renderTreeImage } from './tree.js';
import { THEMES, themeOf } from './themes.js';

const $ = (selector, root = document) => root.querySelector(selector);
const nf = (digits) => new Intl.NumberFormat('tr-TR', { maximumFractionDigits: digits });
const full = (value) => nf(0).format(Math.round(value || 0));
function short(value) {
  const n = Math.max(0, value || 0);
  if (n < 1e6) return `${nf(n < 1e4 ? 1 : 0).format(n / 1e3)}K`;
  return `${nf(n < 1e7 ? 2 : 1).format(n / 1e6)}M`;
}
const escapeHtml = (text) => String(text).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

let options = { preview: false };
let items = [];
let mode = 'garden';
let highlightId = null;
let hits = [];
let hovered = null;
const images = new Map();

function mulberry(seed) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function fakeItems() {
  const sources = ['claude', 'chat', 'codex', 'claude', 'vscode', 'codex', 'chat', 'vscode', 'claude'];
  return sources.map((source, index) => ({
    id: index + 1, source, plantedAt: Date.now() - (sources.length - index) * 86400000, value: source === 'vscode' ? 250 : 5e6,
    target: source === 'vscode' ? 250 : 5e6, unit: source === 'vscode' ? 'lines' : 'tokens', seed: 1000 + index * 7919, auto: index % 3 === 0 ? 1 : 0,
  }));
}

async function load() {
  if (options.preview) {
    items = fakeItems();
  } else {
    try {
      const data = await (await fetch('/api/garden')).json();
      items = data.items || [];
    } catch {
      items = [];
    }
  }
  render();
}

function imageFor(item, height, dpr) {
  const key = `${item.id}:${Math.round(height)}:${dpr}`;
  if (!images.has(key)) images.set(key, renderTreeImage(item.source, item.seed, height, dpr));
  return images.get(key);
}

// --- sahne ------------------------------------------------------------------------

function drawMeadow(ctx, w, h, horizon) {
  const sky = ctx.createLinearGradient(0, 0, 0, horizon);
  sky.addColorStop(0, '#fdf6ec');
  sky.addColorStop(1, '#f7ead6');
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, w, horizon + 4);
  const sun = ctx.createRadialGradient(w * 0.8, h * 0.1, 0, w * 0.8, h * 0.1, w * 0.35);
  sun.addColorStop(0, 'rgba(255,232,186,.8)');
  sun.addColorStop(1, 'rgba(255,232,186,0)');
  ctx.fillStyle = sun;
  ctx.fillRect(0, 0, w, h);
  // Uzak tepeler
  for (const [color, lift, phase] of [['#d6e4b8', 0.1, 0.4], ['#c3d9a0', 0.04, 1.7]]) {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(0, horizon);
    for (let x = 0; x <= w; x += 20) ctx.lineTo(x, horizon - h * lift * (0.55 + 0.45 * Math.sin(x / w * 5 + phase)));
    ctx.lineTo(w, horizon + 2);
    ctx.lineTo(0, horizon + 2);
    ctx.fill();
  }
  const meadow = ctx.createLinearGradient(0, horizon, 0, h);
  meadow.addColorStop(0, '#b7d48c');
  meadow.addColorStop(1, '#8fbd62');
  ctx.fillStyle = meadow;
  ctx.fillRect(0, horizon, w, h - horizon);
  // Çimen tutamları ve minik çiçekler
  const rnd = mulberry(42);
  for (let i = 0; i < Math.round(w / 9); i += 1) {
    const x = rnd() * w;
    const depth = rnd();
    const y = horizon + 8 + depth * (h - horizon - 12);
    const size = 3 + depth * 6;
    ctx.strokeStyle = depth > 0.5 ? '#6f9e4a' : '#86b35c';
    ctx.lineWidth = 1 + depth;
    ctx.beginPath();
    ctx.moveTo(x - size * 0.4, y);
    ctx.lineTo(x - size * 0.6, y - size);
    ctx.moveTo(x, y);
    ctx.lineTo(x, y - size * 1.2);
    ctx.moveTo(x + size * 0.4, y);
    ctx.lineTo(x + size * 0.7, y - size);
    ctx.stroke();
    if (rnd() < 0.25) {
      ctx.fillStyle = ['#f6b6c9', '#fff4c9', '#d6c6ff'][Math.floor(rnd() * 3)];
      ctx.beginPath();
      ctx.arc(x + size, y - size * 0.6, 1.4 + depth * 1.6, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

// Ağaçları sıralara dizer: en eskiler arkada küçük, en yeniler önde büyük.
function layout(w, h, horizon, count) {
  const columns = Math.max(1, Math.min(9, Math.ceil(Math.sqrt(count * (w / h) * 1.2)) || 1));
  const rows = Math.ceil(count / columns);
  const spots = [];
  for (let index = 0; index < count; index += 1) {
    const fromFront = Math.floor((count - 1 - index) / columns);
    const row = rows - 1 - fromFront;
    const inRow = (count - 1 - index) % columns;
    const rowCount = Math.min(columns, count - fromFront * columns);
    const depth = rows === 1 ? 1 : row / (rows - 1);
    const scale = 0.5 + 0.5 * depth;
    const usable = w * (0.72 + 0.2 * depth);
    const x = w / 2 - usable / 2 + (usable / rowCount) * (rowCount - 1 - inRow + 0.5) + (row % 2 ? usable / rowCount / 4 : 0);
    const y = horizon + (h - horizon) * (0.18 + 0.74 * depth);
    spots.push({ x, y, scale, row });
  }
  return spots;
}

function drawGarden() {
  const canvas = $('#garden-canvas');
  const host = canvas.parentElement;
  const w = Math.max(320, host.clientWidth);
  const h = Math.max(260, Math.min(520, Math.round(w * 0.5)));
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  canvas.width = Math.round(w * dpr);
  canvas.height = Math.round(h * dpr);
  canvas.style.height = `${h}px`;
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const horizon = h * 0.36;
  drawMeadow(ctx, w, h, horizon);

  hits = [];
  if (!items.length) {
    ctx.fillStyle = 'rgba(255,251,246,.85)';
    ctx.beginPath();
    ctx.roundRect(w / 2 - 210, h * 0.55 - 34, 420, 68, 18);
    ctx.fill();
    ctx.fillStyle = '#5d4639';
    ctx.textAlign = 'center';
    ctx.font = '600 16px "Iowan Old Style", Georgia, serif';
    ctx.fillText('Bahçen henüz boş', w / 2, h * 0.55 - 6);
    ctx.font = '500 12.5px "Segoe UI", system-ui, sans-serif';
    ctx.fillStyle = '#8d7667';
    ctx.fillText('Bir ağacı %100’e ulaştır ve “Bahçeye dik”e bas.', w / 2, h * 0.55 + 16);
    return;
  }

  const spots = layout(w, h, horizon, items.length);
  const rows = Math.max(...spots.map((spot) => spot.row)) + 1;
  const columns = Math.max(...spots.map((spot) => spots.filter((other) => other.row === spot.row).length));
  // Ağaç tacı yüksekliğinin ~1,35 katı genişliktedir: öndeki sıra sütunlara sığacak kadar büyük olur.
  const byWidth = ((w * 0.92) / columns) * 1.12 / 1.35;
  const byHeight = (h - horizon) * (rows > 1 ? 1.25 / Math.sqrt(rows) : 1.3);
  const baseHeight = Math.min(h * 0.55, byWidth, byHeight);
  const order = items.map((item, index) => ({ item, spot: spots[index] })).sort((a, b) => a.spot.y - b.spot.y);
  for (const { item, spot } of order) {
    const height = baseHeight * spot.scale;
    const image = imageFor(item, height, dpr);
    const iw = image.width / dpr;
    const ih = image.height / dpr;
    const left = spot.x - iw * image.anchor.x;
    const top = spot.y - ih * image.anchor.y;
    const active = hovered === item.id || highlightId === item.id;
    ctx.fillStyle = 'rgba(70,90,40,.18)';
    ctx.beginPath();
    ctx.ellipse(spot.x, spot.y + 2, iw * 0.18, ih * 0.03 + 2, 0, 0, Math.PI * 2);
    ctx.fill();
    if (active) {
      const glow = ctx.createRadialGradient(spot.x, spot.y - ih * 0.45, 0, spot.x, spot.y - ih * 0.45, ih * 0.7);
      const [r, g, b] = themeOf(item.source).glow;
      glow.addColorStop(0, `rgba(${r},${g},${b},.75)`);
      glow.addColorStop(1, `rgba(${r},${g},${b},0)`);
      ctx.fillStyle = glow;
      ctx.fillRect(left - 20, top - 20, iw + 40, ih + 40);
    }
    ctx.drawImage(image, left, top, iw, ih);
    hits.push({ item, left, top, right: left + iw, bottom: top + ih, cx: spot.x });
  }
}

function tooltip(item) {
  const theme = themeOf(item.source);
  const when = new Date(item.plantedAt).toLocaleString('tr-TR', { dateStyle: 'medium', timeStyle: 'short' });
  const value = item.unit === 'lines' ? `${full(item.value)} satır` : `${short(item.value)} token`;
  return `<strong>${theme.emoji} ${theme.species} #${item.id}</strong>
    <div><span>${escapeHtml(theme.ai)}</span><b>${value}</b></div>
    <div><span>Dikildi</span><b>${when}</b></div>
    <div class="muted"><span>${item.auto ? 'Sezon sonunda kendiliğinden dikildi' : 'Elle dikildi'}</span></div>`;
}

function listHtml() {
  if (!items.length) return '<p class="hint">Henüz dikilmiş ağaç yok.</p>';
  const rows = [...items].reverse().map((item) => {
    const theme = themeOf(item.source);
    const when = new Date(item.plantedAt).toLocaleString('tr-TR', { dateStyle: 'medium', timeStyle: 'short' });
    const value = item.unit === 'lines' ? `${full(item.value)} satır` : `${short(item.value)} token`;
    return `<tr><th scope="row">#${item.id}</th><td>${theme.emoji} ${theme.species}</td><td>${escapeHtml(theme.ai)}</td><td>${when}</td><td>${value}</td><td>${item.auto ? 'Otomatik' : 'Elle'}</td></tr>`;
  }).join('');
  return `<div class="table-wrap"><table><thead><tr><th>#</th><th>Ağaç</th><th>Kaynak</th><th>Dikildi</th><th>Hedef</th><th>Nasıl</th></tr></thead><tbody>${rows}</tbody></table></div>`;
}

function render() {
  const counts = {};
  for (const item of items) counts[item.source] = (counts[item.source] || 0) + 1;
  $('#garden-summary').innerHTML = items.length
    ? `<b>${items.length}</b> ağaç · ${Object.keys(THEMES).filter((id) => counts[id]).map((id) => `${themeOf(id).emoji} ${themeOf(id).species} ×${counts[id]}`).join(' · ')}`
    : 'Henüz ağaç yok';
  for (const button of document.querySelectorAll('[data-garden-mode]')) button.setAttribute('aria-pressed', String(button.dataset.gardenMode === mode));
  $('#garden-scene').hidden = mode !== 'garden';
  $('#garden-list').hidden = mode !== 'list';
  if (mode === 'garden') drawGarden();
  else $('#garden-list').innerHTML = listHtml();
}

function pointer(event) {
  const canvas = $('#garden-canvas');
  const rect = canvas.getBoundingClientRect();
  const x = event.clientX - rect.left;
  const y = event.clientY - rect.top;
  // Öndeki ağaç önce: listenin sonundan başla.
  const hit = [...hits].reverse().find((box) => x >= box.left + (box.right - box.left) * 0.15 && x <= box.right - (box.right - box.left) * 0.15 && y >= box.top && y <= box.bottom);
  const tip = $('#garden-tip');
  const next = hit ? hit.item.id : null;
  if (next !== hovered) {
    hovered = next;
    drawGarden();
  }
  if (!hit) {
    tip.hidden = true;
    return;
  }
  tip.innerHTML = tooltip(hit.item);
  tip.hidden = false;
  tip.style.left = `${Math.min(rect.width - tip.offsetWidth / 2 - 6, Math.max(tip.offsetWidth / 2 + 6, hit.cx))}px`;
  tip.style.top = `${Math.max(6, hit.top - tip.offsetHeight + 24)}px`;
}

export function initGarden(next) {
  options = { ...options, ...next };
  const dialog = $('#garden-view');
  $('[data-close]', dialog).addEventListener('click', () => dialog.close());
  dialog.addEventListener('click', (event) => {
    if (event.target === dialog) dialog.close();
    const button = event.target.closest('[data-garden-mode]');
    if (button) {
      mode = button.dataset.gardenMode;
      render();
    }
  });
  const canvas = $('#garden-canvas');
  canvas.addEventListener('mousemove', pointer);
  canvas.addEventListener('mouseleave', () => {
    hovered = null;
    $('#garden-tip').hidden = true;
    drawGarden();
  });
  addEventListener('resize', () => dialog.open && mode === 'garden' && drawGarden());
}

export function openGarden(newId = null) {
  highlightId = newId;
  $('#garden-view').showModal();
  load();
  if (newId) setTimeout(() => { highlightId = null; if ($('#garden-view').open && mode === 'garden') drawGarden(); }, 4000);
}

export function gardenOnSnapshot(snap) {
  const dialog = $('#garden-view');
  if (dialog && dialog.open && snap && snap.gardenInfo && snap.gardenInfo.count !== items.length && !options.preview) load();
}
