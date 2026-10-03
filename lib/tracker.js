'use strict';
// Claude Code ve Codex transcript klasörlerini izler, yeni eklenen satırları okuyup
// token olaylarına çevirir. Dosyalar yalnızca sona eklendiği için her dosyanın okunan
// bayt konumu saklanır; yarım kalan son satır, satır sonu gelene kadar bekletilir.

const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const { createClaudeParser, createCodexFileState, parseCodexLine } = require('./parsers');

const CHUNK = 1 << 20;
const HOT_WINDOW = 30 * 60 * 1000;

function existingDirs(candidates) {
  const unique = [...new Set(candidates.filter(Boolean).map((dir) => path.resolve(dir)))];
  return unique.filter((dir) => {
    try { return fs.statSync(dir).isDirectory(); } catch { return false; }
  });
}

function defaultRoots() {
  const home = os.homedir();
  return {
    claude: [
      process.env.CLAUDE_CONFIG_DIR && path.join(process.env.CLAUDE_CONFIG_DIR, 'projects'),
      path.join(home, '.claude', 'projects'),
      path.join(home, '.config', 'claude', 'projects'),
    ],
    codex: [
      process.env.CODEX_HOME && path.join(process.env.CODEX_HOME, 'sessions'),
      path.join(home, '.codex', 'sessions'),
    ],
  };
}

async function walkJsonl(dir, depth, out) {
  let entries;
  try { entries = await fsp.readdir(dir, { withFileTypes: true }); } catch { return out; }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (depth > 0) await walkJsonl(full, depth - 1, out);
    } else if (entry.name.endsWith('.jsonl')) {
      out.push(full);
    }
  }
  return out;
}

class Tracker extends EventEmitter {
  constructor({ roots = defaultRoots(), horizon = 0, sources = ['claude', 'codex'] } = {}) {
    super();
    this.roots = {};
    for (const source of sources) this.roots[source] = existingDirs(roots[source] || []);
    this.horizon = horizon;
    this.events = [];
    this.files = new Map();
    this.parseClaude = createClaudeParser();
    this.queue = Promise.resolve();
    this.timers = [];
    this.watchers = [];
    this.ready = false;
  }

  async start() {
    await this.discover();
    this.ready = true;
    this.emit('ready');
    this.watch();
    this.timers.push(setInterval(() => this.enqueue(() => this.pollHot()), 2000));
    this.timers.push(setInterval(() => this.enqueue(() => this.discover()), 10000));
  }

  stop() {
    this.timers.forEach(clearInterval);
    this.watchers.forEach((watcher) => watcher.close());
    this.timers = [];
    this.watchers = [];
  }

  // Tüm okuma işlemleri sıraya alınır; aynı dosya iki kez eşzamanlı okunmaz.
  enqueue(task) {
    this.queue = this.queue.then(task).catch((error) => this.emit('warn', error));
    return this.queue;
  }

  async discover() {
    for (const [source, dirs] of Object.entries(this.roots)) {
      for (const dir of dirs) {
        const files = await walkJsonl(dir, 5, []);
        for (const file of files) {
          if (this.files.has(file)) continue;
          let stat;
          try { stat = await fsp.stat(file); } catch { continue; }
          if (stat.mtimeMs < this.horizon) continue;
          this.files.set(file, this.createFileState(source, file));
          await this.readFile(file);
        }
      }
    }
  }

  createFileState(source, file) {
    const session = path.basename(file, '.jsonl');
    const state = { source, file, offset: 0, rest: null, mtimeMs: 0, size: 0 };
    if (source === 'codex') state.codex = createCodexFileState({ session });
    else state.fallback = { session, project: path.basename(path.dirname(file)) };
    return state;
  }

  watch() {
    for (const dirs of Object.values(this.roots)) {
      for (const dir of dirs) {
        try {
          const watcher = fs.watch(dir, { recursive: true }, (_type, name) => {
            if (!name || !String(name).endsWith('.jsonl')) return;
            const file = path.join(dir, String(name));
            this.enqueue(() => (this.files.has(file) ? this.readFile(file) : this.discover()));
          });
          watcher.on('error', () => {});
          this.watchers.push(watcher);
        } catch {
          // Özyinelemeli izleme desteklenmiyorsa periyodik yoklama yeterli.
        }
      }
    }
  }

  async pollHot() {
    const now = Date.now();
    for (const [file, state] of this.files) {
      if (now - state.mtimeMs > HOT_WINDOW) {
        // Soğuk dosyalar daha seyrek kontrol edilir.
        if (Math.random() > 0.1) continue;
      }
      await this.readFile(file);
    }
  }

  async readFile(file) {
    const state = this.files.get(file);
    if (!state) return;
    let stat;
    try { stat = await fsp.stat(file); } catch { return; }
    state.mtimeMs = stat.mtimeMs;
    if (stat.size < state.offset) {
      // Dosya kısaldıysa baştan okunur; Claude tekilleştirmesi çift sayımı engeller.
      state.offset = 0;
      state.rest = null;
      if (state.codex) state.codex = createCodexFileState({ session: state.codex.session });
    }
    if (stat.size === state.offset) return;

    const fresh = [];
    const handle = await fsp.open(file, 'r');
    try {
      const buffer = Buffer.allocUnsafe(CHUNK);
      let position = state.offset;
      while (position < stat.size) {
        const { bytesRead } = await handle.read(buffer, 0, Math.min(CHUNK, stat.size - position), position);
        if (!bytesRead) break;
        position += bytesRead;
        let data = buffer.subarray(0, bytesRead);
        if (state.rest) {
          data = Buffer.concat([state.rest, data]);
          state.rest = null;
        }
        let start = 0;
        let newline;
        while ((newline = data.indexOf(10, start)) !== -1) {
          if (newline > start) {
            const event = this.parseLine(state, data.toString('utf8', start, newline));
            if (event && event.ts >= this.horizon) fresh.push(event);
          }
          start = newline + 1;
        }
        if (start < data.length) state.rest = Buffer.from(data.subarray(start));
      }
      state.offset = position;
      state.size = stat.size;
    } finally {
      await handle.close();
    }

    if (fresh.length) {
      for (const event of fresh) this.events.push(event);
      if (this.ready) this.emit('events', fresh);
    }
  }

  parseLine(state, line) {
    if (state.source === 'codex') return parseCodexLine(line, state.codex);
    return this.parseClaude(line, state.fallback);
  }

  // Uzun süre açık kalan sunucuda bellek büyümesin diye eski olaylar atılır.
  prune(before) {
    if (this.events.some((event) => event.ts < before)) {
      this.events = this.events.filter((event) => event.ts >= before);
    }
  }

  info() {
    const now = Date.now();
    const result = {};
    for (const [source, dirs] of Object.entries(this.roots)) {
      let files = 0;
      let active = 0;
      for (const state of this.files.values()) {
        if (state.source !== source) continue;
        files += 1;
        if (now - state.mtimeMs < 10 * 60 * 1000) active += 1;
      }
      result[source] = { found: dirs.length > 0, dirs, files, active };
    }
    return result;
  }
}

module.exports = { Tracker, defaultRoots };
