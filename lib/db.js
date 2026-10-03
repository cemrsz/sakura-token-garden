'use strict';
// Kullanıcının bilgisayarında kalıcı token / kod satırı geçmişi (Node'un yerleşik SQLite'ı).
// Her model çağrısı ve her VS Code satır kaydı tekil bir id ile saklanır; transcriptler
// tekrar okunduğunda aynı kayıt iki kez sayılmaz. Günlük/haftalık özetler bu tablodan çıkar.
// Dosyayı herhangi bir SQLite aracıyla açıp daily_usage / weekly_usage görünümlerini sorgulayabilirsin.

const fs = require('node:fs');
const path = require('node:path');

let DatabaseSync = null;
try {
  // Node 22.5+ ve Electron 33+ ile gelir; yoksa uygulama veritabanısız çalışmaya devam eder.
  ({ DatabaseSync } = require('node:sqlite'));
} catch {
  DatabaseSync = null;
}

function dayKey(ts) {
  const date = new Date(ts);
  const pad = (value) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

const SCHEMA = `
  PRAGMA journal_mode = WAL;
  PRAGMA synchronous = NORMAL;
  PRAGMA busy_timeout = 5000;

  CREATE TABLE IF NOT EXISTS events (
    id          TEXT PRIMARY KEY,
    ts          INTEGER NOT NULL,
    day         TEXT    NOT NULL,
    source      TEXT    NOT NULL,
    session     TEXT,
    project     TEXT,
    model       TEXT,
    input       INTEGER NOT NULL DEFAULT 0,
    output      INTEGER NOT NULL DEFAULT 0,
    cache_write INTEGER NOT NULL DEFAULT 0,
    cache_read  INTEGER NOT NULL DEFAULT 0,
    lines       INTEGER NOT NULL DEFAULT 0,
    chars       INTEGER NOT NULL DEFAULT 0
  );
  CREATE INDEX IF NOT EXISTS events_day ON events (day, source);
  CREATE INDEX IF NOT EXISTS events_ts ON events (ts);

  CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT);

  -- Bahçem: hedefe ulaşıp dikilen ağaçlar. seed her ağaca kendine özgü bir şekil verir.
  CREATE TABLE IF NOT EXISTS garden (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    source       TEXT    NOT NULL,
    planted_at   INTEGER NOT NULL,
    season_key   TEXT,
    season_start INTEGER,
    value        INTEGER NOT NULL,
    target       INTEGER NOT NULL,
    unit         TEXT    NOT NULL,
    metric       TEXT,
    seed         INTEGER NOT NULL,
    auto         INTEGER NOT NULL DEFAULT 0
  );

  CREATE VIEW IF NOT EXISTS daily_usage AS
    SELECT day, source, COUNT(*) AS calls,
           SUM(input) AS input, SUM(output) AS output, SUM(cache_write) AS cache_write, SUM(cache_read) AS cache_read,
           SUM(lines) AS lines, SUM(chars) AS chars
    FROM events GROUP BY day, source;

  -- Haftalar pazartesi başlar (SQLite %W).
  CREATE VIEW IF NOT EXISTS weekly_usage AS
    SELECT strftime('%Y-W%W', day) AS week, MIN(day) AS first_day, source, COUNT(*) AS calls,
           SUM(input) AS input, SUM(output) AS output, SUM(cache_write) AS cache_write, SUM(cache_read) AS cache_read,
           SUM(lines) AS lines, SUM(chars) AS chars
    FROM events GROUP BY week, source;
`;

class UsageDb {
  static available() {
    return Boolean(DatabaseSync);
  }

  constructor(file) {
    if (!DatabaseSync) throw new Error('node:sqlite bulunamadı (Node 22.5+ gerekli)');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    this.file = file;
    this.db = new DatabaseSync(file);
    this.db.exec(SCHEMA);
    // Aynı id tekrar gelirse değerlerin büyüğü tutulur: yeniden okumak sonucu değiştirmez.
    this.upsert = this.db.prepare(`
      INSERT INTO events (id, ts, day, source, session, project, model, input, output, cache_write, cache_read, lines, chars)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        input = max(input, excluded.input),
        output = max(output, excluded.output),
        cache_write = max(cache_write, excluded.cache_write),
        cache_read = max(cache_read, excluded.cache_read),
        lines = max(lines, excluded.lines),
        chars = max(chars, excluded.chars)
    `);
    this.revision = 0;
  }

  addEvents(events) {
    if (!events.length) return 0;
    this.db.exec('BEGIN');
    try {
      for (const event of events) {
        if (!event.id) continue;
        const total = event.total || event;
        this.upsert.run(
          event.id, Math.round(event.ts), dayKey(event.ts), event.source,
          event.session || '', event.project || '', event.model || '',
          Math.round(total.input || 0), Math.round(total.output || 0),
          Math.round(total.cacheWrite || 0), Math.round(total.cacheRead || 0),
          Math.round(event.lines || 0), Math.round(event.chars || 0),
        );
      }
      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
    this.revision += 1;
    return events.length;
  }

  // Gün ve kaynak bazında toplamlar (fromDay dahil).
  daily(fromDay) {
    return this.db.prepare(`
      SELECT day, source, COUNT(*) AS calls,
             SUM(input) AS input, SUM(output) AS output, SUM(cache_write) AS cacheWrite, SUM(cache_read) AS cacheRead,
             SUM(lines) AS lines, SUM(chars) AS chars
      FROM events WHERE day >= ? GROUP BY day, source ORDER BY day
    `).all(fromDay);
  }

  totals() {
    return this.db.prepare(`
      SELECT source, COUNT(*) AS calls, MIN(day) AS firstDay,
             SUM(input) AS input, SUM(output) AS output, SUM(cache_write) AS cacheWrite, SUM(cache_read) AS cacheRead,
             SUM(lines) AS lines, SUM(chars) AS chars
      FROM events GROUP BY source
    `).all();
  }

  // Bir zaman aralığındaki kaynak toplamları (sezon ilerlemesi için).
  sumSince(ts) {
    return this.db.prepare(`
      SELECT source, COUNT(*) AS calls, MAX(ts) AS lastAt,
             SUM(input) AS input, SUM(output) AS output, SUM(cache_write) AS cacheWrite, SUM(cache_read) AS cacheRead,
             SUM(lines) AS lines, SUM(chars) AS chars
      FROM events WHERE ts >= ? GROUP BY source
    `).all(ts);
  }

  // Belirli bir aralıktaki kaynak toplamları (kapanan sezonu hesaplamak için).
  sumBetween(start, end) {
    return this.db.prepare(`
      SELECT source, COUNT(*) AS calls,
             SUM(input) AS input, SUM(output) AS output, SUM(cache_write) AS cacheWrite, SUM(cache_read) AS cacheRead,
             SUM(lines) AS lines, SUM(chars) AS chars
      FROM events WHERE ts >= ? AND ts < ? GROUP BY source
    `).all(start, end);
  }

  plant(tree) {
    const result = this.db.prepare(`
      INSERT INTO garden (source, planted_at, season_key, season_start, value, target, unit, metric, seed, auto)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(tree.source, tree.plantedAt, tree.seasonKey || '', tree.seasonStart || 0, Math.round(tree.value), Math.round(tree.target),
      tree.unit, tree.metric || '', tree.seed, tree.auto ? 1 : 0);
    this.revision += 1;
    return Number(result.lastInsertRowid);
  }

  gardenCount() {
    return this.db.prepare('SELECT COUNT(*) AS count FROM garden').get().count;
  }

  gardenList() {
    return this.db.prepare(`
      SELECT id, source, planted_at AS plantedAt, season_key AS seasonKey, season_start AS seasonStart,
             value, target, unit, metric, seed, auto
      FROM garden ORDER BY id
    `).all();
  }

  getMeta(key) {
    const row = this.db.prepare('SELECT value FROM meta WHERE key = ?').get(key);
    return row ? row.value : null;
  }

  setMeta(key, value) {
    this.db.prepare('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, String(value));
  }

  info() {
    let size = 0;
    for (const suffix of ['', '-wal']) {
      try { size += fs.statSync(this.file + suffix).size; } catch { /* yok */ }
    }
    const row = this.db.prepare('SELECT COUNT(*) AS count, MIN(day) AS firstDay FROM events').get();
    return { path: this.file, size, events: row.count, firstDay: row.firstDay };
  }

  close() {
    try { this.db.close(); } catch { /* zaten kapalı */ }
  }
}

module.exports = { UsageDb, dayKey };
