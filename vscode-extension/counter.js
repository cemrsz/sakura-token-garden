'use strict';
// Elle yazılan satır sayacı — Fuji ağacının tek besin kaynağı.
// vscode modülüne bağlı değildir: eklenti her belge için bir LineCounter tutar ve
// onDidChangeTextDocument olaylarını ona verir. Böylece karar mantığı VS Code olmadan test edilir.

const ENTER = /^(\r?\n[ \t]*){1,2}$/;

const visible = (text) => text.replace(/\s/g, '').length;

class LineCounter {
  constructor() {
    this.typedSinceEnter = 0;
  }

  // changes: onDidChangeTextDocument'ın contentChanges dizisi ({ range, rangeLength, text }).
  // lineText(line): olay uygulandıktan sonra o satırın metni.
  // Dönüş: bu olayla sayılan satırlar ve tuşla yazılan (boşluk dışı) karakterler.
  apply(changes, { lineText, minTyped = 2 }) {
    let lines = 0;
    let chars = 0;
    for (const change of changes) {
      const text = change.text;
      if (ENTER.test(text)) {
        // Enter: imlecin solunda kalan kısım aynı satır numarasında durur.
        if (lineText(change.range.start.line).trim().length > 0 && this.typedSinceEnter >= minTyped) lines += 1;
        this.typedSinceEnter = 0;
      } else if (text.length > 0 && text.length <= 2 && !/[\r\n]/.test(text) && change.rangeLength <= 2) {
        // Tek tuş vuruşu (otomatik kapanan "()" çifti dahil).
        const typed = visible(text);
        this.typedSinceEnter += typed;
        chars += typed;
      }
      // Daha büyük eklemeler (yapıştırma, AI tamamlama, snippet, biçimlendirme) sayılmaz.
    }
    return { lines, chars };
  }
}

module.exports = { LineCounter };
