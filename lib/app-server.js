'use strict';
// Sakura Token Bahçesi sunucusu: transcriptleri izler, anlık görüntüleri SSE ile akıtır.
// Hem komut satırından (server.js) hem masaüstü uygulamasından (desktop/main.js) kullanılır.

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const { Tracker } = require('./tracker');
const { DemoTracker } = require('./demo');
const garden = require('./garden');
const { UsageDb } = require('./db');
const { buildStats, toCsv, weekStart } = require('./stats');
const { appDataDir } = require('./paths');
const { ingestChat } = require('./chat-ingest');

const APP_ID = 'sakura-token-garden';
const randomSeed = () => Math.floor(Math.random() * 2 ** 31);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
};

function send(res, status, body, type = 'application/json; charset=utf-8') {
  res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store' });
  res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
}

// Tarayıcı eklentisinin kökeni (Chrome, Edge, Brave, Firefox, Safari).
const EXTENSION_ORIGIN = /^(chrome|moz|safari-web)-extension:\/\/[\w-]+$/i;

function readJson(req, limit = 16_384) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
      if (body.length > limit) {
        reject(new Error('too large'));
        req.destroy();
      }
    });
    req.on('end', () => {
      try { resolve(body ? JSON.parse(body) : {}); } catch (error) { reject(error); }
    });
    req.on('error', reject);
  });
}

function checkExisting(port) {
  return new Promise((resolve) => {
    const req = http.get({ host: '127.0.0.1', port, path: '/api/health', timeout: 800 }, (res) => {
      let body = '';
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => {
        try { resolve(JSON.parse(body).app === APP_ID); } catch { resolve(false); }
      });
    });
    req.on('error', () => resolve(false));
    req.on('timeout', () => { req.destroy(); resolve(false); });
  });
}

class SakuraServer extends EventEmitter {
  constructor({ port = 4870, demo = false, dataDir, publicDir, desktop = false, roots } = {}) {
    super();
    this.preferredPort = port;
    this.demo = demo;
    this.desktop = desktop;
    this.publicDir = publicDir || path.join(__dirname, '..', 'public');
    // Masaüstü ve tarayıcı sürümü aynı klasörü kullanır: ayarlar ve geçmiş ortaktır.
    this.dataDir = dataDir || path.join(appDataDir(), 'data');
    this.stateFile = path.join(this.dataDir, demo ? 'demo-state.json' : 'state.json');
    this.discoveryFile = demo ? null : path.join(appDataDir(), 'server.json');
    this.clients = new Set();
    this.timers = [];
    this.server = null;
    this.port = null;
    this.broadcastTimer = null;
    this.lastBroadcast = 0;

    this.state = garden.loadState(this.stateFile);
    if (demo && !fs.existsSync(this.stateFile)) {
      this.state = garden.applySettings(this.state, { mode: 'manual', target: 600_000 }, Date.now());
      garden.saveState(this.stateFile, this.state);
    }
    const now = Date.now();
    const horizon = Math.min(garden.season(this.state, now).start, garden.dayStart(now) - (garden.GARDEN_DAYS - 1) * garden.DAY);
    // Kullanıcının bilgisayarındaki kalıcı veritabanı (günlük / haftalık geçmiş).
    this.db = null;
    if (UsageDb.available()) {
      try {
        this.db = new UsageDb(path.join(this.dataDir, demo ? 'demo.db' : 'sakura.db'));
      } catch (error) {
        this.emit('warn', error);
      }
    }
    const sink = (events) => this.db && this.db.addEvents(events);
    // Tarayıcı eklentisinin claude.ai ölçümleri buraya yazılır, izleyici buradan okur.
    this.chatDir = path.join(appDataDir(), 'claude-web');
    if (!demo) {
      fs.mkdirSync(path.join(appDataDir(), 'vscode'), { recursive: true });
      fs.mkdirSync(this.chatDir, { recursive: true });
    }
    this.tracker = demo ? new DemoTracker() : new Tracker({ horizon, sink, roots });
    this.tracker.on('events', (events) => {
      if (demo) sink(events);
      this.broadcast();
    });
    this.tracker.on('backfill', () => this.broadcast());
    this.tracker.on('warn', (error) => this.emit('warn', error));
  }

  snapshot() {
    return garden.snapshot(this.state, this.tracker.events, Date.now(), {
      ready: this.tracker.ready,
      demo: this.demo,
      desktop: this.desktop,
      sources: this.tracker.info(),
      db: this.db ? { revision: this.db.revision } : null,
      backfill: this.tracker.backfillState || null,
      gardenInfo: this.db ? { count: this.gardenCount, autoPlanted: this.autoPlanted } : null,
    });
  }

  get gardenCount() {
    try { return this.db ? this.db.gardenCount() : 0; } catch { return 0; }
  }

  // Bir sezonu kapatır: tamamlanmış ama dikilmemiş ağaçları bahçeye kendiliğinden diker.
  closeSeason(key, start, end, state = this.state) {
    if (!this.db || end <= start) return 0;
    let planted = 0;
    for (const tree of garden.completedTrees(state, this.db.sumBetween(start, end), key)) {
      for (let i = 0; i < tree.count; i += 1) {
        this.db.plant({ source: tree.source, plantedAt: end - 1, seasonKey: key, seasonStart: start, value: tree.target, target: tree.target, unit: tree.unit, metric: state.metric, seed: randomSeed(), auto: true });
        planted += 1;
      }
    }
    return planted;
  }

  // Sezon değiştiyse (gece yarısı, mod değişimi ya da uygulama kapalıyken geçen gün) öncekini kapatır.
  settleSeason() {
    if (!this.db || this.demo) return;
    const now = Date.now();
    const current = garden.season(this.state, now);
    let state = this.state;
    let planted = 0;
    if (!this.db.getMeta('garden_migrated')) {
      // Bahçe özelliğinden önce tamamlanmış sezonlar (Yeni tohum geçmişi) bir kez bahçeye taşınır.
      for (const item of state.history) {
        if (!item.end || !item.value || item.value < item.target) continue;
        const past = garden.applySettings(state, { metric: item.metric, target: item.target }, now);
        planted += this.closeSeason(`h:${item.start}`, item.start, item.end, { ...past, harvest: { key: null, offsets: {} } });
      }
      this.db.setMeta('garden_migrated', now);
    }
    const seen = state.seasonSeen;
    if (seen && seen.key !== current.key) {
      const end = seen.key.startsWith('d:') ? Math.min(seen.start + garden.DAY, now) : now;
      planted += this.closeSeason(seen.key, seen.start, end);
    }
    if (!seen || seen.key !== current.key) {
      state = garden.normalizeState({ ...this.state, seasonSeen: { key: current.key, start: current.start } });
      this.state = state;
      garden.saveState(this.stateFile, this.state);
    }
    if (planted) {
      this.autoPlanted = { count: planted, at: now };
      this.broadcast();
    }
  }

  plantTree(id) {
    if (!this.db) return { status: 503, body: { error: 'db' } };
    const now = Date.now();
    const snap = this.snapshot();
    const tree = snap.trees.find((item) => item.id === id && item.progress >= 1);
    if (!tree) return { status: 409, body: { error: 'not-ready' } };
    const target = tree.unit === 'lines' ? this.state.codeTarget : this.state.target;
    const plantedId = this.db.plant({
      source: tree.id, plantedAt: now, seasonKey: snap.season.key, seasonStart: snap.season.start,
      value: target, target, unit: tree.unit, metric: tree.unit === 'lines' ? '' : this.state.metric, seed: randomSeed(), auto: false,
    });
    this.updateState(garden.harvest(this.state, tree.combined ? 'combined' : tree.id, target, now));
    return { status: 200, body: { planted: { id: plantedId, source: tree.id }, ...this.snapshot() } };
  }

  stats(days = 30, weeks = 12) {
    if (!this.db) return { available: false };
    const now = Date.now();
    const from = Math.min(garden.dayStart(now) - (days - 1) * garden.DAY, weekStart(now) - (weeks - 1) * 7 * garden.DAY);
    const result = buildStats(this.db.daily(garden.dayKey(from)), { state: this.state, now, days, weeks });
    const allTime = {};
    for (const row of this.db.totals()) allTime[row.source] = row;
    return { available: true, ...result, allTime, db: this.db.info(), backfill: this.tracker.backfillState || null };
  }

  broadcast() {
    if (this.broadcastTimer) return;
    const wait = Math.max(0, 250 - (Date.now() - this.lastBroadcast));
    this.broadcastTimer = setTimeout(() => {
      this.broadcastTimer = null;
      this.lastBroadcast = Date.now();
      const snap = this.snapshot();
      this.emit('snapshot', snap);
      if (!this.clients.size) return;
      const payload = `event: snapshot\ndata: ${JSON.stringify(snap)}\n\n`;
      for (const client of this.clients) client.write(payload);
    }, wait);
  }

  updateState(next) {
    this.state = next;
    garden.saveState(this.stateFile, this.state);
    this.broadcast();
  }

  allowedHost(req) {
    const host = String(req.headers.host || '').toLowerCase();
    return [`127.0.0.1:${this.port}`, `localhost:${this.port}`, `[::1]:${this.port}`].includes(host);
  }

  serveStatic(res, pathname) {
    const requested = pathname === '/' ? '/index.html' : decodeURIComponent(pathname);
    const file = path.resolve(this.publicDir, `.${requested}`);
    if (!file.startsWith(this.publicDir + path.sep)) return send(res, 403, { error: 'forbidden' });
    fs.readFile(file, (error, data) => {
      if (error) return send(res, 404, 'Bulunamadı', 'text/plain; charset=utf-8');
      send(res, 200, data, MIME[path.extname(file)] || 'application/octet-stream');
    });
    return undefined;
  }

  async handle(req, res) {
    // DNS rebinding ve başka sitelerden gelen isteklere karşı yalnızca yerel host kabul edilir.
    if (!this.allowedHost(req)) return send(res, 403, { error: 'host' });
    const { pathname } = new URL(req.url, `http://${req.headers.host}`);

    if (req.method === 'GET' && pathname === '/api/health') return send(res, 200, { app: APP_ID, ok: true });
    if (req.method === 'GET' && pathname === '/api/state') return send(res, 200, this.snapshot());
    if (req.method === 'GET' && pathname === '/api/stats') {
      const query = new URL(req.url, 'http://x').searchParams;
      const clampInt = (value, min, max, fallback) => Math.max(min, Math.min(max, Math.round(Number(value)) || fallback));
      return send(res, 200, this.stats(clampInt(query.get('days'), 7, 120, 30), clampInt(query.get('weeks'), 4, 52, 12)));
    }
    if (req.method === 'GET' && pathname === '/api/garden') {
      if (!this.db) return send(res, 200, { available: false, items: [] });
      return send(res, 200, { available: true, items: this.db.gardenList() });
    }
    if (req.method === 'GET' && pathname === '/api/stats.csv') {
      if (!this.db) return send(res, 404, { error: 'db' });
      res.writeHead(200, {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': 'attachment; filename="sakura-token-gecmisi.csv"',
        'Cache-Control': 'no-store',
      });
      res.end(toCsv(this.db.daily('0000-00-00'), this.state));
      return undefined;
    }

    if (req.method === 'GET' && pathname === '/api/stream') {
      res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-store', Connection: 'keep-alive' });
      res.write(`retry: 2000\nevent: snapshot\ndata: ${JSON.stringify(this.snapshot())}\n\n`);
      this.clients.add(res);
      req.on('close', () => this.clients.delete(res));
      return undefined;
    }

    if (req.method === 'POST' && pathname.startsWith('/api/')) {
      // application/json zorunluluğu, başka sitelerden gelen basit form isteklerini engeller.
      if (!String(req.headers['content-type'] || '').includes('application/json')) return send(res, 415, { error: 'json' });
      // Yalnızca aynı köken; tarayıcı eklentisi yalnızca ölçüm gönderebilir, ayarlara dokunamaz.
      const origin = req.headers.origin;
      const ingest = pathname === '/api/ingest';
      if (origin && origin !== `http://${req.headers.host}` && !(ingest && EXTENSION_ORIGIN.test(origin))) return send(res, 403, { error: 'origin' });
      let body;
      try { body = await readJson(req, ingest ? 512 * 1024 : undefined); } catch { return send(res, 400, { error: 'body' }); }

      if (ingest) {
        if (this.demo) return send(res, 503, { error: 'demo' });
        return send(res, 200, { ok: true, ...ingestChat(this.chatDir, body) });
      }

      if (pathname === '/api/settings') {
        this.updateState(garden.applySettings(this.state, body, Date.now()));
        this.settleSeason();
        return send(res, 200, this.snapshot());
      }
      if (pathname === '/api/replant') {
        // Yeni tohumdan önce bu sezonun tamamlanmış ağaçları bahçeye dikilir.
        const now = Date.now();
        const current = garden.season(this.state, now);
        const planted = this.closeSeason(current.key, current.start, now);
        const next = garden.replant(this.state, now, this.snapshot().value);
        const fresh = garden.season(next, now);
        this.updateState(garden.normalizeState({ ...next, seasonSeen: { key: fresh.key, start: fresh.start } }));
        if (planted) this.autoPlanted = { count: planted, at: now };
        return send(res, 200, this.snapshot());
      }
      if (pathname === '/api/garden/plant') {
        const result = this.plantTree(String(body.id || ''));
        if (result.status === 200) this.broadcast();
        return send(res, result.status, result.body);
      }
      if (pathname === '/api/shutdown') {
        send(res, 200, { ok: true });
        setTimeout(() => this.emit('shutdown-request'), 150);
        return undefined;
      }
      return send(res, 404, { error: 'not found' });
    }

    if (req.method === 'GET' || req.method === 'HEAD') return this.serveStatic(res, pathname);
    return send(res, 405, { error: 'method' });
  }

  listenOn(port) {
    return new Promise((resolve, reject) => {
      const server = http.createServer((req, res) => {
        this.handle(req, res).catch(() => send(res, 500, { error: 'internal' }));
      });
      server.once('error', reject);
      server.listen(port, '127.0.0.1', () => resolve(server));
    });
  }

  // reuseExisting: port başka bir Sakura sunucusundaysa yenisini açmadan onu döndür.
  async start({ reuseExisting = false, attempts = 10 } = {}) {
    let port = this.preferredPort;
    for (let i = 0; i < attempts; i += 1, port += 1) {
      this.port = port;
      try {
        this.server = await this.listenOn(port);
        break;
      } catch (error) {
        if (error.code !== 'EADDRINUSE') throw error;
        if (reuseExisting && (await checkExisting(port))) {
          return { port, url: `http://127.0.0.1:${port}`, existing: true };
        }
        if (i === attempts - 1) throw error;
      }
    }
    const started = Date.now();
    await this.tracker.start();
    this.loadMs = Date.now() - started;
    this.writeDiscovery();
    this.settleSeason();
    this.startBackfill();

    // Etkinlik durumu, hız ve gün dönümü için düzenli yenileme.
    this.timers.push(setInterval(() => {
      this.settleSeason();
      this.broadcast();
    }, 5000));
    this.timers.push(setInterval(() => {
      const now = Date.now();
      this.tracker.prune(Math.min(garden.season(this.state, now).start, garden.dayStart(now) - garden.GARDEN_DAYS * garden.DAY));
    }, 60 * 60 * 1000));
    // SSE bağlantılarını canlı tutmak için yorum satırı.
    this.timers.push(setInterval(() => {
      for (const client of this.clients) client.write(': ping\n\n');
    }, 15000));
    this.timers.push(setInterval(() => this.markRun(), 60 * 1000));
    for (const timer of this.timers) timer.unref();
    this.broadcast();
    return { port: this.port, url: `http://127.0.0.1:${this.port}`, existing: false };
  }

  // Uygulama kapalıyken yazılmış eski kayıtları bir kez veritabanına aktarır.
  // İlk çalıştırmada her şey, sonrakilerde son çalışmadan bu yana değişen dosyalar.
  startBackfill() {
    if (!this.db || !this.tracker.backfill) return;
    const lastRun = Number(this.db.getMeta('last_run')) || 0;
    const since = lastRun ? lastRun - 2 * garden.DAY : 0;
    this.tracker.backfill(since)
      .then(() => {
        this.db.setMeta('backfill_done', Date.now());
        this.markRun();
        this.broadcast();
      })
      .catch((error) => this.emit('warn', error));
  }

  markRun() {
    if (!this.db || this.demo) return;
    // Geçmiş aktarımı bitmeden "son çalışma" ileri alınmaz; yarım kalırsa bir sonraki açılışta sürer.
    if (this.tracker.backfillState && this.tracker.backfillState.running) return;
    try { this.db.setMeta('last_run', Date.now()); } catch (error) { this.emit('warn', error); }
  }

  writeDiscovery() {
    if (!this.discoveryFile) return;
    try {
      fs.mkdirSync(path.dirname(this.discoveryFile), { recursive: true });
      fs.writeFileSync(this.discoveryFile, JSON.stringify({ app: APP_ID, url: `http://127.0.0.1:${this.port}`, port: this.port, pid: process.pid, desktop: this.desktop }, null, 2));
    } catch (error) {
      this.emit('warn', error);
    }
  }

  removeDiscovery() {
    if (!this.discoveryFile) return;
    try {
      const current = JSON.parse(fs.readFileSync(this.discoveryFile, 'utf8'));
      if (current.pid === process.pid) fs.unlinkSync(this.discoveryFile);
    } catch { /* yok */ }
  }

  stop() {
    this.markRun();
    this.removeDiscovery();
    this.tracker.stop();
    this.timers.forEach(clearInterval);
    for (const client of this.clients) client.end();
    this.clients.clear();
    if (this.db) this.db.close();
    return new Promise((resolve) => {
      if (!this.server) return resolve();
      this.server.close(() => resolve());
      setTimeout(resolve, 500).unref();
    });
  }
}

module.exports = { SakuraServer, APP_ID };
