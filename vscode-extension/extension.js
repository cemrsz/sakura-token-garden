'use strict';
// Sakura Kod Bahçesi — VS Code eklentisi.
// Elle yazılan kod satırlarını sayar ve Sakura Token Bahçesi'nin okuduğu yerel kayıt
// dosyasına ekler. Bir satır, ancak o satırda gerçekten tuşa basılarak yazılmış ve
// Enter ile bitirilmişse sayılır; yapıştırma, AI/Copilot tamamlamaları, ajanların
// düzenlemeleri, snippet, biçimlendirme, geri al / yinele sayılmaz (kurallar: counter.js).
// Uygulama kapalıyken de kayıt tutulur.

const vscode = require('vscode');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { LineCounter } = require('./counter');

const FLUSH_MS = 5000;

function appDataDir() {
  const home = os.homedir();
  if (process.platform === 'win32') return path.join(process.env.APPDATA || path.join(home, 'AppData', 'Roaming'), 'sakura-token-garden');
  if (process.platform === 'darwin') return path.join(home, 'Library', 'Application Support', 'sakura-token-garden');
  return path.join(process.env.XDG_CONFIG_HOME || path.join(home, '.config'), 'sakura-token-garden');
}

function dayKey(ts = Date.now()) {
  const date = new Date(ts);
  const pad = (value) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function activate(context) {
  const windowId = crypto.createHash('sha1').update(vscode.env.sessionId || String(process.pid)).digest('hex').slice(0, 10);
  const documents = new Map(); // belge uri → LineCounter
  const pending = new Map();
  let counter = 0;

  const config = () => vscode.workspace.getConfiguration('sakuraGarden');
  const status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  status.command = 'sakuraGarden.open';
  context.subscriptions.push(status);

  const todayKey = () => `lines:${dayKey()}`;
  function renderStatus() {
    if (!config().get('enabled', true)) {
      status.text = '$(circle-slash) Sakura';
      status.tooltip = 'Sakura Kod Bahçesi: satır sayma kapalı';
    } else {
      const lines = context.globalState.get(todayKey(), 0);
      status.text = `🪻 ${lines} satır`;
      status.tooltip = `Sakura Kod Bahçesi — bugün elle yazılan satır: ${lines}\nTıkla: bahçeyi aç`;
    }
    status.show();
  }

  function projectOf(document) {
    const folder = vscode.workspace.getWorkspaceFolder(document.uri);
    return (folder && folder.name) || vscode.workspace.name || 'dosya';
  }

  function record(document, lines, chars) {
    const key = `${projectOf(document)}\u0000${document.languageId}`;
    const item = pending.get(key) || { project: projectOf(document), language: document.languageId, lines: 0, chars: 0 };
    item.lines += lines;
    item.chars += chars;
    pending.set(key, item);
  }

  function flush() {
    if (!pending.size) return;
    const ts = Date.now();
    const lines = [];
    let added = 0;
    for (const item of pending.values()) {
      counter += 1;
      lines.push(JSON.stringify({ id: `${windowId}-${ts}-${counter}`, ts, window: windowId, project: item.project, language: item.language, lines: item.lines, chars: item.chars }));
      added += item.lines;
    }
    pending.clear();
    try {
      const dir = path.join(appDataDir(), 'vscode');
      fs.mkdirSync(dir, { recursive: true });
      fs.appendFileSync(path.join(dir, `${dayKey(ts)}_${windowId}.jsonl`), `${lines.join('\n')}\n`);
    } catch (error) {
      console.error('[sakura] kayıt yazılamadı', error);
    }
    if (added) {
      context.globalState.update(todayKey(), context.globalState.get(todayKey(), 0) + added).then(renderStatus);
    }
  }

  context.subscriptions.push(vscode.workspace.onDidChangeTextDocument((event) => {
    if (!config().get('enabled', true)) return;
    const document = event.document;
    if (document.uri.scheme !== 'file' && document.uri.scheme !== 'untitled') return;
    const reason = event.reason;
    // Tuş vuruşu ancak kullanıcının önündeki düzenleyicide, tek imleçle olur. Geri al / yinele,
    // çoklu imleç ve arka plandaki belgelere gelen değişiklikler (ör. bir ajanın başka bir
    // sekmedeki dosyayı düzenlemesi) yine işlenir ki satır numaraları kaysın, ama hiçbir şey saymaz.
    const editor = vscode.window.activeTextEditor;
    const typing = reason !== vscode.TextDocumentChangeReason.Undo
      && reason !== vscode.TextDocumentChangeReason.Redo
      && !!editor && editor.document === document && editor.selections.length === 1;
    const key = document.uri.toString();
    let lineCounter = documents.get(key);
    if (!lineCounter) documents.set(key, (lineCounter = new LineCounter()));
    const result = lineCounter.apply(event.contentChanges, {
      typing,
      minTyped: Math.max(1, config().get('minTypedChars', 2)),
      lineText: (line) => document.lineAt(Math.min(line, document.lineCount - 1)).text,
    });
    if (result.lines || result.chars) record(document, result.lines, result.chars);
  }));

  context.subscriptions.push(vscode.workspace.onDidCloseTextDocument((document) => documents.delete(document.uri.toString())));
  context.subscriptions.push(vscode.workspace.onDidChangeConfiguration((event) => {
    if (event.affectsConfiguration('sakuraGarden')) renderStatus();
  }));

  context.subscriptions.push(vscode.commands.registerCommand('sakuraGarden.open', async () => {
    try {
      const server = JSON.parse(fs.readFileSync(path.join(appDataDir(), 'server.json'), 'utf8'));
      await vscode.env.openExternal(vscode.Uri.parse(server.url));
    } catch {
      vscode.window.showInformationMessage('Sakura Token Bahçesi çalışmıyor. Masaüstü uygulamasını aç; satırların yine de kaydediliyor.');
    }
  }));
  context.subscriptions.push(vscode.commands.registerCommand('sakuraGarden.toggle', async () => {
    const enabled = !config().get('enabled', true);
    await config().update('enabled', enabled, vscode.ConfigurationTarget.Global);
    vscode.window.showInformationMessage(`Sakura: satır sayma ${enabled ? 'açıldı' : 'kapatıldı'}.`);
  }));

  const timer = setInterval(flush, FLUSH_MS);
  context.subscriptions.push({ dispose: () => { clearInterval(timer); flush(); } });
  // Gün değişince durum çubuğu sıfırdan başlasın.
  const dayTimer = setInterval(renderStatus, 60 * 1000);
  context.subscriptions.push({ dispose: () => clearInterval(dayTimer) });
  renderStatus();
}

function deactivate() {}

module.exports = { activate, deactivate };
