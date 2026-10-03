#!/usr/bin/env node
'use strict';
// Sakura Token Bahçesi — komut satırı / tarayıcı sürümü.
// Masaüstü uygulaması için: npm run app
//
//   node server.js            sunucuyu başlat (http://127.0.0.1:4870)
//   node server.js --open     başlat ve tarayıcıda aç
//   node server.js --widget   başlat ve küçük uygulama penceresi (widget) olarak aç
//   node server.js --demo     sahte token akışıyla demo

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { SakuraServer } = require('./lib/app-server');

function parseArgs(argv) {
  const options = { port: Number(process.env.PORT) || 4870, open: false, widget: false, demo: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--open') options.open = true;
    else if (arg === '--widget') options.widget = true;
    else if (arg === '--demo') options.demo = true;
    else if (arg === '--port') options.port = Number(argv[++i]) || options.port;
    else if (arg.startsWith('--port=')) options.port = Number(arg.slice(7)) || options.port;
    else if (arg === '--help' || arg === '-h') {
      console.log('Kullanım: node server.js [--open] [--widget] [--demo] [--port 4870]');
      process.exit(0);
    }
  }
  return options;
}

function findAppBrowser() {
  const candidates = [];
  if (process.platform === 'win32') {
    for (const base of [process.env['ProgramFiles(x86)'], process.env.ProgramFiles, process.env.LOCALAPPDATA]) {
      if (!base) continue;
      candidates.push(path.join(base, 'Microsoft', 'Edge', 'Application', 'msedge.exe'));
      candidates.push(path.join(base, 'Google', 'Chrome', 'Application', 'chrome.exe'));
    }
  } else if (process.platform === 'darwin') {
    candidates.push('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome');
    candidates.push('/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge');
  } else {
    candidates.push('/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/microsoft-edge');
  }
  return candidates.find((file) => fs.existsSync(file));
}

function openDefault(url) {
  const [command, args] = process.platform === 'win32'
    ? ['cmd', ['/c', 'start', '', url]]
    : process.platform === 'darwin' ? ['open', [url]] : ['xdg-open', [url]];
  spawn(command, args, { detached: true, stdio: 'ignore' }).on('error', () => {}).unref();
}

function openUrl(base, widget) {
  if (!widget) return openDefault(`${base}/`);
  const url = `${base}/?mode=widget`;
  const browser = findAppBrowser();
  if (!browser) return openDefault(url);
  const profile = path.join(os.tmpdir(), 'sakura-token-garden-widget');
  spawn(browser, [`--app=${url}`, '--window-size=380,600', `--user-data-dir=${profile}`, '--no-first-run'], { detached: true, stdio: 'ignore' })
    .on('error', () => openDefault(url))
    .unref();
  return undefined;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const sakura = new SakuraServer({ port: options.port, demo: options.demo });
  sakura.on('warn', (error) => console.warn('Uyarı:', error.message));

  const result = await sakura.start({ reuseExisting: true });
  if (result.existing) {
    // Sunucu zaten çalışıyor: sadece pencereyi aç.
    console.log(`Sakura zaten çalışıyor: ${result.url}`);
    if (options.open || options.widget) openUrl(result.url, options.widget);
    setTimeout(() => process.exit(0), 300);
    return;
  }

  console.log(`\n  🌸 Sakura Token Bahçesi  ${result.url}${options.demo ? '  (demo)' : ''}`);
  console.log(`     Widget: ${result.url}/?mode=widget\n`);
  if (!options.demo) {
    for (const [source, item] of Object.entries(sakura.tracker.info())) {
      const name = { claude: 'Claude Code', codex: 'Codex', vscode: 'VS Code' }[source] || source;
      console.log(`     ${item.found ? '✓' : '·'} ${name.padEnd(12)} ${item.found ? item.dirs.join(', ') : 'bulunamadı'}`);
    }
    const snap = sakura.snapshot();
    console.log(`\n     ${sakura.tracker.events.length} token olayı okundu (${sakura.loadMs} ms). Bu sezon: ${snap.value.toLocaleString('tr-TR')} / ${snap.settings.target.toLocaleString('tr-TR')}\n`);
  }
  if (options.open || options.widget) openUrl(result.url, options.widget);

  const shutdown = async () => {
    await sakura.stop();
    process.exit(0);
  };
  sakura.on('shutdown-request', shutdown);
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((error) => {
  console.error('Sakura başlatılamadı:', error.message);
  process.exit(1);
});
