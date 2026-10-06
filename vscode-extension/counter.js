'use strict';
// Elle yazılan satır sayacı — Fuji ağacının tek besin kaynağı.
// vscode modülüne bağlı değildir: eklenti her belge için bir LineCounter tutar ve
// onDidChangeTextDocument olaylarını ona verir. Böylece karar mantığı VS Code olmadan test edilir.
//
// Bir satır, Enter ile bitirildiğinde şu koşulların hepsi sağlanıyorsa sayılır:
//   • satıra yapıştırma, AI tamamlaması, snippet ya da ajan düzenlemesi girmemiştir;
//   • satırda en az minTyped karakter tuşla yazılmıştır (başka satırlarda yazılanlar sayılmaz);
//   • satırın en az yarısı tuşla yazılmıştır (IntelliSense'in tamamladığı kelimeler hariç).
//     Ajanın yazdığı bir satırın sonuna birkaç harf eklemek o satırı sahiplendirmez.
// Silinen karakterler tuşla yazılanlardan düşülür; yazıp silmek satırı saydırmaz.

const ENTER = /^(\r?\n[ \t]*){1,2}$/;
// IntelliSense'in tamamladığı tek kelime (ör. "documentElement", "this.items", "log()") ya da
// otomatik kapanan etiket ("</div>"). Ne tuşla yazılmış ne de dışarıdan gelmiş sayılır.
const COMPLETION = /^(?:[\p{L}\p{N}_$.]+(?:\(\))?|<\/[\w.:-]+>)$/u;
const MAX_COMPLETION = 48;
// Satırın (tamamlanan kelimeler hariç) en az bu kadarı tuşla yazılmış olmalı.
const TYPED_SHARE = 0.5;
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
    this.lines = new Map(); // satır numarası → { typed, assisted, foreign }
  }

  stats(line) {
    let entry = this.lines.get(line);
    if (!entry) {
      entry = { typed: 0, assisted: 0, foreign: false };
      this.lines.set(line, entry);
      if (this.lines.size > MAX_TRACKED) this.lines.delete(this.lines.keys().next().value);
    }
    return entry;
  }

  // Enter'a basılan satır elle yazılmış sayılır mı?
  owns(line, text, minTyped) {
    const entry = this.lines.get(line);
    const total = visible(text);
    if (!entry || entry.foreign || !total) return false;
    const typed = Math.min(entry.typed, total);
    return typed >= minTyped && typed >= TYPED_SHARE * Math.max(0, total - entry.assisted);
  }

  // Satır ekleyen ya da silen bir değişiklikten sonra izlenen satırların numaralarını kaydırır.
  shift(change) {
    const { start, end } = change.range;
    const added = newlines(change.text);
    const removed = end.line - start.line;
    if (!added && !removed) return;
    const whole = wholeLines(change);
    // Satır sonunda Delete ya da satır başında Backspace: alttaki satır üsttekine katılır.
    const join = !whole && !change.text && removed === 1 && end.character === 0;
    const first = whole ? start.line : start.line + 1;
    const next = new Map();
    let joined = null;
    for (const [line, entry] of this.lines) {
      if (line < first) next.set(line, entry);
      else if (line > end.line || (whole && line === end.line)) next.set(line + added - removed, entry);
      else if (join) joined = entry;
      // Arada kalan diğer satırlar değişikliğin içinde kayboldu.
    }
    this.lines = next;
    if (joined) {
      const target = this.stats(start.line);
      target.typed += joined.typed;
      target.assisted += joined.assisted;
      target.foreign = target.foreign || joined.foreign;
    }
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
      const singleLine = change.range.end.line === line;
      const kind = kindOf(change);
      if (kind === 'enter') {
        // Enter: imlecin solunda kalan kısım aynı satır numarasında durur.
        if (this.owns(line, lineText(line), minTyped)) lines += 1;
        // Satır başındaki Enter satırı aşağı iter; o satırın kaydı kayarak onunla gider.
        if (!wholeLines(change)) this.lines.delete(line);
      } else if (kind === 'key') {
        // Seçili metnin üstüne yazmak ya da otomatik kapanan ")" üstünden geçmek, yerine gelen
        // karakterler kadar tuşla yazılanı düşürür.
        const entry = this.stats(line);
        const typed = visible(change.text);
        entry.typed = Math.max(0, entry.typed - (singleLine ? change.rangeLength : 0)) + typed;
        chars += typed;
      } else if (kind === 'completion') {
        this.stats(line).assisted += Math.max(0, visible(change.text) - change.rangeLength);
      } else if (kind === 'delete' && singleLine) {
        const entry = this.lines.get(line);
        if (entry) entry.typed = Math.max(0, entry.typed - change.rangeLength);
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
