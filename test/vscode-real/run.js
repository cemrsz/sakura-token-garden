#!/usr/bin/env node
'use strict';
// Fuji'nin satır sayacını GERÇEK bir VS Code içinde dener. Yalıtılmış bir VS Code penceresi açar
// (ayrı kullanıcı ve eklenti klasörü, kayıtlar geçici bir klasöre), eklentiyi geliştirme modunda
// yükler ve suite.js'teki senaryoyu oynatır. Sonra eklentinin yazdığı kayıtları adım adım
// beklenen satır sayılarıyla karşılaştırır. npm test'in parçası değildir; VS Code kurulu olmalı.
//
//   node test/vscode-real/run.js
//   node test/vscode-real/run.js --extension <klasör>   başka bir eklenti sürümünü dener
//   node test/vscode-real/run.js --record <dosya.json>  olay kaydını yazar (test/fixtures için)
//
// VS Code yolu VSCODE_PATH ile verilebilir. Windows ve Linux'ta denendi.

const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

function argument(name) {
  const index = process.argv.indexOf(name);
  return index > 0 ? process.argv[index + 1] : null;
}

function findVscode() {
  const candidates = [
    process.env.VSCODE_PATH,
    process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Programs', 'Microsoft VS Code', 'Code.exe'),
    'C:\\Program Files\\Microsoft VS Code\\Code.exe',
    '/usr/share/code/code',
    '/Applications/Visual Studio Code.app/Contents/MacOS/Electron',
  ];
  return candidates.find((candidate) => candidate && fs.existsSync(candidate));
}

const executable = findVscode();
if (!executable) {
  console.error('VS Code bulunamadı; VSCODE_PATH ile yolunu ver.');
  process.exit(2);
}

const extension = path.resolve(argument('--extension') || path.join(__dirname, '..', '..', 'vscode-extension'));
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'sakura-vscode-real-'));
const workspace = path.join(temp, 'ws');
const appData = path.join(temp, 'appdata');
const out = path.join(temp, 'result.json');
fs.mkdirSync(workspace);
fs.mkdirSync(appData);

// Dıştaki bir VS Code terminalinden gelen değişkenler yeni pencereyi o oturuma bağlamasın.
const env = { ...process.env, APPDATA: appData, XDG_CONFIG_HOME: appData, SAKURA_REAL_OUT: out };
for (const key of Object.keys(env)) if (/^(VSCODE_|ELECTRON_)/.test(key)) delete env[key];

console.log(`VS Code: ${executable}\nEklenti: ${extension}\nSenaryo oynatılıyor (yaklaşık 75 sn, bir VS Code penceresi açılıp kapanacak)…`);
spawnSync(executable, [
  `--extensionDevelopmentPath=${extension}`,
  `--extensionTestsPath=${path.join(__dirname, 'suite.js')}`,
  `--user-data-dir=${path.join(temp, 'user')}`,
  `--extensions-dir=${path.join(temp, 'extensions')}`,
  '--disable-workspace-trust', '--skip-welcome', '--skip-release-notes', '--disable-gpu',
  workspace,
], { env, stdio: 'ignore', timeout: 240000 });

if (!fs.existsSync(out)) {
  console.error('Senaryo sonucu yazılmadı; VS Code başlatılamamış olabilir.');
  process.exit(2);
}
const result = JSON.parse(fs.readFileSync(out, 'utf8'));
if (result.error) {
  console.error(result.error);
  process.exit(2);
}

// Eklentinin kayıtları zaman damgasıyla adımlara dağıtılır (her adımdan sonra bir kayıt turu beklenir).
const dir = path.join(appData, 'sakura-token-garden', 'vscode');
const records = fs.existsSync(dir)
  ? fs.readdirSync(dir).flatMap((file) => fs.readFileSync(path.join(dir, file), 'utf8').trim().split('\n').filter(Boolean).map((line) => JSON.parse(line)))
  : [];
const counted = result.steps.map(() => 0);
for (const record of records) {
  let index = result.steps.findIndex((step, i) => record.ts >= step.start && (i === result.steps.length - 1 || record.ts < result.steps[i + 1].start));
  if (index < 0) index = result.steps.length - 1;
  counted[index] += record.lines;
}

let failed = 0;
for (const [index, step] of result.steps.entries()) {
  const good = step.ok && counted[index] === step.expected;
  if (!good) failed += 1;
  console.log(`${good ? '✔' : '✖'} ${step.name}: ${counted[index]} satır (beklenen ${step.expected})${step.ok ? '' : ` — adım yapılamadı: ${step.note}`}`);
}
const total = counted.reduce((sum, value) => sum + value, 0);
const expected = result.steps.reduce((sum, step) => sum + step.expected, 0);
console.log(`Toplam: ${total} satır (beklenen ${expected})`);

const record = argument('--record');
if (record) {
  const { version, initial, events, final } = result;
  const head = [['vscode', version], ['initial', initial], ['final', final], ['expected', expected]].map(([key, value]) => ` "${key}": ${JSON.stringify(value)}`);
  fs.writeFileSync(record, `{\n${head.join(',\n')},\n "events": [\n${events.map((event) => `  ${JSON.stringify(event)}`).join(',\n')}\n ]\n}\n`);
  console.log(`Olay kaydı: ${record} (${events.length} olay)`);
}
try { fs.rmSync(temp, { recursive: true, force: true }); } catch { /* VS Code dosyaları hâlâ tutuyorsa geçici klasör kalır */ }
process.exit(failed ? 1 : 0);
