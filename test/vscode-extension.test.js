'use strict';
// VS Code eklentisinin satır sayma mantığı, sahte bir `vscode` modülüyle test edilir.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Module = require('node:module');

function fakeDocument(lines) {
  return {
    uri: { scheme: 'file', toString: () => 'file:///demo/app.js' },
    languageId: 'javascript',
    get lineCount() { return lines.length; },
    lineAt: (index) => ({ text: lines[index] }),
    lines,
  };
}

test('VS Code eklentisi yalnızca elle yazılan satırları sayar', async (t) => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'sakura-ext-'));
  const saved = { APPDATA: process.env.APPDATA, HOME: process.env.HOME, XDG: process.env.XDG_CONFIG_HOME };
  process.env.APPDATA = home;
  process.env.HOME = home;
  process.env.XDG_CONFIG_HOME = home;
  t.after(() => {
    process.env.APPDATA = saved.APPDATA;
    process.env.HOME = saved.HOME;
    if (saved.XDG === undefined) delete process.env.XDG_CONFIG_HOME;
    else process.env.XDG_CONFIG_HOME = saved.XDG;
    fs.rmSync(home, { recursive: true, force: true });
  });

  let onChange = null;
  const disposable = { dispose() {} };
  const vscode = {
    StatusBarAlignment: { Right: 2 },
    TextDocumentChangeReason: { Undo: 1, Redo: 2 },
    ConfigurationTarget: { Global: 1 },
    env: { sessionId: 'oturum', openExternal: async () => {} },
    Uri: { parse: (value) => value },
    window: { createStatusBarItem: () => ({ show() {}, dispose() {} }), showInformationMessage() {} },
    workspace: {
      name: 'demo',
      getWorkspaceFolder: () => ({ name: 'demo' }),
      getConfiguration: () => ({ get: (_key, fallback) => fallback, update: async () => {} }),
      onDidChangeTextDocument: (listener) => { onChange = listener; return disposable; },
      onDidCloseTextDocument: () => disposable,
      onDidChangeConfiguration: () => disposable,
    },
    commands: { registerCommand: () => disposable },
  };
  const originalLoad = Module._load;
  Module._load = function load(request, ...rest) {
    return request === 'vscode' ? vscode : originalLoad.call(this, request, ...rest);
  };
  t.after(() => { Module._load = originalLoad; });

  const extensionPath = require.resolve('../vscode-extension/extension.js');
  delete require.cache[extensionPath];
  const extension = require(extensionPath);
  const state = new Map();
  const context = {
    subscriptions: [],
    globalState: { get: (key, fallback) => (state.has(key) ? state.get(key) : fallback), update: async (key, value) => state.set(key, value) },
  };
  extension.activate(context);

  const document = fakeDocument(['']);
  const at = (line) => ({ start: { line, character: 0 } });
  const type = (text, line) => {
    for (const char of text) {
      document.lines[line] += char;
      onChange({ document, reason: undefined, contentChanges: [{ text: char, rangeLength: 0, range: at(line) }] });
    }
  };
  const enter = (line, reason) => {
    document.lines.splice(line + 1, 0, '');
    onChange({ document, reason, contentChanges: [{ text: '\n  ', rangeLength: 0, range: at(line) }] });
  };

  // 1) Elle yazılan iki satır → sayılır.
  type('const a = 1;', 0); enter(0);
  type('let b = a;', 1); enter(1);
  // 2) Boş satırda Enter → sayılmaz.
  enter(2);
  // 3) Yapıştırılan satır + Enter → sayılmaz (o satırda tuşla yazılmış karakter yok).
  document.lines[3] = 'yapıştırılan kod();';
  onChange({ document, reason: undefined, contentChanges: [{ text: 'yapıştırılan kod();\nikinci();', rangeLength: 0, range: at(3) }] });
  enter(3);
  // 4) AI tamamlaması gibi büyük tek ekleme → sayılmaz; geri al ile gelen Enter → sayılmaz.
  onChange({ document, reason: undefined, contentChanges: [{ text: 'function x() {\n  return 1;\n}', rangeLength: 0, range: at(4) }] });
  type('x', 4); type('y', 4);
  enter(4, vscode.TextDocumentChangeReason.Undo);

  for (const item of context.subscriptions) item.dispose();

  const dir = path.join(process.platform === 'darwin' ? path.join(home, 'Library', 'Application Support') : home, 'sakura-token-garden', 'vscode');
  const records = fs.readdirSync(dir).flatMap((file) => fs.readFileSync(path.join(dir, file), 'utf8').trim().split('\n').map((line) => JSON.parse(line)));
  const lines = records.reduce((sum, record) => sum + record.lines, 0);
  const chars = records.reduce((sum, record) => sum + record.chars, 0);
  assert.equal(lines, 2);
  assert.equal(chars, 'const a = 1;'.replace(/\s/g, '').length + 'let b = a;'.replace(/\s/g, '').length + 2);
  assert.equal(records[0].project, 'demo');
  assert.equal(records[0].language, 'javascript');

  // Sakura'nın okuyucusu bu kayıtları anlar.
  const { parseVscodeLine } = require('../lib/parsers');
  assert.ok(parseVscodeLine(JSON.stringify(records[0])));
});
