import { GardenScene } from './tree.js';
import { THEMES, themeOf, stageIndex } from './themes.js';

const SOURCE_IDS = Object.keys(THEMES);
const PRESETS = [300_000, 1_000_000, 1_500_000, 2_000_000, 5_000_000, 10_000_000, 40_000_000];
const ACTIVE_MS = 90_000;
const RECENT_MS = 15 * 60_000;

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

const params = new URLSearchParams(location.search);
const mode = params.get('mode') === 'widget' ? 'widget' : 'full';
const preview = params.get('preview');
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
// Electron masaüstü uygulamasında preload bu köprüyü tanımlar.
const desktop = window.sakuraDesktop || null;
document.body.classList.add(`mode-${mode}`);
if (desktop) document.body.classList.add('desktop');

const app = $('#app');
const stage = $('#stage');
const canvas = $('#scene');
const sheet = $('#sheet');
const scene = new GardenScene(canvas, { reducedMotion });
scene.start();

let snap = null;
let previous = null;
let connected = false;
let pipWindow = null;
let focusOverride = null;

// --- Biçimlendirme ----------------------------------------------------------

const nf = (digits) => new Intl.NumberFormat('tr-TR', { maximumFractionDigits: digits });
function short(value) {
  const n = Math.max(0, value || 0);
  if (n < 1000) return nf(0).format(n);
  if (n < 1e6) return `${nf(n < 1e4 ? 1 : 0).format(n / 1e3)}K`;
  if (n < 1e9) return `${nf(n < 1e7 ? 2 : 1).format(n / 1e6)}M`;
  return `${nf(2).format(n / 1e9)}B`;
}
const full = (value) => nf(0).format(Math.round(value || 0));
const percentText = (progress) => `${Math.min(100, Math.floor(progress * 100))}%`;
const escapeHtml = (text) => String(text).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function ago(ts, now = Date.now()) {
  if (!ts) return 'hiç';
  const seconds = Math.max(0, Math.round((now - ts) / 1000));
  if (seconds < 45) return 'az önce';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} dk önce`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} sa önce`;
  return `${Math.round(hours / 24)} gün önce`;
}

// --- Odak: panelde ayrıntısı gösterilen ağaç ------------------------------------

function focusedTree(data = snap) {
  if (!data) return null;
  const wanted = focusOverride && data.trees.some((tree) => tree.id === focusOverride) ? focusOverride : data.focus;
  return data.trees.find((tree) => tree.id === wanted) || data.trees[0];
}

function applyAccent(theme) {
  for (const root of [document.documentElement, pipWindow?.document.documentElement].filter(Boolean)) {
    root.style.setProperty('--pink', theme.accent);
    root.style.setProperty('--pink-deep', theme.accentDeep);
  }
}

// --- Bildirim -------------------------------------------------------------------

let toastTimer = null;
function toast(message, ms = 3200) {
  const element = $('#toast', stage.ownerDocument) || $('#toast');
  element.textContent = message;
  element.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => element.classList.remove('show'), ms);
}

// --- Durum ------------------------------------------------------------------------

function activity(now = Date.now()) {
  if (!connected && !preview) return { state: 'offline', text: 'Sunucuya bağlanılamıyor — yeniden deneniyor…' };
  if (!snap) return { state: 'idle', text: 'Bağlanıyor…' };
  if (!snap.ready) return { state: 'idle', text: 'Transcriptler okunuyor…' };
  const enabled = SOURCE_IDS.filter((id) => snap.settings.sources[id]);
  if (!enabled.length) return { state: 'idle', text: 'Tüm kaynaklar kapalı' };
  const latest = enabled.map((id) => ({ id, at: snap.bySource[id]?.lastAt || 0 })).sort((a, b) => b.at - a.at)[0];
  const sinceLast = snap.lastEventAt ? now - snap.lastEventAt : Infinity;
  const name = themeOf(latest.at ? latest.id : enabled[0]).ai;
  if (sinceLast < ACTIVE_MS) return { state: 'active', text: `${name} çalışıyor · ${short(snap.rate)} tok/dk` };
  if (sinceLast < RECENT_MS) return { state: 'recent', text: `Son token ${ago(snap.lastEventAt, now)} · ${name}` };
  return { state: 'idle', text: snap.lastEventAt ? `Ajanlar dinleniyor · son ${ago(snap.lastEventAt, now)}` : 'Ajan bekleniyor — Claude Code veya Codex’i çalıştır' };
}

function renderStatus() {
  const status = activity();
  for (const dot of $$('[data-dot]', app).concat(pipWindow ? $$('[data-dot]', pipWindow.document) : [])) dot.dataset.state = status.state;
  $('#status-text').textContent = status.text;
  const rate = $('[data-rate]', stage);
  if (rate) rate.textContent = status.state === 'active' ? `${short(snap.rate)} tok/dk` : status.state === 'offline' ? 'bağlantı yok' : snap?.lastEventAt ? ago(snap.lastEventAt) : '—';
}

// --- Panel ----------------------------------------------------------------------------

function buildTicks(theme) {
  $('#ticks').innerHTML = theme.stages.slice(1, -1).map((item) => `<i style="left:${item.at * 100}%"></i>`).join('');
}

function bulbIcon(progress) {
  if (progress >= 0.7) {
    return '<svg viewBox="0 0 20 20"><g fill="var(--pink)" fill-opacity=".55" stroke="var(--pink-deep)" stroke-width="1.1">' +
      [0, 72, 144, 216, 288].map((r) => `<ellipse cx="10" cy="5.2" rx="3.1" ry="4.4" transform="rotate(${r} 10 10)"/>`).join('') +
      '</g><circle cx="10" cy="10" r="2" fill="#f6cf63"/></svg>';
  }
  if (progress >= 0.05) {
    return '<svg viewBox="0 0 20 20"><path d="M10 18V9" stroke="#5f9443" stroke-width="2" stroke-linecap="round"/><path d="M10 10c-4 0-6-2.5-6-5 3 0 6 1.5 6 5zM10 9c0-3.5 2.5-5.5 6-5.5 0 3-2.5 5.5-6 5.5z" fill="#8fc163" stroke="#3f6b2c" stroke-width="1"/></svg>';
  }
  return '<svg viewBox="0 0 20 20"><ellipse cx="10" cy="12" rx="3.6" ry="2.6" fill="#a87650" stroke="#4c2f20" stroke-width="1"/></svg>';
}

function renderGarden() {
  $('#garden').innerHTML = snap.garden.map((day) => {
    const progress = Math.min(1, day.progress);
    const title = escapeHtml(`${day.label}: ${full(day.value)} token (${Math.floor(day.progress * 100)}%)`);
    return `<div class="day${day.current ? ' current' : ''}" role="listitem" title="${title}" aria-label="${title}">
      <span class="bulb" style="--p:${progress.toFixed(3)}">${bulbIcon(day.progress)}</span>${escapeHtml(day.label)}</div>`;
  }).join('');
}

function renderChips() {
  const now = Date.now();
  const focus = focusedTree()?.id;
  $('#source-chips').innerHTML = SOURCE_IDS.map((id) => {
    const theme = themeOf(id);
    const source = snap.bySource[id];
    const info = snap.sources?.[id];
    const on = snap.settings.sources[id] && info?.found !== false;
    const state = !on ? '' : source.lastAt && now - source.lastAt < ACTIVE_MS ? 'active' : source.lastAt && now - source.lastAt < RECENT_MS ? 'recent' : '';
    const value = info?.found === false ? 'yok' : short(source.value);
    const hasTree = snap.trees.some((tree) => tree.id === id);
    const classes = ['chip', on ? '' : 'off', hasTree && snap.trees.length > 1 && id === focus ? 'focused' : ''].filter(Boolean).join(' ');
    return `<button type="button" class="${classes}" data-focus="${id}" style="--chip:${theme.accent}" title="${theme.ai}: ${theme.species} (${theme.speciesDetail})">
      <span class="dot" data-state="${state}"></span>${theme.emoji} ${theme.ai} <b>${value}</b></button>`;
  }).join('');
}

function renderSettings() {
  if (!sheet.open || !snap) return;
  const { settings } = snap;
  for (const button of $$('[data-mode]', sheet)) button.setAttribute('aria-pressed', String(button.dataset.mode === settings.mode));
  for (const button of $$('[data-layout]', sheet)) button.setAttribute('aria-pressed', String(button.dataset.layout === settings.layout));
  $('#mode-hint').textContent = settings.mode === 'daily'
    ? 'Ağaçlar her gece yarısı yeniden tohumlanır; bahçede son 7 gün görünür.'
    : `Bu sezon ${new Date(settings.manualStart).toLocaleString('tr-TR', { dateStyle: 'medium', timeStyle: 'short' })} tarihinde başladı. Yeni tohum ekene kadar büyür.`;
  $('#layout-hint').innerHTML = SOURCE_IDS.map((id) => `${themeOf(id).emoji} <b>${themeOf(id).ai}</b> → ${themeOf(id).species}`).join(' · ')
    + (settings.layout === 'split' ? '<br>Kullandığın her AI kendi ağacını büyütür.' : '<br>Tüm tokenlar tek ağaçta; türünü en çok kullandığın AI belirler.');

  const input = $('#target-input');
  if (document.activeElement !== input) input.value = settings.target;
  $('#presets').innerHTML = PRESETS.map((value) => `<button type="button" data-target="${value}" aria-pressed="${value === settings.target}">${short(value)}</button>`).join('');

  $('#metric-list').innerHTML = Object.entries(snap.metrics).map(([id, metric]) => `
    <button type="button" class="metric" role="radio" data-metric="${id}" aria-checked="${id === settings.metric}">
      <strong>${metric.label}</strong><span>${metric.description}</span>
    </button>`).join('');

  $('#source-list').innerHTML = SOURCE_IDS.map((id) => {
    const theme = themeOf(id);
    const info = snap.sources?.[id] || {};
    const detail = info.found ? `${info.files} dosya izleniyor · ${info.active} aktif` : 'Klasör bulunamadı';
    const title = escapeHtml(info.dirs?.join(', ') || '');
    return `<div class="source" title="${title}">
      <div><strong>${theme.emoji} ${theme.ai} <small>· ${theme.species}</small></strong><span>${detail}</span></div>
      <button type="button" class="switch" role="switch" data-source="${id}" aria-checked="${!!settings.sources[id]}" aria-label="${theme.ai}"></button>
    </div>`;
  }).join('');

  const rows = [
    ['Girdi (önbelleksiz)', snap.totals.input],
    ['Önbelleğe yazma', snap.totals.cacheWrite],
    ['Önbellekten okuma', snap.totals.cacheRead],
    ['Çıktı', snap.totals.output],
    ['Model çağrısı', snap.events],
  ];
  $('#breakdown').innerHTML = rows.map(([label, value]) => `<dt>${label}</dt><dd>${full(value)}</dd>`).join('');
  $('#sessions').innerHTML = snap.sessions.map((session) => `
    <div class="session"><span>${themeOf(session.source).ai} · ${escapeHtml(session.project || 'oturum')} · ${ago(session.lastAt)}</span><b>${short(session.value)}</b></div>`).join('');
}

let tickTheme = null;
let lastTreeCount = 0;
function render() {
  if (!snap) return;
  const tree = focusedTree();
  const theme = themeOf(tree.id);
  const progress = Math.max(0, tree.progress);
  const index = stageIndex(theme, progress);
  const item = theme.stages[index];
  const metric = snap.metrics[snap.settings.metric];
  const overflow = tree.value - snap.settings.target;

  if (tickTheme !== theme.id) {
    tickTheme = theme.id;
    buildTicks(theme);
  }
  if (lastTreeCount !== snap.trees.length) {
    lastTreeCount = snap.trees.length;
    requestAnimationFrame(updateInsets);
  }
  applyAccent(theme);
  scene.setFocus(tree.id);

  $('#brand-title').textContent = theme.species;
  $('#brand-kicker').textContent = `${theme.ai} · Token Bahçesi`;
  $('#percent').textContent = percentText(progress);
  $('#ring-fill').style.strokeDashoffset = String(169.65 * (1 - Math.min(1, progress)));
  $('#stage-index').textContent = `Evre ${index + 1} / ${theme.stages.length} · ${theme.species}`;
  $('#stage-name').textContent = item.name;
  $('#stage-msg').textContent = item.msg;
  $('#value').textContent = short(tree.value);
  $('#value').title = `${full(tree.value)} token`;
  $('#target').textContent = `/ ${short(snap.settings.target)} token`;
  const scope = tree.combined ? 'tüm AI’lar' : theme.ai;
  $('#meta').textContent = `${metric.label} · ${snap.season.label} · ${scope}${overflow > 0 ? ` · +${short(overflow)} fazla` : ''}${snap.demo ? ' · demo' : ''}`;
  $('#progress-fill').style.width = `${Math.min(100, progress * 100)}%`;

  $('[data-stage-name]', stage).textContent = snap.trees.length > 1 ? `${theme.emoji} ${item.name}` : item.name;
  $('[data-percent]', stage).textContent = percentText(progress);
  $('[data-bar]', stage).style.width = `${Math.min(100, progress * 100)}%`;
  $('[data-value-short]', stage).textContent = `${theme.ai} · ${short(tree.value)} / ${short(snap.settings.target)}`;

  const description = snap.trees.map((t) => `${themeOf(t.id).ai} ${themeOf(t.id).species}: ${themeOf(t.id).stages[stageIndex(themeOf(t.id), t.progress)].name}, yüzde ${Math.floor(Math.min(1, t.progress) * 100)}`).join('; ');
  canvas.setAttribute('aria-label', `Token bahçesi. ${description}`);
  document.title = `${percentText(progress)} · ${item.name} — ${theme.species}`;
  if (pipWindow) pipWindow.document.title = document.title;

  renderChips();
  renderGarden();
  renderStatus();
  renderSettings();
}

// --- Yeni veri -----------------------------------------------------------------------

function treeDelta(id, before, after) {
  if (after.settings.layout === 'single') return after.value - before.value;
  return (after.bySource[id]?.value || 0) - (before.bySource[id]?.value || 0);
}

function applySnapshot(next) {
  previous = snap;
  snap = next;
  const live = previous && previous.ready && next.ready;
  const sameSeason = previous && previous.season.key === next.season.key && previous.settings.target === next.settings.target
    && previous.settings.metric === next.settings.metric && previous.settings.layout === next.settings.layout;

  scene.setTrees(next.trees.map((tree) => ({ id: tree.id, progress: tree.progress })), { instant: reducedMotion });

  if (live && sameSeason) {
    const messages = [];
    for (const tree of next.trees) {
      const theme = themeOf(tree.id);
      const before = previous.trees.find((t) => t.id === tree.id);
      if (!before) {
        messages.push(`${theme.emoji} ${theme.ai} için ${theme.species} ağacı dikildi`);
        continue;
      }
      const delta = treeDelta(tree.id, previous, next);
      if (delta > 0) scene.pulse(tree.id, delta);
      if (before.progress < 1 && tree.progress >= 1) {
        scene.celebrate(tree.id);
        messages.push(`${theme.emoji} ${theme.finale}! ${theme.ai} hedefi tamamlandı`);
      } else if (stageIndex(theme, tree.progress) > stageIndex(theme, before.progress)) {
        messages.push(`${theme.emoji} ${next.trees.length > 1 ? `${theme.ai}: ` : 'Yeni evre: '}${theme.stages[stageIndex(theme, tree.progress)].name}`);
      }
    }
    if (messages.length) toast(messages.join(' · '), 4200);
  } else if (live && previous.season.key !== next.season.key) {
    toast('🌱 Yeni tohum ekildi');
  }
  render();
}

async function post(path, body = {}) {
  try {
    const response = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (!response.ok) throw new Error(String(response.status));
    const data = await response.json();
    if (data && data.settings) applySnapshot(data);
    return data;
  } catch {
    toast('İşlem başarısız — sunucu çalışıyor mu?');
    return null;
  }
}

function connect() {
  const source = new EventSource('/api/stream');
  source.addEventListener('snapshot', (event) => {
    connected = true;
    applySnapshot(JSON.parse(event.data));
  });
  source.addEventListener('open', () => {
    connected = true;
    renderStatus();
  });
  source.addEventListener('error', () => {
    connected = false;
    renderStatus();
  });
}

// --- Önizleme (sunucusuz) -------------------------------------------------------------------
// ?preview=0.65 sabit ilerleme, ?preview=auto 0→1 döngüsü. &ai=claude|codex|both

function fakeSnapshot(progress) {
  const target = 5_000_000;
  const now = Date.now();
  const ai = params.get('ai') || 'claude';
  const ids = ai === 'both' ? ['claude', 'codex'] : [ai in THEMES ? ai : 'claude'];
  const progressOf = (id, index) => (ids.length > 1 && index === 1 ? Math.max(0, progress * 0.72) : progress);
  const trees = ids.map((id, index) => ({ id, value: Math.round(progressOf(id, index) * target), progress: progressOf(id, index), combined: false, lastAt: now - index * 60000 }));
  const value = trees.reduce((sum, tree) => sum + tree.value, 0);
  const bySource = Object.fromEntries(SOURCE_IDS.map((id) => {
    const tree = trees.find((t) => t.id === id);
    return [id, { value: tree ? tree.value : 0, events: 1, lastAt: tree ? tree.lastAt : 0, enabled: true }];
  }));
  return {
    now, ready: true, demo: true, value, progress: value / target, events: 400, rate: 42_000, lastEventAt: now - 4000,
    settings: { mode: 'daily', manualStart: null, metric: 'weighted', target, layout: 'split', sources: { claude: true, codex: true } },
    metrics: { weighted: { label: 'Ağırlıklı', description: 'Önizleme', target } },
    season: { key: 'preview', start: now, label: 'Önizleme' },
    totals: { input: value * 0.01, output: value * 0.1, cacheWrite: value * 0.25, cacheRead: value * 6 },
    bySource, trees, focus: trees[0].id, sessions: [],
    sources: { claude: { found: true, dirs: [], files: 0, active: 0 }, codex: { found: true, dirs: [], files: 0, active: 0 } },
    garden: [0.4, 1.1, 0.05, 0.75, 0, 0.3, progress].map((p, i) => ({ key: String(i), label: i === 6 ? 'Bugün' : ['Pzt', 'Sal', 'Çar', 'Per', 'Cum', 'Cmt'][i], value: p * target, progress: p, current: i === 6 })),
  };
}

function startPreview() {
  if (preview === 'auto') {
    const begin = performance.now();
    const loop = () => {
      const t = ((performance.now() - begin) / 1000) % 52;
      snap = fakeSnapshot(Math.min(1, t / 45));
      scene.setTrees(snap.trees, { instant: true });
      render();
      setTimeout(loop, 120);
    };
    loop();
    return;
  }
  const progress = Math.max(0, Math.min(1.2, Number(preview) || 0));
  snap = fakeSnapshot(progress);
  scene.setTrees(snap.trees, { instant: true });
  render();
}

// --- Yerleşim ------------------------------------------------------------------------------

function updateInsets() {
  const doc = stage.ownerDocument;
  const win = doc.defaultView;
  const compact = mode === 'widget' || doc !== document;
  scene.labels = !compact || win.innerWidth > 420;
  if (compact) {
    const hud = $('#hud', doc) || $('#hud');
    scene.setInsets({ top: 14, right: 8, left: 8, bottom: (hud?.offsetHeight || 70) + 22 });
    const rect = hud?.getBoundingClientRect();
    scene.setFeedOrigin(rect ? { x: rect.left + rect.width * 0.5, y: rect.top } : null);
    return;
  }
  const panel = $('#panel').getBoundingClientRect();
  const brand = $('#brand').getBoundingClientRect();
  // Birden çok ağaçta soldaki taç başlığın altına girmesin.
  const crowded = win.innerWidth < 760 || (snap?.trees.length || 1) > 1;
  scene.setInsets({ top: crowded ? brand.bottom + 8 : 30, right: 12, left: 12, bottom: win.innerHeight - panel.top + 10 });
  const ring = $('#ring').getBoundingClientRect();
  scene.setFeedOrigin({ x: ring.left + ring.width / 2, y: ring.top + ring.height / 2 });
}

// --- Üstte tut: masaüstünde widget penceresi, tarayıcıda Document Picture-in-Picture ----------

function openPopup() {
  window.open(`${location.pathname}?mode=widget`, 'sakura-widget', 'popup,width=380,height=600');
}

async function togglePip() {
  if (desktop) {
    desktop.toggleWidget();
    return;
  }
  if (pipWindow) {
    pipWindow.close();
    return;
  }
  if (!('documentPictureInPicture' in window)) {
    openPopup();
    return;
  }
  try {
    pipWindow = await window.documentPictureInPicture.requestWindow({ width: 360, height: 480 });
  } catch {
    openPopup();
    return;
  }
  const doc = pipWindow.document;
  const link = doc.createElement('link');
  link.rel = 'stylesheet';
  link.href = new URL('styles.css', location.href).href;
  doc.head.append(link);
  doc.title = document.title;
  doc.body.className = 'mode-widget in-pip';
  doc.body.append(stage, $('#toast').cloneNode(true));
  scene.setWindow(pipWindow);
  if (snap) applyAccent(themeOf(focusedTree().id));
  $('#pip-placeholder').hidden = false;
  pipWindow.addEventListener('resize', updateInsets);
  pipWindow.addEventListener('pagehide', () => {
    app.prepend(stage);
    pipWindow = null;
    scene.setWindow(window);
    $('#pip-placeholder').hidden = true;
    requestAnimationFrame(updateInsets);
  });
  setTimeout(updateInsets, 60);
  renderStatus();
}

// --- Etkileşimler ------------------------------------------------------------------------------

function armConfirm(button, label, action) {
  if (button.dataset.armed) {
    delete button.dataset.armed;
    button.classList.remove('confirm');
    button.textContent = button.dataset.label;
    action();
    return;
  }
  button.dataset.label = button.textContent;
  button.dataset.armed = '1';
  button.classList.add('confirm');
  button.textContent = label;
  setTimeout(() => {
    if (!button.dataset.armed) return;
    delete button.dataset.armed;
    button.classList.remove('confirm');
    button.textContent = button.dataset.label;
  }, 3500);
}

function bindUi() {
  $('#settings-btn').addEventListener('click', () => {
    sheet.showModal();
    renderSettings();
  });
  $('[data-close]', sheet).addEventListener('click', () => sheet.close());
  sheet.addEventListener('click', (event) => {
    if (event.target === sheet) sheet.close();
  });
  for (const id of ['#pip-btn', '#pip-btn-2', '#pip-return']) $(id).addEventListener('click', togglePip);
  $('#popup-btn').addEventListener('click', () => (desktop ? desktop.toggleWidget() : openPopup()));
  if (desktop) {
    $('#pip-btn').title = 'Widget penceresini aç / kapat';
    $('#pip-btn-2').textContent = 'Widget penceresi';
    $('#popup-btn').hidden = true;
    $('#widget-hint').textContent = 'Widget, diğer pencerelerin üstünde duran küçük bir penceredir. Sistem tepsisindeki 🌸 simgesinden de açılır.';
    $('#shutdown').textContent = 'Uygulamadan çık';
  } else if (!('documentPictureInPicture' in window)) {
    $('#pip-btn').title = 'Küçük widget penceresi aç';
  }

  $('#source-chips').addEventListener('click', (event) => {
    const chip = event.target.closest('[data-focus]');
    if (!chip || !snap?.trees.some((tree) => tree.id === chip.dataset.focus)) return;
    focusOverride = focusOverride === chip.dataset.focus ? null : chip.dataset.focus;
    render();
  });

  sheet.addEventListener('click', (event) => {
    const target = event.target.closest('button');
    if (!target || preview) return;
    if (target.dataset.mode && target.dataset.mode !== snap.settings.mode) post('/api/settings', { mode: target.dataset.mode });
    if (target.dataset.layout && target.dataset.layout !== snap.settings.layout) post('/api/settings', { layout: target.dataset.layout });
    if (target.dataset.target) post('/api/settings', { target: Number(target.dataset.target) });
    if (target.dataset.metric && target.dataset.metric !== snap.settings.metric) post('/api/settings', { metric: target.dataset.metric });
    if (target.dataset.source) post('/api/settings', { sources: { [target.dataset.source]: target.getAttribute('aria-checked') !== 'true' } });
  });
  $('#target-input').addEventListener('change', (event) => {
    const value = Math.round(Number(event.target.value));
    if (!preview && value >= 1000) post('/api/settings', { target: value });
  });
  $('#replant').addEventListener('click', (event) => {
    if (preview) return;
    armConfirm(event.currentTarget, 'Emin misin? Ağaçlar sıfırlanır — tekrar tıkla', () => post('/api/replant'));
  });
  $('#shutdown').addEventListener('click', (event) => {
    if (preview) return;
    armConfirm(event.currentTarget, desktop ? 'Çıkmak için tekrar tıkla' : 'Kapatmak için tekrar tıkla', async () => {
      if (desktop) {
        desktop.quit();
        return;
      }
      await post('/api/shutdown');
      toast('Sunucu kapatıldı. Yeniden başlatmak için Sakura.cmd');
    });
  });
  for (const button of $$('[data-desktop]')) {
    button.addEventListener('click', () => {
      if (!desktop) return;
      if (button.dataset.desktop === 'open') desktop.openMain();
      if (button.dataset.desktop === 'hide') desktop.toggleWidget();
    });
  }
  canvas.addEventListener('click', (event) => scene.poke(event.clientX, event.clientY));
  addEventListener('resize', () => requestAnimationFrame(updateInsets));
  new ResizeObserver(() => updateInsets()).observe($('#panel'));
}

bindUi();
updateInsets();
setInterval(() => snap && (renderStatus(), renderChips()), 1000);
if (preview) {
  connected = true;
  startPreview();
} else {
  connect();
}
