'use strict';
// Fuji'nin satır sayacı (vscode-extension/counter.js), VS Code olmadan: küçük bir belge benzeticisi
// değişiklikleri metne uygular, sayaç da aynı değişiklikleri VS Code'daki gibi alır.
const test = require('node:test');
const assert = require('node:assert/strict');
const { LineCounter } = require('../vscode-extension/counter');

// VS Code'un contentChanges biçiminde bir değişiklik: [satır, sütun] → [bitiş satırı, bitiş sütunu].
function change(start, text, end = start) {
  return { range: { start: { line: start[0], character: start[1] }, end: { line: end[0], character: end[1] } }, rangeLength: 0, text };
}

class Doc {
  constructor(text = '') {
    this.text = text;
    this.counter = new LineCounter();
    this.lines = 0;
    this.chars = 0;
  }

  offset({ line, character }) {
    const rows = this.text.split('\n');
    let offset = 0;
    for (let index = 0; index < line; index += 1) offset += rows[index].length + 1;
    return offset + character;
  }

  // Değişiklikler VS Code'daki gibi aşağıdan yukarı sıralı gelir; her biri sırayla uygulanır.
  edit(changes, options = {}) {
    for (const item of changes) {
      const from = this.offset(item.range.start);
      const to = this.offset(item.range.end);
      item.rangeLength = to - from;
      this.text = this.text.slice(0, from) + item.text + this.text.slice(to);
    }
    const rows = this.text.split('\n');
    const result = this.counter.apply(changes, { ...options, lineText: (line) => rows[Math.min(line, rows.length - 1)] });
    this.lines += result.lines;
    this.chars += result.chars;
    return result;
  }

  get end() {
    const rows = this.text.split('\n');
    return [rows.length - 1, rows[rows.length - 1].length];
  }

  // İmleç belgenin sonundayken tuş tuş yazar (VS Code'un otomatik kapattığı parantezler hariç).
  type(text) {
    for (const char of text) this.edit([change(this.end, char)]);
  }

  enter(indent = '') {
    return this.edit([change(this.end, `\n${indent}`)]);
  }

  insert(at, text, end = at) {
    return this.edit([change(at, text, end)]);
  }
}

test('elle yazılıp Enter ile bitirilen satırlar sayılır, boş satırlar sayılmaz', () => {
  const doc = new Doc();
  doc.type('const a = 1;'); doc.enter();
  doc.type('let b = a;'); doc.enter();
  doc.enter();
  assert.equal(doc.lines, 2);
  assert.equal(doc.chars, 'const a = 1;let b = a;'.replace(/\s/g, '').length);
});

test('yapıştırılan satır sayılmaz', () => {
  const doc = new Doc();
  doc.insert(doc.end, 'yapistirilan(kod);');
  doc.enter();
  assert.equal(doc.lines, 0);
});

test('çok kısa satırlar en az minTyped karakter ister', () => {
  const doc = new Doc();
  doc.type('}'); doc.enter();
  assert.equal(doc.lines, 0);
  doc.type('ab'); doc.enter();
  assert.equal(doc.lines, 1);
});

test('başka satırda yazılan harfler, Enter basılan satırı sayılır hale getirmez', () => {
  const doc = new Doc('// TODO\n');
  doc.insert([0, 7], ' a');
  doc.insert([0, 9], 'b');
  // İmleç alttaki satıra geçer, oraya yapıştırılır ve Enter'a basılır.
  doc.insert(doc.end, 'yapistirilan(kod);');
  doc.enter();
  assert.equal(doc.lines, 0);
});

test('üstte satır eklenip silinince yazılan satırın kaydı onunla birlikte kayar', () => {
  const doc = new Doc();
  doc.type('ab');
  doc.insert([0, 0], 'import x;\nimport y;\n'); // ör. ajan dosyanın başına iki satır ekler
  assert.equal(doc.text, 'import x;\nimport y;\nab');
  doc.insert([0, 0], '', [1, 0]); // ve birini siler
  doc.enter();
  assert.equal(doc.lines, 1);
});

test('Copilot gibi satır içi AI tamamlaması kabul edilen satır sayılmaz', () => {
  const doc = new Doc('    ');
  doc.type('co');
  // Gerçek VS Code'da satır içi önerinin kabulü, satırın başından imlece kadarını tek seferde değiştirir.
  doc.insert([0, 0], '    const total = computeTotal(a, b);', [0, 6]);
  doc.enter('    ');
  assert.equal(doc.lines, 0);
});

test('elle yazılan satıra yapıştırılan parça satırı saydırmaz; snippet de sayılmaz', () => {
  const doc = new Doc();
  doc.type('const url = ');
  doc.insert(doc.end, "'https://example.com/api';");
  doc.enter();
  const snippet = 'for (let i = 0; i < n; i++) {';
  doc.insert(doc.end, `${snippet}\n\t\n}`);
  doc.insert([1, snippet.length], '\n\t'); // snippet'in ilk satırının sonunda Enter
  assert.equal(doc.lines, 0);
});

test('IntelliSense ile tamamlanan tek kelime ve otomatik kapanan etiket satırı bozmaz', () => {
  const doc = new Doc();
  doc.type('let el = docu');
  doc.insert([0, 9], 'documentElement', [0, 13]);
  doc.type(';');
  doc.enter();
  doc.type('<p>');
  doc.insert(doc.end, '</p>');
  doc.enter();
  assert.equal(doc.text, 'let el = documentElement;\n<p></p>\n');
  assert.equal(doc.lines, 2);
});

test('ajanın yazdığı satırın sonuna birkaç harf eklemek o satırı sahiplendirmez', () => {
  const doc = new Doc('const fromAgent = computeSomething(a, b)');
  doc.type(';');
  doc.type(' ok');
  doc.enter();
  assert.equal(doc.lines, 0);
});

test('yazıp silmek satırı saydırmaz', () => {
  const doc = new Doc('const fromAgent = computeSomething(a, b);');
  const end = doc.end[1];
  doc.type(' // '.padEnd(40, 'x'));
  for (let index = 0; index < 40; index += 1) doc.edit([change([0, doc.end[1] - 1], '', doc.end)]);
  assert.equal(doc.end[1], end);
  doc.enter();
  assert.equal(doc.lines, 0);
});

test('yazım hatası düzeltmek, seçili kelimenin üstüne yazmak ve satır birleştirmek sayımı bozmaz', () => {
  const doc = new Doc();
  doc.type('cosnt');
  for (let index = 0; index < 3; index += 1) doc.edit([change([0, doc.end[1] - 1], '', doc.end)]);
  doc.type('nst value = 1;');
  doc.insert([0, 6], 'n', [0, 11]); // "value" seçilip üstüne yazılır
  doc.insert([0, 7], 'a'); doc.insert([0, 8], 'm'); doc.insert([0, 9], 'e');
  assert.equal(doc.text, 'const name = 1;');
  doc.enter();
  assert.equal(doc.lines, 1);

  // Ajanın bıraktığı "foo(" satırına, alttaki satırda yazılan argümanlar Delete ile katılır.
  const other = new Doc('foo(\n');
  other.type('a, b);');
  other.insert([0, 4], '', [1, 0]);
  assert.equal(other.text, 'foo(a, b);');
  other.enter();
  assert.equal(other.lines, 1);
});

test('satır başında basılan Enter satırı aşağı iter; satır yine de sayılabilir', () => {
  const doc = new Doc();
  doc.type('ab');
  doc.insert([0, 0], '\n');
  assert.equal(doc.lines, 0);
  doc.enter();
  assert.equal(doc.lines, 1);
});

test('tuş vuruşu olamayan değişiklikler (geri al / yinele, çoklu imleç, arka plan) hiçbir şey saydırmaz', () => {
  // Geri al + yinele + yeniden Enter aynı satırı ikinci kez saydırmaz.
  const doc = new Doc();
  doc.type('const a = 1;');
  doc.enter();
  assert.equal(doc.lines, 1);
  doc.edit([change([0, 12], '', [1, 0])], { typing: false }); // geri al
  doc.edit([change([0, 12], '\n')], { typing: false }); // yinele
  doc.edit([change([0, 12], '', [1, 0])], { typing: false }); // tekrar geri al
  doc.enter();
  assert.equal(doc.lines, 1);

  // Çoklu imleç: VS Code değişiklikleri aşağıdan yukarı tek olayda verir.
  const multi = new Doc('\n');
  for (const char of 'foo();') multi.edit([change([1, multi.end[1]], char), change([0, multi.end[1]], char)], { typing: false });
  assert.equal(multi.text, 'foo();\nfoo();');
  multi.edit([change([1, 6], '\n'), change([0, 6], '\n')], { typing: false });
  assert.equal(multi.lines, 0);
  assert.equal(multi.chars, 0);
  // Çoklu imleçle başlanan satır, tek imleçle bitirilse de sayılmaz.
  const single = new Doc();
  single.type('x');
  single.edit([change([0, 1], 'y')], { typing: false });
  single.type('z();');
  single.enter();
  assert.equal(single.lines, 0);
});
