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

const APP_ID = 'sakura-token-garden';

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

function readJson(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
      if (body.length > 16_384) {
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
  constructor({ port = 4870, demo = false, dataDir, publicDir, desktop = false } = {}) {
    super();
    this.preferredPort = port;
    this.demo = demo;
    this.desktop = desktop;
    this.publicDir = publicDir || path.join(__dirname, '..', 'public');
    this.stateFile = path.join(dataDir || path.join(__dirname, '..', 'data'), demo ? 'demo-state.json' : 'state.json');
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
    this.tracker = demo ? new DemoTracker() : new Tracker({ horizon });
    this.tracker.on('events', () => this.broadcast());
    this.tracker.on('warn', (error) => this.emit('warn', error));
  }

  snapshot() {
    return garden.snapshot(this.state, this.tracker.events, Date.now(), {
      ready: this.tracker.ready,
      demo: this.demo,
      desktop: this.desktop,
      sources: this.tracker.info(),
    });
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
      const origin = req.headers.origin;
      if (origin && origin !== `http://${req.headers.host}`) return send(res, 403, { error: 'origin' });
      let body;
      try { body = await readJson(req); } catch { return send(res, 400, { error: 'body' }); }

      if (pathname === '/api/settings') {
        this.updateState(garden.applySettings(this.state, body, Date.now()));
        return send(res, 200, this.snapshot());
      }
      if (pathname === '/api/replant') {
        this.updateState(garden.replant(this.state, Date.now(), this.snapshot().value));
        return send(res, 200, this.snapshot());
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

    // Etkinlik durumu, hız ve gün dönümü için düzenli yenileme.
    this.timers.push(setInterval(() => this.broadcast(), 5000));
    this.timers.push(setInterval(() => {
      const now = Date.now();
      this.tracker.prune(Math.min(garden.season(this.state, now).start, garden.dayStart(now) - garden.GARDEN_DAYS * garden.DAY));
    }, 60 * 60 * 1000));
    // SSE bağlantılarını canlı tutmak için yorum satırı.
    this.timers.push(setInterval(() => {
      for (const client of this.clients) client.write(': ping\n\n');
    }, 15000));
    for (const timer of this.timers) timer.unref();
    this.broadcast();
    return { port: this.port, url: `http://127.0.0.1:${this.port}`, existing: false };
  }

  stop() {
    this.tracker.stop();
    this.timers.forEach(clearInterval);
    for (const client of this.clients) client.end();
    this.clients.clear();
    return new Promise((resolve) => {
      if (!this.server) return resolve();
      this.server.close(() => resolve());
      setTimeout(resolve, 500).unref();
    });
  }
}

module.exports = { SakuraServer, APP_ID };
