'use strict';
// Elle yazılan satır sayacı — Fuji ağacının tek besin kaynağı.
// vscode modülüne bağlı değildir: eklenti her belge için bir LineCounter tutar ve
// onDidChangeTextDocument olaylarını ona verir. Böylece karar mantığı VS Code olmadan test edilir.
//
// Tuşla yazılan karakterler satır satır tutulur: Enter'a basılan satırın kendisinde yeterince
// yazılmamışsa, belgenin başka bir yerinde yazılanlar onu sayılır hale getirmez. Satıra bir kez
// yapıştırma, AI tamamlaması, snippet ya da ajan düzenlemesi girerse o satır artık sayılmaz.

const ENTER = /^(\r?\n[ \t]*){1,2}$/;
// IntelliSense'in tamamladığı tek kelime (ör. "documentElement", "this.items", "log()") ya da
// otomatik kapanan etiket ("</div>"). Ne tuşla yazılmış ne de dışarıdan gelmiş sayılır.
const COMPLETION = /^(?:[\p{L}\p{N}_$.]+(?:\(\))?|<\/[\w.:-]+>)$/u;
const MAX_COMPLETION = 48;
const MAX_TRACKED = 200;

const visible = (text) => text.replace(/\s/g, '').length;
const newlines = (text) => (text.match(/\n/g) || []).length;
// Satır başından satır başına uzanan değişiklik satırları bütün olarak değiştirir
// (ör. Enter'a satır başında basmak, ajanın araya satır eklemesi): start satırı da kayar.
const wholeLines = ({ range: { start, end }, text }) => start.character === 0 && end.character === 0 && (!text || text.endsWith('\n'));

// Değişikliğin türü: enter · key (tek tuş vuruşu, otomatik kapanan "()" dahil) · completion ·
// space (yalnızca boşluk, ör. Tab) · delete · insert (yapıştırma, AI tamamlaması, snippet, ajan).
function kindOf({ text }) {
  if (ENTER.test(text)) return 'enter';
  if (!text) return 'delete';
  if (!visible(text)) return 'space';
  if (!/[\r\n]/.test(text)) {
    if (text.length <= 2) return 'key';
    if (text.length <= MAX_COMPLETION && COMPLETION.test(text)) return 'completion';
  }
  return 'insert';
}

class LineCounter {
  constructor() {
    this.lines = new Map(); // satır numarası → { typed, foreign }
  }

  stats(line) {
    let entry = this.lines.get(line);
    if (!entry) {
      entry = { typed: 0, foreign: false };
      this.lines.set(line, entry);
      if (this.lines.size > MAX_TRACKED) this.lines.delete(this.lines.keys().next().value);
    }
    return entry;
  }

  // Satır ekleyen ya da silen bir değişiklikten sonra izlenen satırların numaralarını kaydırır.
  shift(change) {
    const { start, end } = change.range;
    const added = newlines(change.text);
    const removed = end.line - start.line;
    if (!added && !removed) return;
    const whole = wholeLines(change);
    const first = whole ? start.line : start.line + 1;
    const next = new Map();
    for (const [line, entry] of this.lines) {
      if (line < first) next.set(line, entry);
      else if (line > end.line || (whole && line === end.line)) next.set(line + added - removed, entry);
      // Arada kalan satırlar değişikliğin içinde kayboldu.
    }
    this.lines = next;
  }

  // changes: onDidChangeTextDocument'ın contentChanges dizisi ({ range, rangeLength, text }).
  // lineText(line): olay uygulandıktan sonra o satırın metni.
  // Dönüş: bu olayla sayılan satırlar ve tuşla yazılan (boşluk dışı) karakterler.
  apply(changes, { lineText, minTyped = 2 }) {
    let lines = 0;
    let chars = 0;
    // Aşağıdan yukarı: bir değişiklik yalnızca kendisinden sonraki satırların numarasını kaydırır.
    const ordered = [...changes].sort((a, b) => b.range.start.line - a.range.start.line || b.range.start.character - a.range.start.character);
    for (const change of ordered) {
      const line = change.range.start.line;
      const kind = kindOf(change);
      if (kind === 'enter') {
        // Enter: imlecin solunda kalan kısım aynı satır numarasında durur.
        const entry = this.lines.get(line);
        if (entry && !entry.foreign && entry.typed >= minTyped && lineText(line).trim().length > 0) lines += 1;
        // Satır başındaki Enter satırı aşağı iter; o satırın kaydı kayarak onunla gider.
        if (!wholeLines(change)) this.lines.delete(line);
      } else if (kind === 'key' && change.rangeLength <= 2) {
        const typed = visible(change.text);
        this.stats(line).typed += typed;
        chars += typed;
      } else if (kind === 'insert' && !wholeLines(change)) {
        // Var olan satıra dışarıdan metin girdi. (Satır başına eklenen bütün satırlar yeni
        // satırlardır; kaydı olmadığı için zaten sayılamazlar.)
        this.stats(line).foreign = true;
      }
      this.shift(change);
    }
    return { lines, chars };
  }
}

module.exports = { LineCounter };
