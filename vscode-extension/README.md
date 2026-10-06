# 🪻 Sakura Kod Bahçesi (VS Code)

Elle yazdığın kod satırlarını sayar ve [Sakura Token Bahçesi](https://github.com/cemrsz/sakura-token-garden)'nde
**Fuji** (morsalkım) ağacını büyütür. Hedefler: 50 · 100 · 250 · 1000 · 5000 satır.

Ajanların kendi ağaçlarını token harcayarak büyütür; Fuji'yi büyütmenin tek yolu klavyede kod yazmaktır.

## Ne sayılır?

Bir satır, Enter ile bitirdiğinde şunların hepsi doğruysa sayılır:

- Satırı **önündeki düzenleyicide, tek imleçle, tuşlara basarak** yazdın.
- Satıra **yapıştırma, AI tamamlaması, snippet ya da ajan düzenlemesi girmedi.**
- Satırın **en az yarısını** tuşla yazdın. IntelliSense'in tamamladığı tek kelimeler (ör. `documentElement`)
  ve otomatik kapanan etiketler bu hesaba girmez, satırı da bozmaz.
- Satırda tuşla yazılmış en az `sakuraGarden.minTypedChars` (varsayılan 2) karakter var.

Sayılmayanlar:

| Durum | Neden |
|---|---|
| Yapıştırma, Copilot / AI satır içi önerileri, snippet'ler | Satıra dışarıdan metin girdi |
| Ajanların düzenlemeleri (Claude Code, Codex, Copilot ajanı…) | Diskten yeniden yükleme, `WorkspaceEdit` ya da arka plandaki belge |
| Ajanın yazdığı satırın sonuna birkaç harf eklemek | Satırın yarısından azı senin |
| Yazıp silmek | Silinen karakterler sayımdan düşülür |
| Geri al / yinele, çoklu imleç | Tuş vuruşu sayılmaz |
| Boş satırlar, çıktı panelleri, commit mesajı kutusu | — |

Yazım hatası düzeltmek, seçili bir kelimenin üstüne yazmak, otomatik kapanan parantezler ve
Backspace/Delete ile satır birleştirmek elle yazılan satırı bozmaz.

## Nereye yazar?

Sayılar yalnızca bilgisayarındaki bir klasöre yazılır; internete hiçbir şey gönderilmez:

- Windows: `%APPDATA%\sakura-token-garden\vscode\`
- macOS: `~/Library/Application Support/sakura-token-garden/vscode/`
- Linux: `~/.config/sakura-token-garden/vscode/`

Kod içeriği yazılmaz; yalnızca satır ve karakter sayısı, dil ve klasör adı.
Sakura uygulaması kapalıyken de kayıt tutulur; uygulama açılınca okunur ve günlük / haftalık veritabanına eklenir.

## Komutlar

- **Sakura: Bahçeyi aç** — durum çubuğundaki 🪻 sayaca tıklamakla aynı.
- **Sakura: Satır saymayı aç / kapat**

Ayarlar: `sakuraGarden.enabled`, `sakuraGarden.minTypedChars` (varsayılan 2).

## Geliştirme

Karar mantığı `counter.js`'te, VS Code'dan bağımsızdır. Depo kökünde:

- `npm test` — sayaç birim testleri ve gerçek bir VS Code oturumundan kaydedilmiş olayların yeniden oynatılması
- `npm run test:vscode` — senaryoyu yalıtılmış gerçek bir VS Code penceresinde oynatır ve eklentinin kayıtlarını adım adım denetler
