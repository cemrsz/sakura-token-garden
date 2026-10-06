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

const position = (line, character) => ({ line, character });
const range = (line, character, endLine = line, endCharacter = character) => ({ start: position(line, character), end: position(endLine, endCharacter) });

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
    window: { createStatusBarItem: () => ({ show() {}, dispose() {} }), showInformationMessage() {}, activeTextEditor: null },
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
  let disposed = false;
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    for (const item of context.subscriptions) item.dispose();
  };
  t.after(dispose);

  const document = fakeDocument(['']);
  const editor = { document, selections: [{}] };
  vscode.window.activeTextEditor = editor;
  const type = (text, line) => {
    for (const char of text) {
      const character = document.lines[line].length;
      document.lines[line] += char;
      onChange({ document, reason: undefined, contentChanges: [{ text: char, rangeLength: 0, range: range(line, character) }] });
    }
  };
  const enter = (line, reason) => {
    const character = document.lines[line].length;
    document.lines.splice(line + 1, 0, '  ');
    onChange({ document, reason, contentChanges: [{ text: '\n  ', rangeLength: 0, range: range(line, character) }] });
  };
  // Yapıştırma ya da AI tamamlaması gibi tek seferde gelen çok satırlı ekleme.
  const insert = (line, text) => {
    const character = document.lines[line].length;
    const rows = text.split('\n');
    rows[0] = document.lines[line] + rows[0];
    document.lines.splice(line, 1, ...rows);
    onChange({ document, reason: undefined, contentChanges: [{ text, rangeLength: 0, range: range(line, character) }] });
  };

  // 1) Elle yazılan iki satır → sayılır.
  type('const a = 1;', 0); enter(0);
  type('let b = a;', 1); enter(1);
  // 2) Boş satırda Enter → sayılmaz.
  enter(2);
  // 3) Yapıştırılan satır + Enter → sayılmaz (o satırda tuşla yazılmış karakter yok).
  insert(3, 'yapıştırılan kod();\nikinci();');
  enter(4);
  // 4) AI tamamlaması gibi büyük tek ekleme → sayılmaz; geri al ile gelen Enter → sayılmaz.
  insert(5, 'function x() {\n  return 1;\n}');
  type('x', 7); type('y', 7);
  enter(7, vscode.TextDocumentChangeReason.Undo);
  // 5) Çoklu imleçle yazılan satır → sayılmaz.
  editor.selections = [{}, {}];
  type('ab();', 8); enter(8);
  editor.selections = [{}];
  // 6) Etkin olmayan bir belgeye gelen değişiklikler (ör. ajanın arka planda düzenlediği dosya) → sayılmaz.
  vscode.window.activeTextEditor = { document: fakeDocument(['']), selections: [{}] };
  type('cd();', 9); enter(9);
  vscode.window.activeTextEditor = editor;
  // 7) Yeniden elle yazılan satır → sayılır.
  type('ok();', 10); enter(10);

  dispose();

  const dir = path.join(process.platform === 'darwin' ? path.join(home, 'Library', 'Application Support') : home, 'sakura-token-garden', 'vscode');
  const records = fs.readdirSync(dir).flatMap((file) => fs.readFileSync(path.join(dir, file), 'utf8').trim().split('\n').map((line) => JSON.parse(line)));
  const lines = records.reduce((sum, record) => sum + record.lines, 0);
  const chars = records.reduce((sum, record) => sum + record.chars, 0);
  assert.equal(lines, 3);
  assert.equal(chars, 'const a = 1;let b = a;xyok();'.replace(/\s/g, '').length);
  assert.equal(records[0].project, 'demo');
  assert.equal(records[0].language, 'javascript');

  // Sakura'nın okuyucusu bu kayıtları anlar.
  const { parseVscodeLine } = require('../lib/parsers');
  assert.ok(parseVscodeLine(JSON.stringify(records[0])));
});
