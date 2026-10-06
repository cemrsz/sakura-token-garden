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
