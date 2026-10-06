'use strict';
// Elle yazılan satır sayacı — Fuji ağacının tek besin kaynağı.
// vscode modülüne bağlı değildir: eklenti her belge için bir LineCounter tutar ve
// onDidChangeTextDocument olaylarını ona verir. Böylece karar mantığı VS Code olmadan test edilir.
//
// Tuşla yazılan karakterler satır satır tutulur: Enter'a basılan satırın kendisinde yeterince
// yazılmamışsa, belgenin başka bir yerinde yazılanlar onu sayılır hale getirmez.

const ENTER = /^(\r?\n[ \t]*){1,2}$/;
const MAX_TRACKED = 200;

const visible = (text) => text.replace(/\s/g, '').length;
const newlines = (text) => (text.match(/\n/g) || []).length;
// Satır başından satır başına uzanan değişiklik satırları bütün olarak değiştirir
// (ör. Enter'a satır başında basmak, ajanın araya satır eklemesi): start satırı da kayar.
const wholeLines = ({ range: { start, end }, text }) => start.character === 0 && end.character === 0 && (!text || text.endsWith('\n'));

class LineCounter {
  constructor() {
    this.lines = new Map(); // satır numarası → { typed }
  }

  stats(line) {
    let entry = this.lines.get(line);
    if (!entry) {
      entry = { typed: 0 };
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
      const text = change.text;
      if (ENTER.test(text)) {
        // Enter: imlecin solunda kalan kısım aynı satır numarasında durur.
        const entry = this.lines.get(line);
        if (entry && entry.typed >= minTyped && lineText(line).trim().length > 0) lines += 1;
        // Satır başındaki Enter satırı aşağı iter; o satırın kaydı kayarak onunla gider.
        if (!wholeLines(change)) this.lines.delete(line);
      } else if (text.length > 0 && text.length <= 2 && !/[\r\n]/.test(text) && change.rangeLength <= 2) {
        // Tek tuş vuruşu (otomatik kapanan "()" çifti dahil).
        const typed = visible(text);
        this.stats(line).typed += typed;
        chars += typed;
      }
      // Daha büyük eklemeler (yapıştırma, AI tamamlama, snippet, biçimlendirme) sayılmaz.
      this.shift(change);
    }
    return { lines, chars };
  }
}

module.exports = { LineCounter };
