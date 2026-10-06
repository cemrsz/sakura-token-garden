'use strict';
// Gerçek VS Code içinde çalışan senaryo (run.js başlatır). Her adım gerçek editör komutlarıyla
// yapılır: tuş vuruşu için `type`, yapıştırma için pano + yapıştır, IntelliSense ve satır içi
// AI önerisi (Copilot'un kullandığı InlineCompletion API'si) için kabul komutları, ajan için
// WorkspaceEdit ve diskteki dosyayı değiştirmek. Belgelere gelen tüm değişiklik olayları kaydedilir.

const vscode = require('vscode');
const fs = require('fs');
const path = require('path');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
// Eklenti kayıtlarını 5 sn'de bir yazar; her adımdan sonra beklenir ki kayıtlar adımlara ayrılabilsin.
const FLUSH_WAIT = 5300;

exports.run = async function run() {
  const out = process.env.SAKURA_REAL_OUT;
  const root = vscode.workspace.workspaceFolders[0].uri.fsPath;
  const initial = { 'demo.js': 'const documentElement = 1;\n', 'other.js': 'module.exports = {};\n' };
  for (const [name, text] of Object.entries(initial)) fs.writeFileSync(path.join(root, name), text);

  const result = { version: vscode.version, initial, events: [], steps: [], final: {}, error: null };
  const names = new Map();
  const listener = vscode.workspace.onDidChangeTextDocument((event) => {
    if (!event.contentChanges.length || !names.has(event.document)) return;
    const editor = vscode.window.activeTextEditor;
    result.events.push({
      doc: names.get(event.document),
      reason: event.reason || 0,
      active: Boolean(editor && editor.document === event.document),
      selections: editor ? editor.selections.length : 0,
      changes: event.contentChanges.map((change) => ({
        range: [change.range.start.line, change.range.start.character, change.range.end.line, change.range.end.character],
        text: change.text,
      })),
    });
  });

  try {
    const extension = vscode.extensions.getExtension('cemrsz.sakura-code-garden');
    if (extension) await extension.activate();
    const demo = await vscode.workspace.openTextDocument(path.join(root, 'demo.js'));
    const other = await vscode.workspace.openTextDocument(path.join(root, 'other.js'));
    names.set(demo, 'demo.js');
    names.set(other, 'other.js');
    let editor = await vscode.window.showTextDocument(demo);
    await sleep(1000);

    const type = async (text) => { for (const char of text) await vscode.commands.executeCommand('type', { text: char }); };
    const enter = () => vscode.commands.executeCommand('type', { text: '\n' });
    const current = () => demo.lineAt(editor.selection.active.line).text;
    const moveToEnd = (line = demo.lineCount - 1) => {
      const character = demo.lineAt(line).text.length;
      editor.selection = new vscode.Selection(line, character, line, character);
    };
    const step = async (name, expected, action) => {
      const entry = { name, expected, ok: true, note: '', start: Date.now() };
      // Ajan düzenlemelerinden sonra odak düzenleyiciden çıkabiliyor; `type` ancak odaktaki düzenleyiciye yazar.
      editor = await vscode.window.showTextDocument(demo, { preserveFocus: false, preview: false });
      result.steps.push(entry);
      const check = (condition, note) => {
        if (!condition) { entry.ok = false; entry.note = note; }
      };
      await action(check);
      await sleep(FLUSH_WAIT);
    };

    moveToEnd();
    await step('Elle yazılan satır (otomatik kapanan parantezlerle)', 1, async (check) => {
      await type('if (a) {');
      check(current() === 'if (a) {}', `satır: ${current()}`);
      await enter();
    });
    await step('Elle yazılan satır', 1, async (check) => {
      await type('let b = 2;');
      check(current().trim() === 'let b = 2;', `satır: ${current()}`);
      await enter();
    });
    await step('Yapıştırılan satır', 0, async (check) => {
      await vscode.env.clipboard.writeText('foo(bar, baz);');
      await vscode.commands.executeCommand('editor.action.clipboardPasteAction');
      await sleep(300);
      check(current().trim() === 'foo(bar, baz);', `satır: ${current()}`);
      await enter();
    });
    await step('IntelliSense ile tamamlanan kelime', 1, async (check) => {
      await type('docu');
      await vscode.commands.executeCommand('editor.action.triggerSuggest');
      await sleep(1500);
      await vscode.commands.executeCommand('acceptSelectedSuggestion');
      await sleep(300);
      await type(';');
      check(current().trim() === 'documentElement;', `satır: ${current()}`);
      await enter();
    });
    await step('Satır içi AI önerisi (Copilot gibi)', 0, async (check) => {
      const provider = vscode.languages.registerInlineCompletionItemProvider({ pattern: '**' }, {
        provideInlineCompletionItems: (document, position) => [new vscode.InlineCompletionItem(
          'const total = computeTotal(a, b);', new vscode.Range(position.line, 0, position.line, position.character))],
      });
      await type('co');
      await vscode.commands.executeCommand('editor.action.inlineSuggest.trigger');
      await sleep(1500);
      await vscode.commands.executeCommand('editor.action.inlineSuggest.commit');
      await sleep(300);
      provider.dispose();
      check(current() === 'const total = computeTotal(a, b);', `satır: ${current()}`);
      await enter();
    });
    await step('Geri al + yinele (Enter yeniden gelir)', 0, async () => {
      await vscode.commands.executeCommand('undo');
      await vscode.commands.executeCommand('redo');
    });
    await step('Snippet', 0, async (check) => {
      const line = editor.selection.active.line;
      await editor.insertSnippet(new vscode.SnippetString('for (let ${1:i} = 0; $1 < n; $1++) {\n\t$0\n}'));
      await vscode.commands.executeCommand('leaveSnippet');
      check(demo.lineAt(line).text.startsWith('for (let i = 0;'), `satır: ${demo.lineAt(line).text}`);
      moveToEnd(line);
      await enter();
    });
    await step('Çoklu imleçle yazılan satırlar', 0, async (check) => {
      moveToEnd();
      await enter(); // en altta boş bir satır
      const last = demo.lineCount - 1;
      editor.selections = [new vscode.Selection(last, 0, last, 0), new vscode.Selection(0, 26, 0, 26)];
      await type(' zz();');
      check(demo.lineAt(last).text.trim() === 'zz();', `satır: ${demo.lineAt(last).text}`);
      await enter();
      moveToEnd();
    });
    await step('Ajan araya satır ekler (WorkspaceEdit)', 0, async () => {
      const edit = new vscode.WorkspaceEdit();
      edit.insert(demo.uri, new vscode.Position(0, 0), '// ajanin yazdigi satir\n');
      await vscode.workspace.applyEdit(edit);
    });
    await step('Ajanın satırının sonuna iki harf eklemek', 0, async (check) => {
      moveToEnd(0);
      await type(' ok');
      check(current() === '// ajanin yazdigi satir ok', `satır: ${current()}`);
      await enter();
    });
    await step('Ajan dosyayı diskte değiştirir (VS Code yeniden yükler)', 0, async (check) => {
      await demo.save();
      const rows = fs.readFileSync(demo.uri.fsPath, 'utf8').split('\n');
      rows.splice(2, 0, 'const fromAgent = 42;');
      fs.writeFileSync(demo.uri.fsPath, rows.join('\n'));
      for (let tries = 0; tries < 50 && !demo.getText().includes('fromAgent'); tries += 1) await sleep(100);
      check(demo.getText().includes('fromAgent'), 'dosya yeniden yüklenmedi');
    });
    await step('Ajan arka plandaki belgeyi harf harf düzenler', 0, async () => {
      for (const text of ['a', 'b', '\n']) {
        const edit = new vscode.WorkspaceEdit();
        const line = other.lineCount - 2;
        edit.insert(other.uri, new vscode.Position(line, other.lineAt(line).text.length), text);
        await vscode.workspace.applyEdit(edit);
      }
    });
    await step('Elle yazılan satır', 1, async (check) => {
      moveToEnd();
      await enter();
      await type('return b;');
      check(current().trim() === 'return b;', `satır: ${current()}`);
      await enter();
    });
    result.final = { 'demo.js': demo.getText(), 'other.js': other.getText() };
  } catch (error) {
    result.error = String((error && error.stack) || error);
  }
  listener.dispose();
  fs.writeFileSync(out, JSON.stringify(result, null, 1));
};
