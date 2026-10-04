// Sakura Sohbet Bahçesi — açılır pencere: bağlantı, Ume ağacının bugünkü durumu ve ölçüm anahtarı.

const CHARS_PER_TOKEN = 3.5;
const $ = (id) => document.getElementById(id);
const nf = (digits) => new Intl.NumberFormat('tr-TR', { maximumFractionDigits: digits });
function short(value) {
  const n = Math.max(0, value || 0);
  if (n < 1000) return nf(0).format(n);
  if (n < 1e6) return `${nf(n < 1e4 ? 1 : 0).format(n / 1e3)}K`;
  return `${nf(n < 1e7 ? 2 : 1).format(n / 1e6)}M`;
}

let port = null;

function setStatus(state, message) {
  $('status').dataset.state = state;
  $('status-text').textContent = message;
}

function renderStatus(status) {
  if (!status) {
    setStatus('warn', 'Eklenti durumu okunamadı');
    return;
  }
  $('enabled').checked = status.enabled;
  $('replies').textContent = `${nf(0).format(status.today.replies)} yanıt`;
  $('output').textContent = `~${short(status.today.outputChars / CHARS_PER_TOKEN)} token`;
  const connection = status.connection;
  port = connection && connection.ok ? connection.port : status.port;
  const queued = status.queued ? ` · ${status.queued} ölçüm kuyrukta` : '';
  if (!status.enabled) setStatus('idle', 'Ölçüm kapalı');
  else if (!connection) setStatus('idle', 'Hazır — claude.ai’de sohbet et');
  else if (connection.ok) setStatus('ok', `Bağlı · 127.0.0.1:${connection.port}${queued}`);
  else if (connection.reason === 'demo') setStatus('warn', `Sakura demo modunda${queued}`);
  else if (connection.reason === 'update') setStatus('warn', `Sakura uygulamasını güncelle (1.2+)${queued}`);
  else setStatus('warn', `Sakura uygulaması kapalı${queued}`);
}

// Ağacın durumu doğrudan uygulamadan okunur (etkin ölçü ve hedefle).
async function renderTree() {
  if (!port) port = await probe();
  $('open').disabled = !port;
  if (!port) return;
  try {
    const snap = await (await fetch(`http://127.0.0.1:${port}/api/state`, { cache: 'no-store' })).json();
    const tree = snap.trees.find((item) => item.id === 'chat' && !item.combined);
    const value = tree ? tree.value : (snap.bySource.chat && snap.bySource.chat.value) || 0;
    const progress = value / snap.settings.target;
    $('value').textContent = short(value);
    $('target').textContent = `/ ${short(snap.settings.target)} token`;
    $('percent').textContent = `%${Math.min(100, Math.floor(progress * 100))}`;
    $('bar').style.width = `${Math.min(100, progress * 100)}%`;
    const metric = snap.metrics[snap.settings.metric];
    const off = snap.settings.sources.chat === false ? ' · uygulamada kaynak kapalı' : '';
    $('tree-meta').textContent = `${snap.season.label} · ${metric ? metric.label : ''} ölçü${off}`;
    $('tree').hidden = false;
    if (!snap.sources || !snap.sources.chat) $('tree-meta').textContent += ' · uygulamayı güncelle';
  } catch {
    $('tree').hidden = true;
  }
}

async function probe() {
  for (let candidate = 4870; candidate < 4880; candidate += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${candidate}/api/health`, { cache: 'no-store', signal: AbortSignal.timeout(600) });
      if ((await response.json()).app === 'sakura-token-garden') return candidate;
    } catch {
      // sıradaki port
    }
  }
  return null;
}

async function refresh() {
  renderStatus(await chrome.runtime.sendMessage({ type: 'status' }));
  await renderTree();
}

$('enabled').addEventListener('change', async (event) => {
  renderStatus(await chrome.runtime.sendMessage({ type: 'set-enabled', enabled: event.target.checked }));
});

$('open').addEventListener('click', () => {
  if (port) chrome.tabs.create({ url: `http://127.0.0.1:${port}/` });
});

refresh();
